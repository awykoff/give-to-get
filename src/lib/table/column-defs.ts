// src/lib/table/column-defs.ts
// ---------------------------------------------------------------------------
// Single source of truth for the Contacts/Companies table columns and the
// RPC projection / search-key sets.
//
// CONTACT_COLUMNS and COMPANY_COLUMNS are copied VERBATIM (keys, labels,
// types, widths, gated flags) from the reviewed mockup:
//   ~/Downloads/contacts_companies_redesign.jsx
// That file is the locked, Aaron/Claude-reviewed source of truth for the
// column shape. Do NOT re-derive, re-count, or hand-edit this array against
// the migration or from memory — if a real column changes, update BOTH the
// schema and these defs together.
//
// Column counts (twice-independently-verified): contacts 60, companies 33.
// NO contact fields are gated by viewing (policy reversal, this session):
// no field from an uploaded CSV is gated — including email and last_name.
// Credits gate export/download only, never visibility. All 60 contact fields
// are displayable.
// Email-METADATA fields (email_status, email_source, email_verification_source,
// email_confidence, email_catch_all_status, email_last_verified_at,
// secondary_email_source, secondary_email_status, tertiary_email_source,
// tertiary_email_status) are exposed like any other CSV-sourced field.
//
// Derived exports:
//   CONTACT_PROJECTION  — id + contributed_by_workspace_id + all contact keys.
//     Passed to .select() after the search_contacts RPC. No columns are gated
//     by viewing (policy reversal), so the full row including email and
//     last_name reaches the client. Migration 015 returns SETOF contacts via
//     SELECT c.*, which already includes them.
//   COMPANY_PROJECTION  — id + all company keys (companies have no email
//     columns; return everything).
//   CONTACT_COLUMNS / COMPANY_COLUMNS — the full column definitions.
// ---------------------------------------------------------------------------

export type ColumnDef = {
  key: string;
  label: string;
  type: "text" | "number" | "date" | "bool" | "array" | "url";
  width: number;
  gated?: boolean;
};

// --- Contacts (60 columns) — verbatim from mockup ---
export const CONTACT_COLUMNS: ColumnDef[] = [
  { key: "first_name", label: "First Name", type: "text", width: 120 },
  { key: "last_name", label: "Last Name", type: "text", width: 120 },
  { key: "email", label: "Email", type: "text", width: 170 },
  { key: "email_normalized", label: "Email (Normalized)", type: "text", width: 190 },
  { key: "email_status", label: "Email Status", type: "text", width: 130 },
  { key: "email_source", label: "Email Source", type: "text", width: 140 },
  { key: "email_verification_source", label: "Email Verification Source", type: "text", width: 200 },
  { key: "email_confidence", label: "Email Confidence", type: "number", width: 150 },
  { key: "email_catch_all_status", label: "Catch-All Status", type: "text", width: 150 },
  { key: "email_last_verified_at", label: "Email Last Verified", type: "date", width: 160 },
  { key: "secondary_email", label: "Secondary Email", type: "text", width: 180 },
  { key: "secondary_email_source", label: "Secondary Email Source", type: "text", width: 200 },
  { key: "secondary_email_status", label: "Secondary Email Status", type: "text", width: 200 },
  { key: "tertiary_email", label: "Tertiary Email", type: "text", width: 170 },
  { key: "tertiary_email_source", label: "Tertiary Email Source", type: "text", width: 190 },
  { key: "tertiary_email_status", label: "Tertiary Email Status", type: "text", width: 190 },
  { key: "title", label: "Title", type: "text", width: 190 },
  { key: "seniority", label: "Seniority", type: "text", width: 120 },
  { key: "departments", label: "Departments", type: "array", width: 180 },
  { key: "sub_departments", label: "Sub-Departments", type: "array", width: 180 },
  { key: "company_name", label: "Company", type: "text", width: 180 },
  { key: "work_direct_phone", label: "Work Direct Phone", type: "text", width: 160 },
  { key: "mobile_phone", label: "Mobile Phone", type: "text", width: 150 },
  { key: "corporate_phone", label: "Corporate Phone", type: "text", width: 160 },
  { key: "home_phone", label: "Home Phone", type: "text", width: 140 },
  { key: "other_phone", label: "Other Phone", type: "text", width: 140 },
  { key: "do_not_call", label: "Do Not Call", type: "bool", width: 120 },
  { key: "linkedin_url", label: "LinkedIn", type: "url", width: 190 },
  { key: "twitter_url", label: "Twitter / X", type: "url", width: 170 },
  { key: "facebook_url", label: "Facebook", type: "url", width: 170 },
  { key: "city", label: "City", type: "text", width: 130 },
  { key: "state", label: "State", type: "text", width: 100 },
  { key: "country", label: "Country", type: "text", width: 140 },
  { key: "industry", label: "Industry", type: "text", width: 190 },
  { key: "vertical", label: "Vertical", type: "text", width: 130 },
  { key: "keywords", label: "Keywords", type: "array", width: 230 },
  { key: "technologies", label: "Technologies", type: "array", width: 220 },
  { key: "company_city", label: "Company City", type: "text", width: 150 },
  { key: "company_state", label: "Company State", type: "text", width: 140 },
  { key: "company_country", label: "Company Country", type: "text", width: 160 },
  { key: "company_address", label: "Company Address", type: "text", width: 230 },
  { key: "company_phone", label: "Company Phone", type: "text", width: 150 },
  { key: "num_employees", label: "Employees", type: "number", width: 110 },
  { key: "annual_revenue", label: "Annual Revenue", type: "number", width: 150 },
  { key: "total_funding", label: "Total Funding", type: "number", width: 150 },
  { key: "latest_funding", label: "Latest Funding Round", type: "text", width: 190 },
  { key: "latest_funding_amount", label: "Latest Funding Amount", type: "number", width: 200 },
  { key: "last_raised_at", label: "Last Raised", type: "date", width: 130 },
  { key: "stage", label: "Stage", type: "text", width: 130 },
  { key: "lists", label: "Lists", type: "array", width: 190 },
  { key: "last_contacted", label: "Last Contacted", type: "date", width: 150 },
  { key: "email_sent", label: "Email Sent", type: "bool", width: 110 },
  { key: "email_open", label: "Email Opened", type: "bool", width: 130 },
  { key: "email_bounced", label: "Email Bounced", type: "bool", width: 140 },
  { key: "replied", label: "Replied", type: "bool", width: 110 },
  { key: "demoed", label: "Demoed", type: "bool", width: 110 },
  { key: "quality_score", label: "Quality Score", type: "number", width: 130 },
  { key: "is_verified", label: "Verified", type: "bool", width: 110 },
  { key: "created_at", label: "Created", type: "date", width: 120 },
  { key: "updated_at", label: "Updated", type: "date", width: 120 },
];

