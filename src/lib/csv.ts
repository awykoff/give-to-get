// Minimal RFC 4180-compliant CSV parser
export function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const nonEmpty = lines.filter((l) => l.trim() !== "");
  if (nonEmpty.length === 0) return { headers: [], rows: [] };

  const splitRow = (line: string): string[] => {
    const cells: string[] = [];
    let cur = "";
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
        else { inQuote = !inQuote; }
      } else if (ch === "," && !inQuote) {
        cells.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    cells.push(cur.trim());
    return cells;
  };

  // ZoomInfo exports "Company Name" as BOTH column 1 and column 19 (and
  // other providers may duplicate headers too). Object.fromEntries below
  // would keep the LAST duplicate, silently overwriting col 1's value.
  // Deduplicate normalized header names by appending _2, _3, ... so the
  // FIRST occurrence maps (matching ALIASES) and repeats are ignored — their
  // suffixed key won't match any alias.
  const rawHeaders = splitRow(nonEmpty[0]).map((h) => h.toLowerCase().replace(/\s+/g, "_"));
  const seen = new Map<string, number>();
  const headers = rawHeaders.map((h) => {
    const n = (seen.get(h) ?? 0) + 1;
    seen.set(h, n);
    return n === 1 ? h : `${h}_${n}`;
  });
  const rows = nonEmpty.slice(1).map((line) => {
    const cells = splitRow(line);
    return Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? ""]));
  });

  return { headers, rows };
}

const PERSONAL_DOMAINS = new Set([
  "gmail.com","yahoo.com","hotmail.com","outlook.com","aol.com","icloud.com",
  "live.com","msn.com","me.com","mac.com","ymail.com","protonmail.com",
  "mail.com","zoho.com","gmx.com","inbox.com","fastmail.com","hey.com",
]);

export function isPersonalEmail(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  return !domain || PERSONAL_DOMAINS.has(domain);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Canonical column aliases → our field names
const ALIASES: Record<string, string> = {
  first_name: "first_name", firstname: "first_name", first: "first_name",
  last_name: "last_name", lastname: "last_name", last: "last_name",
  email: "email", email_address: "email", work_email: "email",
  title: "title", job_title: "title", position: "title",
  company: "company_name", company_name: "company_name", organization: "company_name",
  vertical: "vertical", industry: "vertical", primary_industry: "vertical",
  seniority: "seniority", seniority_level: "seniority", level: "seniority",
  management_level: "seniority",
  company_city: "company_city", company_state: "company_state", company_country: "company_country",
  company_street_address: "company_address", company_hq_phone: "company_phone",
  total_funding: "total_funding",
  revenue_in_000s: "annual_revenue",
  technologies: "technologies", all_sub_industries: "keywords", all_industries: "keywords",
  city: "city", state: "state", country: "country",
  location: "city", person_city: "city", person_state: "state",
  num_employees: "num_employees", employees: "num_employees", company_size: "num_employees", "#_employees": "num_employees",
  work_direct_phone: "work_direct_phone", direct_phone_number: "work_direct_phone", desk_phone: "work_direct_phone",
  mobile_phone: "mobile_phone",
  phone: "phone", phone_number: "phone",
  linkedin: "linkedin_url", linkedin_url: "linkedin_url", linkedin_contact_profile_url: "linkedin_url",
};

export function mapHeaders(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const h of headers) {
    const canonical = ALIASES[h];
    if (canonical) mapping[h] = canonical;
  }
  return mapping;
}

export const REQUIRED_FIELDS = ["first_name", "last_name", "email"];
// All canonical optional fields the ALIASES map can produce, i.e. the full
// set of optional contact columns a CSV header may map to. Drives the
// ImportReview column-detection UI ("+ optional" chips) + preview columns.
// Keep in sync with the ALIASES destinations so the review screen shows a
// user everything a ZoomInfo-style export can populate.
// NOTE: "phone" is a pre-existing alias whose canonical field doesn't exist
// in the schema (no contacts.phone column) — flagged as follow-up cleanup.
export const OPTIONAL_FIELDS = [
  "title", "company_name", "vertical", "seniority",
  "city", "state", "country", "num_employees",
  "phone", "linkedin_url",                 // legacy set
  "company_city", "company_state", "company_country",
  "company_address", "company_phone",
  "annual_revenue", "total_funding",
  "technologies", "keywords", "departments",
  "work_direct_phone", "mobile_phone",
];
