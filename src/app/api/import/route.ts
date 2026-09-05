import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

const EDGE_FN_URL =
  process.env.SUPABASE_EDGE_FN_URL ??
  "http://localhost:54321/functions/v1/import-processor";

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
        Authorization: `Bearer ${serviceKey}`,
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
    const message = e instanceof Error ? e.message : "Edge Function unreachable";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // Parse once — pass through to the client with the same status.
  let parsed: EdgeResponse | { error: string };
  try {
    parsed = await upstream.json();
  } catch {
    return NextResponse.json(
      { error: "Edge Function returned a non-JSON response" },
      { status: 502 },
    );
  }

  return NextResponse.json(parsed, { status: upstream.status });
}
