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

  const headers = splitRow(nonEmpty[0]).map((h) => h.toLowerCase().replace(/\s+/g, "_"));
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
  vertical: "vertical", industry: "vertical",
  seniority: "seniority", seniority_level: "seniority", level: "seniority",
  city: "city", state: "state", country: "country",
  location: "city",
  company_size: "company_size", employees: "company_size",
  phone: "phone", phone_number: "phone",
  linkedin: "linkedin_url", linkedin_url: "linkedin_url",
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
export const OPTIONAL_FIELDS = ["title", "company_name", "vertical", "seniority", "city", "state", "country", "company_size", "phone", "linkedin_url"];