// --- Companies (33 columns) — verbatim from mockup ---
export const COMPANY_COLUMNS: ColumnDef[] = [
  { key: "name", label: "Name", type: "text", width: 190 },
  { key: "name_for_emails", label: "Name (For Emails)", type: "text", width: 190 },
  { key: "website", label: "Website", type: "url", width: 190 },
  { key: "domain", label: "Domain", type: "text", width: 160 },
  { key: "num_employees", label: "Employees", type: "number", width: 110 },
  { key: "industry", label: "Industry", type: "text", width: 190 },
  { key: "keywords", label: "Keywords", type: "array", width: 230 },
  { key: "sic_codes", label: "SIC Codes", type: "array", width: 150 },
  { key: "naics_codes", label: "NAICS Codes", type: "array", width: 160 },
  { key: "short_description", label: "Description", type: "text", width: 300 },
  { key: "founded_year", label: "Founded", type: "number", width: 100 },
  { key: "number_of_retail_locs", label: "Retail Locations", type: "number", width: 150 },
  { key: "annual_revenue", label: "Annual Revenue", type: "number", width: 150 },
  { key: "total_funding", label: "Total Funding", type: "number", width: 150 },
  { key: "latest_funding", label: "Latest Funding Round", type: "text", width: 190 },
  { key: "latest_funding_amount", label: "Latest Funding Amount", type: "number", width: 200 },
  { key: "last_raised_at", label: "Last Raised", type: "date", width: 130 },
  { key: "street", label: "Street", type: "text", width: 190 },
  { key: "city", label: "City", type: "text", width: 130 },
  { key: "state", label: "State", type: "text", width: 100 },
  { key: "country", label: "Country", type: "text", width: 140 },
  { key: "postal_code", label: "Postal Code", type: "text", width: 120 },
  { key: "address", label: "Full Address", type: "text", width: 260 },
  { key: "phone", label: "Phone", type: "text", width: 150 },
  { key: "linkedin_url", label: "LinkedIn", type: "url", width: 190 },
  { key: "facebook_url", label: "Facebook", type: "url", width: 170 },
  { key: "twitter_url", label: "Twitter / X", type: "url", width: 170 },
  { key: "logo_url", label: "Logo URL", type: "url", width: 180 },
  { key: "technologies", label: "Technologies", type: "array", width: 220 },
  { key: "subsidiary_of", label: "Subsidiary Of", type: "text", width: 180 },
  { key: "quality_score", label: "Quality Score", type: "number", width: 130 },
  { key: "created_at", label: "Created", type: "date", width: 120 },
  { key: "updated_at", label: "Updated", type: "date", width: 120 },
];

// Projection for search_contacts: id + contributed_by_workspace_id + every
// contact column. No columns are gated (policy reversal), so the full row
// including email and last_name reaches the client. contributed_by_workspace_id
// is carried even though it is not rendered — needed under the hood for the
// still-pending My Network partner-filter rewire.
export const CONTACT_PROJECTION: readonly string[] = [
  "id",
  "contributed_by_workspace_id",
  ...CONTACT_COLUMNS.map((c) => c.key),
];

// Companies have no gated columns; return id + everything.
export const COMPANY_PROJECTION: readonly string[] = [
  "id",
  ...COMPANY_COLUMNS.map((c) => c.key),
];

// Always-visible search caption (v2 locked copy; same for both tables).
export const SEARCH_CAPTION =
  "Searches every field below — name, title, company, location, industry, keywords, technologies, and more. Paste a full email for an exact match.";

// Search caption + exact-match hint are unconditional now (no gated fields
// to gate them on) — see DataTable.tsx's hasGatedColumns handling.

export function assertColumnCounts() {
  if (CONTACT_COLUMNS.length !== 60)
    throw new Error(`CONTACT_COLUMNS has ${CONTACT_COLUMNS.length}, expected 60`);
  if (COMPANY_COLUMNS.length !== 33)
    throw new Error(`COMPANY_COLUMNS has ${COMPANY_COLUMNS.length}, expected 33`);
  const gated = CONTACT_COLUMNS.filter((c) => c.gated).map((c) => c.key);
  if (gated.length !== 0)
    throw new Error(`contact gating detected: ${gated.join(",")} — expected zero gated fields (no CSV-sourced field is gated by viewing)`);
}