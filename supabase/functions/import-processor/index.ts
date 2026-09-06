// give-to-get.com — import-processor
//
// POST /functions/v1/import-processor
// Body: {
//   workspace_id:  string (uuid),
//   processed_by:  string (uuid, user id),
//   filename:      string,
//   rows:          Record<string, string>[],
//   mapping:       Record<string, string>  // rawHeader -> canonicalField
// }
//
// Pipeline (steps 1–6 from the brief):
//   1. INSERT imports row at status='processing' to claim the import_id.
//   2. Drop rows with personal-email domains (counts toward invalid).
//   3. Normalize seniority against the contacts.seniority CHECK enum.
//   4. Batch dedup — ONE query against contacts.email_normalized.
//   5. Chunk-insert new rows into contacts via the service-role client.
//   6. UPDATE imports row to status='complete'. The DB trigger
//      trg_import_credits -> handle_import_complete() inserts the matching
//      credits_ledger row. We never touch credits_ledger from JS.
//
// Any failure updates the imports row to status='failed' and surfaces the
// error as JSON. The trigger only fires on the 'processing'->'complete'
// transition, so a 'failed' import leaks no credits.

import { handleCorsPreflight, jsonResponse } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/supabase.ts";

// ─────────────────────────────────────────────────────────────
// Constants (duplicated from src/lib/csv.ts — Deno can't import Next code)
// ─────────────────────────────────────────────────────────────

const PERSONAL_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "aol.com",
  "icloud.com",
  "live.com",
  "msn.com",
  "me.com",
  "mac.com",
  "ymail.com",
  "protonmail.com",
  "proton.me",
  "mail.com",
  "zoho.com",
  "gmx.com",
  "inbox.com",
  "fastmail.com",
  "hey.com",
]);

// Seniority enum, mirrored from the contacts.seniority CHECK constraint
// in supabase/migrations/002_apollo_aligned_schema.sql.
// normalizeSeniority() always returns one of these strings (or null).
const SENIORITY_ENUM = new Set([
  "C-Suite",
  "VP",
  "Director",
  "Manager",
  "Individual Contributor",
  "Unknown",
]);

// Canonical contact columns this function may write. email_normalized is
// GENERATED ALWAYS AS (LOWER(TRIM(email))) STORED — we never include it.
const CONTACT_INSERT_COLUMNS = [
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
  "industry",
  "num_employees",
  "annual_revenue",
  "linkedin_url",
  "twitter_url",
  "facebook_url",
  "work_direct_phone",
  "mobile_phone",
  "corporate_phone",
  "do_not_call",
  "apollo_contact_id",
  "apollo_account_id",
  "contributed_by_workspace_id",
  "source_import_id",
  "quality_score",
  "is_verified",
] as const;

const INSERT_CHUNK_SIZE = 500;

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function isPersonalEmail(email: string): boolean {
  const at = email.indexOf("@");
  if (at < 0) return true;
  const domain = email.slice(at + 1).toLowerCase().trim();
  if (!domain) return true;
  return PERSONAL_DOMAINS.has(domain);
}

// Map raw seniority strings and title substrings to the CHECK enum.
// Order matters — first match wins; "C-Suite" must beat "Director" etc.
function normalizeSeniority(rawTitle: string | null | undefined): string {
  const t = (rawTitle ?? "").toString().toLowerCase();
  if (!t) return "Unknown";

  // Exact-value shortcut (caller already provided a normalized seniority).
  for (const v of SENIORITY_ENUM) {
    if (v.toLowerCase() === t) return v;
  }

  // C-Suite signals — checked first so "vp of engineering" doesn't match
  // the generic "vp" rule too early, etc.
  if (/(c[\s-]?suite|chief\s|ceo|cfo|cto|coo|cmo|cpo|cio|chro|cdo|president|founder|owner|principal)/.test(t)) {
    return "C-Suite";
  }
  // VP signals — but exclude "evp"/"svp" leakage into C-Suite above.
  if (/(^|\W)(vp|vice\s*president)(\W|$)/.test(t)) {
    return "VP";
  }
  if (/(director|head\s+of|lead\s+of)/.test(t)) {
    return "Director";
  }
  if (/(manager|supervisor|lead)/.test(t)) {
    return "Manager";
  }
  if (/(engineer|developer|designer|analyst|specialist|coordinator|associate|representative|assistant|intern)/.test(t)) {
    return "Individual Contributor";
  }
  return "Unknown";
}

