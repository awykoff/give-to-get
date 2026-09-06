import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getEdgeFnUrl,
  getLegacyExportUrl,
  redactCredentials,
} from "@/lib/edge-fn-url";

// Thin proxy in front of the `export-generator` Supabase Edge Function.
//
// Flow:
//   1. Verify the caller is authenticated (anon-keyed server client + cookies).
//   2. Resolve the caller's workspace_id via workspace_members.
//   3. Forward { contact_ids, format, fields } to the Edge Function,
//      authenticated with the service-role key as a Bearer token
//      (server-only — never exposed to the client).
//   4. Return the function's response verbatim — the client UI expects
//      { export_id, contact_count, credits_spent, signed_url, expires_at }.
//
// All credit math, RLS-aware data access, file generation, Storage
// upload, signed-URL minting, and the credits_ledger 'spend' row (via
// the trg_export_credits trigger) live in the Edge Function. This route
// only authenticates the user, resolves their workspace, and shuttles
// bytes.

// Edge Function URL — canonical path through src/lib/edge-fn-url.ts.
//
// Resolution order:
//   1. Legacy `SUPABASE_EDGE_FN_URL_EXPORT` (a full URL) if set — kept
//      for one redeploy cycle so the env-var rename doesn't break prod
//      mid-rollout. The helper logs a one-time migration warning.
//   2. Canonical `SUPABASE_EDGE_FN_URL` (a base URL) appended with
//      "/functions/v1/export-generator".
//   3. Localhost fallback for `supabase start` (warns at module load).
const EDGE_FN_URL = getLegacyExportUrl() ?? getEdgeFnUrl("export-generator");

// Walk an Error's .cause chain and return every distinct message.
// Same shape as `src/app/api/import/route.ts`'s causeChain — duplicated
// locally so each route stays self-contained for grep-ability and
// tests, rather than importing a private helper. The redaction helper
// lives in @/lib/edge-fn-url because that's where URL handling belongs.
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

type ExportFormat = "csv" | "xlsx" | "json";

interface ProxyRequestBody {
  contact_ids: string[];
  format?: ExportFormat;
  fields?: string[];
}

interface EdgeSuccessResponse {
  export_id: string;
  contact_count: number;
  credits_spent: number;
  format: ExportFormat;
  signed_url: string;
  expires_at: string | null;
  url_expires_in_seconds: number;
}

interface EdgeErrorResponse {
  error: string;
  code?: string;
  details?: string;
  balance?: number;
  required?: number;
}

const ALLOWED_FORMATS: ExportFormat[] = ["csv", "xlsx", "json"];

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

  if (!Array.isArray(body.contact_ids) || body.contact_ids.length === 0) {
    return NextResponse.json(
      { error: "contact_ids is required and must be non-empty" },
      { status: 400 },
    );
  }

  const format = body.format ?? "csv";
  if (!ALLOWED_FORMATS.includes(format)) {
    return NextResponse.json(
      { error: "format must be one of: csv, xlsx, json" },
      { status: 400 },
    );
  }

  if (body.fields !== undefined) {
    if (!Array.isArray(body.fields) || body.fields.some((f) => typeof f !== "string")) {
      return NextResponse.json(
        { error: "fields must be an array of strings" },
        { status: 400 },
      );
    }
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
        requested_by: user.id,
        contact_ids: body.contact_ids,
        format,
        fields: body.fields,
      }),
    });
  } catch (e) {
    // Same failure-mode handling as the import route — walk .cause so the
    // operator sees DNS / TLS / connection-refused instead of the
    // generic "fetch failed" wrapper, and surface the redacted URL so
    // they can confirm whether they hit the right host. Server-side log
    // gets full detail; client response gets the first cause plus the
    // remaining chain + redacted URL.
    const causes = causeChain(e);
    const message = causes[0] ?? "Edge Function unreachable";
    console.error(
      "[api/export] fetch to Edge Function failed:",
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
        causes: causes.slice(1),
        url: redactCredentials(EDGE_FN_URL),
      },
      { status: 502 },
    );
  }

  // Parse once — pass through to the client with the same status code.
  // The Edge Function may return either a success payload or an error
  // payload; both are JSON. We forward the status code unchanged so the
  // client UI can distinguish 402 (insufficient credits) from 500 (other
  // failure) from 200 (success).
  let parsed: EdgeSuccessResponse | EdgeErrorResponse;
  try {
    parsed = (await upstream.json()) as EdgeSuccessResponse | EdgeErrorResponse;
  } catch {
    return NextResponse.json(
      { error: "Edge Function returned a non-JSON response" },
      { status: 502 },
    );
  }

  return NextResponse.json(parsed, { status: upstream.status });
}
