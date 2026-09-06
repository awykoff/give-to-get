import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getEdgeFnUrl, redactCredentials } from "@/lib/edge-fn-url";

// Thin proxy in front of the `import-processor` Supabase Edge Function.
//
// Flow:
//   1. Verify the caller is authenticated (anon-keyed server client + cookies).
//   2. Resolve the caller's workspace_id via workspace_members.
//   3. Forward the parsed CSV payload to the Edge Function, authenticated
//      with the service-role key as a Bearer token (server-only — never
//      exposed to the client).
//   4. Return the function's response verbatim so ImportReview.tsx's
//      { new_contacts_count, duplicate_count, invalid_count, credits_earned }
//      contract is preserved.
//
// The Edge Function is responsible for all data work — reverse-mapping,
// dedup, contacts INSERT, imports UPDATE, and the credit-earning trigger.

const EDGE_FN_URL = getEdgeFnUrl("import-processor");

// Walk an Error's .cause chain and return every distinct message.
// Node's fetch() wraps low-level failures in `TypeError: fetch failed`
// whose `.cause` is the real reason (ECONNREFUSED, ENOTFOUND, TLS, etc.).
// Sometimes the cause itself has a cause (e.g. undici wraps the
// underlying socket error), so walk down to a sane depth.
function causeChain(e: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<unknown>();
  let cur: unknown = e;
  for (let i = 0; i < 5 && cur && !seen.has(cur); i++) {
    seen.add(cur);
    const msg =
      cur instanceof Error
        ? cur.message || cur.name || "<no message>"
        : typeof cur === "string"
        ? cur
        : (() => {
            try {
              return JSON.stringify(cur);
            } catch {
              return String(cur);
            }
          })();
    if (msg && !out.includes(msg)) out.push(msg);
    // `.cause` is standard on Error since Node 16; some libraries also
    // expose `.errors[]` for AggregateError. Cover both.
    if (cur instanceof Error && (cur as { cause?: unknown }).cause) {
      cur = (cur as { cause?: unknown }).cause;
    } else if (
      cur &&
      typeof cur === "object" &&
      Array.isArray((cur as { errors?: unknown[] }).errors) &&
      (cur as { errors?: unknown[] }).errors!.length > 0
    ) {
      cur = (cur as { errors: unknown[] }).errors[0];
    } else {
      break;
    }
  }
  return out;
}

interface ProxyRequestBody {
  rows: Record<string, string>[];
  mapping: Record<string, string>;
  fileName: string;
}

interface EdgeResponse {
  new_contacts_count: number;
  duplicate_count: number;
  invalid_count: number;
  credits_earned: number;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: member, error: memberErr } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .single();

  if (memberErr || !member?.workspace_id) {
    return NextResponse.json(
      { error: "No workspace found for this user" },
      { status: 400 },
    );
  }
  const workspaceId = member.workspace_id as string;

  let body: ProxyRequestBody;
  try {
    body = (await req.json()) as ProxyRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body.rows) || body.rows.length === 0) {
    return NextResponse.json({ error: "No rows provided" }, { status: 400 });
  }
  if (!body.mapping || typeof body.mapping !== "object") {
    return NextResponse.json({ error: "Mapping is required" }, { status: 400 });
  }
  if (!body.fileName) {
    return NextResponse.json({ error: "fileName is required" }, { status: 400 });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json(
      { error: "Server is missing SUPABASE_SERVICE_ROLE_KEY" },
      { status: 500 },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(EDGE_FN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + serviceKey,
      },
      body: JSON.stringify({
        workspace_id: workspaceId,
        processed_by: user.id,
        filename: body.fileName,
        rows: body.rows,
        mapping: body.mapping,
      }),
    });
  } catch (e) {
      // Node's fetch() throws `TypeError: fetch failed` on any network-level
      // failure (DNS, connection refused, TLS, abort, timeout). The actual
      // reason lives on `.cause` and sometimes on `.cause.cause`. Walk the
      // chain so the operator sees the real error instead of the wrapper.
      const causes = causeChain(e);
      const message = causes[0] ?? "Edge Function unreachable";
      // Log everything we know — full chain + the URL we tried. Server-side
      // log is the place where unredacted detail is fine; the response to
      // the client gets a scrubbed subset.
      console.error(
        "[api/import] fetch to Edge Function failed:",
        JSON.stringify({
          url: redactCredentials(EDGE_FN_URL),
          causes,
          errorName: e instanceof Error ? e.name : undefined,
          errorStack: e instanceof Error ? e.stack : undefined,
        })
      );
      return NextResponse.json(
        {
          error: message,
          // Surface the chain + the URL we tried. This is debugging-mode
          // detail; safe to ship temporarily. Once the env-var / network
          // issue is confirmed, this can be collapsed back to just `error`.
          causes: causes.slice(1),
          url: redactCredentials(EDGE_FN_URL),
        },
        { status: 502 }
      );
    }

  // Parse once — pass through to the client with the same status.
  // Friendlier-message pass: if the upstream returned a raw PostgREST
  // schema-cache error (or any other "could not find column X of Y" /
  // RLS / constraint message), wrap it so the client gets a stable
  // signal instead of the raw Postgres string. We still log the raw
  // message server-side for ops to debug.
  let parsed: EdgeResponse | { error: string };
  try {
    parsed = await upstream.json();
  } catch {
    return NextResponse.json(
      { error: "Edge Function returned a non-JSON response" },
      { status: 502 },
    );
  }

  if (
    parsed &&
    typeof parsed === "object" &&
    "error" in parsed &&
    typeof parsed.error === "string" &&
    /schema cache|Row Level Security|row-level security|violates row-level security policy|violates check constraint|duplicate key value violates unique constraint|violates unique constraint/i.test(parsed.error)
  ) {
    console.error("[api/import] upstream schema/RLError:", parsed.error);
    return NextResponse.json(
      {
        error:
          "The import pipeline hit a server-side error. This is almost always a deploy-state mismatch — the deployed code is older than the current source. Check that the Edge Function and this route are both on the latest version.",
        details: parsed.error,
      },
      { status: upstream.status },
    );
  }

  return NextResponse.json(parsed, { status: upstream.status });
}