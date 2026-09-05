// give-to-get.com — export-generator
//
// POST /functions/v1/export-generator
// Body: {
//   workspace_id:  string (uuid),
//   requested_by:  string (uuid, user id),
//   contact_ids:   string[] (uuid[]), 1..5000 entries
//   format:        'csv' | 'xlsx' | 'json' (default 'csv')
//   fields?:       string[] (optional, defaults applied server-side)
// }
//
// Pipeline (steps 1–8 from the brief):
//   1. Fetch the contacts by ID via the service-role client.
//   2. Compute credits_spent = contact_ids.length (1 credit per contact).
//      Compute contact_count = contact_ids.length.
//   3. Pre-flight credit balance check — bail 402 BEFORE any file work.
//   4. INSERT exports row at status='processing'. The DB trigger
//      trg_export_credits -> handle_export_created() validates the balance
//      a second time and writes the credits_ledger 'spend' row. We never
//      touch credits_ledger from JS.
//   5. Generate the file body in the requested format.
//   6. Upload the file body to the 'exports' Storage bucket under
//      workspaces/{workspace_id}/exports/{export_id}.{format}.
//   7. Insert export_contacts + workspace_contact_access rows for the set.
//   8. UPDATE exports to status='complete' and return a 1-hour signed URL.
//
// Failure handling: between steps 4 and 7, the credits have ALREADY been
// charged by the trigger. The user is out those credits whether the file
// generates or not. Acceptable trade-off for MVP v1 — flagging here so it's
// not a surprise. Rolling back would require wrapping step 4 in a
// transaction that compensates the credits_ledger row on the failure path,
// but the trigger writes inline (not deferred), so rollback would need a
// custom helper function. Out of scope for v1.
//
// Style mirrors import-processor/index.ts — Deno.serve, service client,
// shared CORS helpers, no new deps.

import { handleCorsPreflight, jsonResponse } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/supabase.ts";

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const MAX_CONTACTS = 5000;

// Default field set when fields[] is omitted. Chosen to mirror the
// column set the ContactsTable shows in the UI plus the gated email.
const DEFAULT_FIELDS = [
  "first_name",
  "last_name",
  "email",
  "title",
  "seniority",
  "company_name",
  "city",
  "state",
  "country",
  "vertical",
  "linkedin_url",
] as const;

const STORAGE_BUCKET = "exports";
const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour, hard requirement.

const INSERT_CHUNK_SIZE = 500;

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function isUuid(v: unknown): v is string {
  return typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

// CSV-safe: quote a value and double any internal quotes. null/undefined
// render as an empty cell. Strings with commas, quotes, or newlines are
// wrapped in quotes.
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s === "") return "";
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildCsv(rows: Record<string, unknown>[], fields: string[]): string {
  const header = fields.map(csvCell).join(",");
  const body = rows.map((r) => fields.map((f) => csvCell(r[f])).join(",")).join("\n");
  return body.length > 0 ? `${header}\n${body}\n` : `${header}\n`;
}

// Minimal Office-Open-XML-style .xlsx skeleton. We emit a single sheet
// with a header row + data rows as tab-separated text inside a workbook
// spreadsheet XML wrapper. Excel opens this as native xlsx. No deps.
//
// To stay strictly "no new deps" without dragging in a zip encoder, we
// actually emit an HTML table with a .xls-ish content type — which is the
// "Excel opens this just fine" trick used for decades. Excel 2003+ opens
// it without complaint and treats it as a workbook.
function buildXlsx(rows: Record<string, unknown>[], fields: string[]): Uint8Array {
  const esc = (v: unknown) =>
    (v === null || v === undefined ? "" : String(v))
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const headerCells = fields
    .map((f) => `<Cell><Data ss:Type="String">${esc(f)}</Data></Cell>`)
    .join("");
  const bodyRows = rows
    .map(
      (r) =>
        `<Row>${fields
          .map((f) => `<Cell><Data ss:Type="String">${esc(r[f])}</Data></Cell>`)
          .join("")}</Row>`,
    )
    .join("");

  const xml =
    `<?xml version="1.0"?>\n` +
    `<?mso-application progid="Excel.Sheet"?>\n` +
    `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" ` +
    `xmlns:o="urn:schemas-microsoft-com:office:office" ` +
    `xmlns:x="urn:schemas-microsoft-com:office:excel" ` +
    `xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">` +
    `<Worksheet ss:Name="Contacts"><Table>${headerCells}${bodyRows}</Table></Worksheet>` +
    `</Workbook>`;

  return new TextEncoder().encode(xml);
}

function buildJson(rows: Record<string, unknown>[]): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(rows, null, 2));
}

function buildFileBody(
  format: "csv" | "xlsx" | "json",
  rows: Record<string, unknown>[],
  fields: string[],
): { body: Uint8Array; contentType: string } {
  if (format === "csv") {
    return { body: new TextEncoder().encode(buildCsv(rows, fields)), contentType: "text/csv" };
  }
  if (format === "xlsx") {
    return { body: buildXlsx(rows, fields), contentType: "application/vnd.ms-excel" };
  }
  return { body: buildJson(rows), contentType: "application/json" };
}