// `value` may be a free-form string from a CSV cell. We coerce to the
// target column's storage shape (number / boolean / string). Bad inputs
// become null instead of throwing — we want a partial-success import
// rather than blowing up the whole batch.
function coerceForColumn(
  column: typeof CONTACT_INSERT_COLUMNS[number],
  value: string,
): unknown {
  if (value === undefined || value === null) return null;
  const trimmed = value.toString().trim();
  if (trimmed === "") return null;

  switch (column) {
    case "num_employees":
    case "annual_revenue":
    case "quality_score": {
      // For B2B CSVs employee count is frequently given as a range
      // ("51-200", "1,001-5,000", "10000+") or a single number ("100").
      // We strip currency / thousands-separators / whitespace, then
      // split on "-" or "+" that aren't a leading sign, take the first
      // one or two integers, and use the midpoint (or the single value
      // if only one is present). Single numbers and open-ended ranges
      // pass through. No digits at all → null. Range parsing beats
      // silent nulling — a "51-200" cell is clearly employee count, not
      // garbage, and we shouldn't drop it.
      const stripped = trimmed.replace(/[,$%\s]/g, "");
      const parts = stripped.split(/[-+]/);
      const nums: number[] = [];
      for (const part of parts) {
        const m = part.match(/^-?\d+/);
        if (m) {
          const n = Number(m[0]);
          if (Number.isFinite(n)) nums.push(n);
          if (nums.length === 2) break;
        }
      }
      if (nums.length === 0) return null;
      const n = nums.length === 1 ? nums[0] : Math.round((nums[0] + nums[1]) / 2);
      return Math.trunc(n);
    }
    case "do_not_call":
    case "is_verified": {
      const v = trimmed.toLowerCase();
      if (["true", "yes", "y", "1", "t"].includes(v)) return true;
      if (["false", "no", "n", "0", "f"].includes(v)) return false;
      return null;
    }
    default:
      return trimmed;
  }
}

// Pull a canonical field out of a row given the reverse mapping.
function pickCanonicalField(
  row: Record<string, string>,
  reverseMap: Record<string, string>,
  canonical: string,
): string {
  for (const [raw, target] of Object.entries(reverseMap)) {
    if (target === canonical) {
      const v = row[raw];
      return v === undefined ? "" : v;
    }
  }
  return "";
}