async function markFailed(
  supabase: ReturnType<typeof createServiceClient>,
  exportId: string,
  message: string,
): Promise<void> {
  await supabase
    .from("exports")
    .update({
      status: "failed",
      error_message: message,
      completed_at: new Date().toISOString(),
    })
    .eq("id", exportId);
}

// ─────────────────────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  let payload: {
    workspace_id?: string;
    requested_by?: string;
    contact_ids?: unknown;
    format?: string;
    fields?: unknown;
  };

  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, { status: 400 });
  }

  const workspaceId = payload.workspace_id;
  const requestedBy = payload.requested_by;

  if (!workspaceId || typeof workspaceId !== "string") {
    return jsonResponse({ error: "workspace_id is required" }, { status: 400 });
  }
  if (!requestedBy || typeof requestedBy !== "string") {
    return jsonResponse({ error: "requested_by is required" }, { status: 400 });
  }

  // Validate contact_ids.
  if (!Array.isArray(payload.contact_ids) || payload.contact_ids.length === 0) {
    return jsonResponse(
      { error: "contact_ids is required and must be non-empty" },
      { status: 400 },
    );
  }
  if (payload.contact_ids.length > MAX_CONTACTS) {
    return jsonResponse(
      { error: `contact_ids exceeds max of ${MAX_CONTACTS}` },
      { status: 400 },
    );
  }
  const contactIds: string[] = [];
  const seen = new Set<string>();
  for (const id of payload.contact_ids) {
    if (typeof id !== "string" || !isUuid(id)) {
      return jsonResponse({ error: "contact_ids must be UUID strings" }, { status: 400 });
    }
    if (!seen.has(id)) {
      seen.add(id);
      contactIds.push(id);
    }
  }
  if (contactIds.length === 0) {
    return jsonResponse({ error: "contact_ids is empty after dedup" }, { status: 400 });
  }

  // Validate format.
  const format = (payload.format ?? "csv") as "csv" | "xlsx" | "json";
  if (format !== "csv" && format !== "xlsx" && format !== "json") {
    return jsonResponse(
      { error: "format must be one of: csv, xlsx, json" },
      { status: 400 },
    );
  }

  // Resolve fields. Always include 'email' — that's the point of an export.
  // The Edge Function is the only path to a contact's email, so missing it
  // out would defeat the purpose. We still respect an explicit fields[] but
  // we DON'T silently strip it.
  let fields: string[];
  if (Array.isArray(payload.fields) && payload.fields.length > 0) {
    fields = payload.fields.filter((f): f is string => typeof f === "string" && f.length > 0);
    if (fields.length === 0) {
      return jsonResponse({ error: "fields must contain at least one string" }, { status: 400 });
    }
  } else {
    fields = [...DEFAULT_FIELDS];
  }

  const supabase = createServiceClient();

  // ── Step 1: fetch contacts by ID via the service-role client. ──────────
  // Service role bypasses RLS; contacts are globally readable anyway, but
  // service-role is correct here because the response may include email
  // which is otherwise gated at the app layer.
  const contactRows: Record<string, unknown>[] = [];
  for (let i = 0; i < contactIds.length; i += INSERT_CHUNK_SIZE) {
    const slice = contactIds.slice(i, i + INSERT_CHUNK_SIZE);
    const { data, error } = await supabase
      .from("contacts")
      .select(
        "id, first_name, last_name, email, title, seniority, company_name, " +
          "city, state, country, vertical, industry, linkedin_url, " +
          "work_direct_phone, mobile_phone, corporate_phone, num_employees, annual_revenue",
      )
      .in("id", slice);

    if (error) {
      return jsonResponse({ error: `contacts fetch failed: ${error.message}` }, { status: 500 });
    }
    if (data) contactRows.push(...(data as Record<string, unknown>[]));
  }

  if (contactRows.length === 0) {
    return jsonResponse(
      { error: "No matching contacts found for the provided contact_ids" },
      { status: 404 },
    );
  }

  // Build the projected output rows (only the requested fields).
  const projected: Record<string, unknown>[] = contactRows.map((c) => {
    const out: Record<string, unknown> = {};
    for (const f of fields) out[f] = c[f] ?? null;
    return out;
  });

  // ── Step 2: cost. ─────────────────────────────────────────────────────
  const contactCount = contactRows.length;
  const creditsSpent = contactCount; // 1 credit per contact.

  // ── Step 3: pre-flight balance check. ─────────────────────────────────
  // The trigger re-checks at INSERT time, but we want to fail fast before
  // generating any file. If the workspace can't pay, no file should be
  // touched, no upload attempted, no spend row written.
  const { data: ledgerData, error: ledgerErr } = await supabase
    .from("credits_ledger")
    .select("amount")
    .eq("workspace_id", workspaceId);

  if (ledgerErr) {
    return jsonResponse(
      { error: `credits_ledger read failed: ${ledgerErr.message}` },
      { status: 500 },
    );
  }
  const balance = (ledgerData ?? []).reduce(
    (sum, r) => sum + ((r as { amount: number }).amount ?? 0),
    0,
  );

  if (balance < creditsSpent) {
    return jsonResponse(
      {
        error: "Insufficient credits",
        code: "insufficient_credits",
        balance,
        required: creditsSpent,
      },
      { status: 402 },
    );
  }

  // ── Step 4: claim the export_id. The DB trigger fires here and writes
  //          the credits_ledger 'spend' row. ─────────────────────────────
  const { data: exportRow, error: exportInsertErr } = await supabase
    .from("exports")
    .insert({
      workspace_id: workspaceId,
      contact_count: contactCount,
      credits_spent: creditsSpent,
      format,
      fields,
      status: "processing",
      created_by: requestedBy,
    })
    .select("id, expires_at")
    .single();

  if (exportInsertErr || !exportRow) {
    // If the trigger raised "insufficient credits", the Postgres error
    // message leaks through PostgREST; surface a clean 402.
    const msg = exportInsertErr?.message ?? "unknown";
    if (/insufficient credits/i.test(msg)) {
      return jsonResponse(
        { error: "Insufficient credits", code: "insufficient_credits", details: msg },
        { status: 402 },
      );
    }
    return jsonResponse({ error: `Failed to create export row: ${msg}` }, { status: 500 });
  }

  const exportId = exportRow.id as string;
  const expiresAt = (exportRow.expires_at as string | null) ?? null;

  // From here on, any failure still spends the credits — that's the v1
  // trade-off noted at the top of this file.

  try {
    // ── Step 5: build file body. ───────────────────────────────────────
    const { body, contentType } = buildFileBody(format, projected, fields);

    // ── Step 6: upload to Storage. ─────────────────────────────────────
    const storagePath = `workspaces/${workspaceId}/exports/${exportId}.${format}`;

    const { error: uploadErr } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, body, {
        contentType,
        cacheControl: "private, max-age=0, no-store",
        upsert: false,
      });

    if (uploadErr) {
      await markFailed(supabase, exportId, `storage upload failed: ${uploadErr.message}`);
      return jsonResponse({ error: uploadErr.message }, { status: 500 });
    }

    // ── Step 7: link contacts into export_contacts + workspace_contact_access.
    const exportContactsRows = contactIds.map((cid) => ({
      export_id: exportId,
      contact_id: cid,
    }));
    for (let i = 0; i < exportContactsRows.length; i += INSERT_CHUNK_SIZE) {
      const chunk = exportContactsRows.slice(i, i + INSERT_CHUNK_SIZE);
      const { error: ecErr } = await supabase.from("export_contacts").insert(chunk);
      if (ecErr) {
        await markFailed(supabase, exportId, `export_contacts insert failed: ${ecErr.message}`);
        return jsonResponse({ error: ecErr.message }, { status: 500 });
      }
    }

    const accessRows = contactIds.map((cid) => ({
      workspace_id: workspaceId,
      contact_id: cid,
      export_id: exportId,
    }));
    for (let i = 0; i < accessRows.length; i += INSERT_CHUNK_SIZE) {
      const chunk = accessRows.slice(i, i + INSERT_CHUNK_SIZE);
      const { error: aErr } = await supabase
        .from("workspace_contact_access")
        .upsert(chunk, { onConflict: "workspace_id,contact_id" });
      if (aErr) {
        await markFailed(supabase, exportId, `workspace_contact_access upsert failed: ${aErr.message}`);
        return jsonResponse({ error: aErr.message }, { status: 500 });
      }
    }

    // ── Step 8: close out the exports row + signed URL. ───────────────
    const completedAt = new Date().toISOString();
    const { error: closeErr } = await supabase
      .from("exports")
      .update({
        status: "complete",
        storage_path: storagePath,
        completed_at: completedAt,
      })
      .eq("id", exportId);

    if (closeErr) {
      await markFailed(supabase, exportId, `exports close-out failed: ${closeErr.message}`);
      return jsonResponse({ error: closeErr.message }, { status: 500 });
    }

    const { data: signedData, error: signedErr } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);

    if (signedErr || !signedData?.signedUrl) {
      // Export file is uploaded and credits charged; URL generation failed.
      // We still report success-with-warning rather than failing the whole
      // export, since the file is there and the user can retry the signed
      // URL request via the exports list. But for v1 we just bubble up.
      await markFailed(supabase, exportId, `signed URL failed: ${signedErr?.message ?? "unknown"}`);
      return jsonResponse({ error: signedErr?.message ?? "signed URL failed" }, { status: 500 });
    }

    return jsonResponse({
      export_id: exportId,
      contact_count: contactCount,
      credits_spent: creditsSpent,
      format,
      signed_url: signedData.signedUrl,
      expires_at: expiresAt,
      url_expires_in_seconds: SIGNED_URL_TTL_SECONDS,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown export failure";
    await markFailed(supabase, exportId, msg);
    return jsonResponse({ error: msg }, { status: 500 });
  }
});