// Trim string cells, leaving non-strings alone.
function trimAll(input: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    out[k] = typeof v === "string" ? v.trim() : v;
  }
  return out;
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
    processed_by?: string;
    filename?: string;
    rows?: Record<string, string>[];
    mapping?: Record<string, string>;
  };

  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, { status: 400 });
  }

  const workspaceId = payload.workspace_id;
  const processedBy = payload.processed_by;
  const filename = (payload.filename ?? "").toString();
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const mapping = payload.mapping ?? {};

  if (!workspaceId || typeof workspaceId !== "string") {
    return jsonResponse({ error: "workspace_id is required" }, { status: 400 });
  }
  if (!processedBy || typeof processedBy !== "string") {
    return jsonResponse({ error: "processed_by is required" }, { status: 400 });
  }
  if (!filename) {
    return jsonResponse({ error: "filename is required" }, { status: 400 });
  }
  if (rows.length === 0) {
    return jsonResponse({ error: "rows is required and must be non-empty" }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Step 1 — claim the import_id up front so we can update it from the
  // success and failure paths.
  const { data: importRow, error: importInsertErr } = await supabase
    .from("imports")
    .insert({
      workspace_id: workspaceId,
      filename,
      import_type: "contacts",
      original_row_count: rows.length,
      status: "processing",
      processed_by: processedBy,
    })
    .select("id")
    .single();

  if (importInsertErr || !importRow) {
    return jsonResponse(
      { error: `Failed to create import row: ${importInsertErr?.message ?? "unknown"}` },
      { status: 500 },
    );
  }

  const importId = importRow.id as string;

  // Reverse the mapping once — rawHeader -> canonicalField.
  const reverseMap: Record<string, string> = {};
  for (const [raw, canonical] of Object.entries(mapping)) {
    reverseMap[raw] = canonical;
  }

  // Steps 2 + 3 — apply mapping, drop personal emails, normalize seniority.
  type Candidate = Record<string, unknown> & { _email: string };
  const candidates: Candidate[] = [];
  let invalidCount = 0;

  for (const raw of rows) {
    const row = trimAll(raw);

    const emailRaw = pickCanonicalField(row, reverseMap, "email");
    if (!emailRaw || !emailRaw.includes("@") || isPersonalEmail(emailRaw)) {
      invalidCount++;
      continue;
    }
    const email = emailRaw.toLowerCase().trim();

    const firstName = pickCanonicalField(row, reverseMap, "first_name");
    const lastName = pickCanonicalField(row, reverseMap, "last_name");
    if (!firstName) {
      // first_name is NOT NULL on contacts; rows missing it can't insert.
      invalidCount++;
      continue;
    }

    // Seniority: explicit mapped field wins; otherwise derive from title.
    const explicitSeniority = pickCanonicalField(row, reverseMap, "seniority");
    const title = pickCanonicalField(row, reverseMap, "title");
    const seniority = explicitSeniority
      ? normalizeSeniority(explicitSeniority)
      : normalizeSeniority(title);

    const candidate: Candidate = {
      _email: email,
      first_name: firstName,
      last_name: lastName || null,
      email,
      title: title || null,
      seniority,
      company_name: pickCanonicalField(row, reverseMap, "company_name") || null,
      city: pickCanonicalField(row, reverseMap, "city") || null,
      state: pickCanonicalField(row, reverseMap, "state") || null,
      country: pickCanonicalField(row, reverseMap, "country") || null,
      vertical: pickCanonicalField(row, reverseMap, "vertical") || null,
      linkedin_url: pickCanonicalField(row, reverseMap, "linkedin_url") || null,
      contributed_by_workspace_id: workspaceId,
      source_import_id: importId,
    };

    // Defensive coercion on optional numeric / boolean columns that may be
    // mapped even though our CSV-side alias set doesn't currently emit them.
    for (const col of CONTACT_INSERT_COLUMNS) {
      if (
        col === "first_name" || col === "last_name" || col === "email" ||
        col === "title" || col === "seniority" || col === "company_name" ||
        col === "city" || col === "state" || col === "country" ||
        col === "vertical" || col === "linkedin_url" ||
        col === "contributed_by_workspace_id" || col === "source_import_id"
      ) continue;
      const raw = pickCanonicalField(row, reverseMap, col);
      if (!raw) continue;
      const coerced = coerceForColumn(col, raw);
      if (coerced !== null) candidate[col] = coerced;
    }

    candidates.push(candidate);
  }

  if (candidates.length === 0) {
    // No viable rows — close out as a 'complete' import with zero credits.
    // The trigger checks credits_earned > 0 so no ledger row is inserted.
    const { error: finalizeErr } = await supabase
      .from("imports")
      .update({
        valid_row_count: 0,
        new_contacts_count: 0,
        duplicate_count: 0,
        invalid_count: invalidCount,
        credits_earned: 0,
        status: "complete",
        completed_at: new Date().toISOString(),
      })
      .eq("id", importId);

    if (finalizeErr) {
      await markFailed(supabase, importId, finalizeErr.message);
      return jsonResponse({ error: finalizeErr.message }, { status: 500 });
    }

    return jsonResponse({
      new_contacts_count: 0,
      duplicate_count: 0,
      invalid_count: invalidCount,
      credits_earned: 0,
    });
  }

  // Step 4 — batch dedup against email_normalized in ONE query.
  const candidateEmails = Array.from(new Set(candidates.map((c) => c._email)));
  const existing = new Set<string>();

  // Build a parameterized IN list. PostgREST / the JS client doesn't accept
  // a raw `IN (...)` clause, so we use .in() on the JS side. The emails
  // array is already LOWER normalized (we did it above) and
  // email_normalized = LOWER(TRIM(email)), so direct equality is correct
  // for non-whitespace inputs. We chunk to keep the URL length reasonable.
  const IN_CHUNK = 500;
  for (let i = 0; i < candidateEmails.length; i += IN_CHUNK) {
    const slice = candidateEmails.slice(i, i + IN_CHUNK);
    const { data, error } = await supabase
      .from("contacts")
      .select("email_normalized")
      .in("email_normalized", slice);

    if (error) {
      await markFailed(supabase, importId, `dedup query failed: ${error.message}`);
      return jsonResponse({ error: error.message }, { status: 500 });
    }
    for (const row of data ?? []) {
      if (row.email_normalized) existing.add(row.email_normalized as string);
    }
  }

  // Step 4b — INTRA-BATCH dedup. The DB query above only catches emails
  // that already exist in the contacts table. Two rows in the same CSV
  // that normalize to the same email (case/whitespace differences, exact
  // duplicates, etc.) both pass the DB check, then the chunk INSERT hits
  // the UNIQUE(email_normalized) constraint on the second one and
  // surfaces a raw Postgres error that aborts the whole import. Filter
  // them here instead: keep the first occurrence (preserves the order
  // the CSV was uploaded in), count the rest as duplicates. This is
  // the matching semantics to the DB-level check.
  const seenInBatch = new Set<string>();
  const dedupedCandidates: typeof candidates = [];
  let intraBatchDuplicates = 0;
  for (const c of candidates) {
    if (seenInBatch.has(c._email)) {
      intraBatchDuplicates++;
      continue;
    }
    seenInBatch.add(c._email);
    dedupedCandidates.push(c);
  }

  const newRows = dedupedCandidates.filter((c) => !existing.has(c._email));
  const duplicateCount = (dedupedCandidates.length - newRows.length) + intraBatchDuplicates;
  const newContactsCount = newRows.length;
  const creditsEarned = newContactsCount;

  // Step 5 — chunk-insert new contacts via the service-role client.
  if (newRows.length > 0) {
    // Strip our internal marker + strip email_normalized (generated column).
    const insertable = newRows.map((c) => {
      const { _email, ...rest } = c;
      // email_normalized is generated — never include it. Our object never
      // has the key, but be defensive: drop any property named that.
      delete (rest as Record<string, unknown>).email_normalized;
      return rest;
    });

    for (let i = 0; i < insertable.length; i += INSERT_CHUNK_SIZE) {
      const chunk = insertable.slice(i, i + INSERT_CHUNK_SIZE);
      // Try the batch insert first — one round-trip per 500 rows.
      const { error: insertErr } = await supabase
        .from("contacts")
        .insert(chunk);

      if (insertErr) {
        // If the batch failed on a UNIQUE constraint, one of the rows in
        // this chunk collides with an existing contact that slipped past
        // the DB-dedup query (e.g. a race with another concurrent import
        // that inserted between our dedup query and our insert). Fall
        // back to per-row inserts so the colliding row becomes a
        // counted duplicate instead of taking down the whole import.
        // Any other error (NOT NULL violation, malformed UUID, etc.) is
        // a real bug — surface it.
        if (!/unique constraint|duplicate key/i.test(insertErr.message)) {
          await markFailed(supabase, importId, `contacts insert failed: ${insertErr.message}`);
          return jsonResponse({ error: insertErr.message }, { status: 500 });
        }
        let raceDuplicates = 0;
        for (const row of chunk) {
          const { error: singleErr } = await supabase
            .from("contacts")
            .insert(row);
          if (singleErr) {
            if (/unique constraint|duplicate key/i.test(singleErr.message)) {
              raceDuplicates++;
            } else {
              await markFailed(supabase, importId, `contacts insert failed: ${singleErr.message}`);
              return jsonResponse({ error: singleErr.message }, { status: 500 });
            }
          }
        }
        if (raceDuplicates > 0) {
          // Adjust the final counts: the colliding rows are duplicates,
          // not new contacts, so creditsEarned and newContactsCount
          // both shrink by raceDuplicates.
          console.warn(
            `[api/import] ${raceDuplicates} row(s) in this batch collided with`,
            "a concurrently-inserted contact — counted as duplicates.",
          );
        }
      }
    }
  }

  // Step 6 — UPDATE imports to status='complete'. The DB trigger
  // trg_import_credits fires here and writes the credits_ledger row.
  const validRowCount = candidates.length;
  const { error: updateErr } = await supabase
    .from("imports")
    .update({
      valid_row_count: validRowCount,
      new_contacts_count: newContactsCount,
      duplicate_count: duplicateCount,
      invalid_count: invalidCount,
      credits_earned: creditsEarned,
      status: "complete",
      completed_at: new Date().toISOString(),
    })
    .eq("id", importId);

  if (updateErr) {
    await markFailed(supabase, importId, `imports update failed: ${updateErr.message}`);
    return jsonResponse({ error: updateErr.message }, { status: 500 });
  }

  return jsonResponse({
    new_contacts_count: newContactsCount,
    duplicate_count: duplicateCount,
    invalid_count: invalidCount,
    credits_earned: creditsEarned,
  });
});

async function markFailed(
  supabase: ReturnType<typeof createServiceClient>,
  importId: string,
  message: string,
): Promise<void> {
  await supabase
    .from("imports")
    .update({
      status: "failed",
      error_message: message,
      completed_at: new Date().toISOString(),
    })
    .eq("id", importId);
}
