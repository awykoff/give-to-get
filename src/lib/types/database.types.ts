// src/lib/types/database.types.ts
//
// Hand-written Database type for give-to-get.com, derived from
// supabase/migrations/002_apollo_aligned_schema.sql (the canonical schema).
//
// This is intentionally MINIMAL — it covers the 9 tables in 002 plus
// Insert/Update shapes for the two tables the import pipeline writes to
// (`contacts`, `imports`). Columns whose exact shape I'd be guessing at
// are deliberately omitted from the Insert type rather than fabricated.
// When `supabase gen types typescript` is wired up in CI, this file will
// be regenerated wholesale from the live schema.
//
// snake_case columns, no @supabase/supabase-js dependency type — the
// generic <Database> parameter on createClient<Database>() picks this up.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// ─────────────────────────────────────────────────────────────
// Row shapes (what comes back from .select())
// ─────────────────────────────────────────────────────────────

export interface WorkspacesRow {
  id: string;
  name: string;
  slug: string;
  owner_user_id: string | null;
  plan: "free" | "pro" | "team" | "enterprise";
  stripe_customer_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceMembersRow {
  id: string;
  workspace_id: string;
  user_id: string;
  role: "admin" | "member";
  invited_by: string | null;
  created_at: string;
}

export interface CompaniesRow {
  id: string;
  name: string;
  // Remaining columns intentionally omitted — see file header. Add as
  // needed when this table starts being read or written.
  created_at: string;
  updated_at: string;
}

export interface ContactsRow {
  id: string;

  // Identity
  first_name: string;
  last_name: string | null;
  email: string;
  email_normalized: string;

  // Professional
  title: string | null;
  seniority:
    | "C-Suite"
    | "VP"
    | "Director"
    | "Manager"
    | "Individual Contributor"
    | "Unknown"
    | null;

  // Company (denormalized)
  company_name: string | null;
  company_id: string | null;

  // Location
  city: string | null;
  state: string | null;
  country: string | null;

  // Industry
  industry: string | null;
  vertical: string | null;

  // Firmographics
  num_employees: number | null;
  annual_revenue: number | null;

  // Social
  linkedin_url: string | null;
  twitter_url: string | null;
  facebook_url: string | null;

  // Phones
  work_direct_phone: string | null;
  mobile_phone: string | null;
  corporate_phone: string | null;
  do_not_call: boolean | null;

  // Apollo IDs
  apollo_contact_id: string | null;
  apollo_account_id: string | null;

  // Provenance
  contributed_by_workspace_id: string | null;
  source_import_id: string | null;

  // Quality
  quality_score: number | null;
  is_verified: boolean | null;

  created_at: string;
  updated_at: string;
}

export interface ImportsRow {
  id: string;
  workspace_id: string;
  filename: string;
  import_type: "contacts" | "companies" | "mixed";
  original_row_count: number | null;
  valid_row_count: number | null;
  new_contacts_count: number | null;
  duplicate_count: number | null;
  invalid_count: number | null;
  new_companies_count: number | null;
  credits_earned: number | null;
  status: "pending" | "processing" | "complete" | "failed";
  error_message: string | null;
  storage_path: string | null;
  processed_by: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface ExportsRow {
  id: string;
  workspace_id: string;
  contact_count: number;
  credits_spent: number;
  filters: Json | null;
  format: "csv" | "xlsx" | "json";
  fields: string[] | null;
  storage_path: string | null;
  status: "pending" | "processing" | "complete" | "failed";
  created_by: string | null;
  created_at: string;
  completed_at: string | null;
  expires_at: string | null;
}

export interface ExportContactsRow {
  export_id: string;
  contact_id: string;
}

export interface CreditsLedgerRow {
  id: string;
  workspace_id: string;
  type: "earn" | "spend" | "bonus" | "refund" | "adjustment";
  amount: number;
  description: string;
  reference_id: string | null;
  reference_type: "import" | "export" | "referral" | "signup" | "manual" | null;
  balance_after: number;
  created_by: string | null;
  created_at: string;
}

export interface WorkspaceContactAccessRow {
  workspace_id: string;
  contact_id: string;
  export_id: string | null;
  unlocked_at: string;
}

// user_profiles — Settings profile surface. Per-user; one row per
// auth.users id; RLS-owned; permanently walled off from contacts.
// Schema: supabase/migrations/007_user_profiles.sql.
export interface UserProfilesRow {
  user_id: string;
  first_name: string;
  last_name: string;
  phone_number: string | null;
  created_at: string;
  updated_at: string;
}

// ─────────────────────────────────────────────────────────────
// Insert / Update shapes
//
// Fields whose exact shape we're not certain about are omitted on purpose
// (see file header) — better to force the caller to know what they're
// sending than to ship a guess.
// ─────────────────────────────────────────────────────────────

export interface ContactsInsert {
  first_name: string;
  last_name?: string | null;
  email: string;
  title?: string | null;
  seniority?: ContactsRow["seniority"];
  company_name?: string | null;
  company_id?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  industry?: string | null;
  vertical?: string | null;
  num_employees?: number | null;
  annual_revenue?: number | null;
  linkedin_url?: string | null;
  twitter_url?: string | null;
  facebook_url?: string | null;
  work_direct_phone?: string | null;
  mobile_phone?: string | null;
  corporate_phone?: string | null;
  do_not_call?: boolean | null;
  apollo_contact_id?: string | null;
  apollo_account_id?: string | null;
  contributed_by_workspace_id?: string | null;
  source_import_id?: string | null;
  quality_score?: number | null;
  is_verified?: boolean | null;
  // email_normalized is GENERATED ALWAYS AS (LOWER(TRIM(email))) STORED —
  // never included on insert.
}

export interface ContactsUpdate {
  first_name?: string;
  last_name?: string | null;
  email?: string;
  title?: string | null;
  seniority?: ContactsRow["seniority"];
  company_name?: string | null;
  company_id?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  industry?: string | null;
  vertical?: string | null;
  num_employees?: number | null;
  annual_revenue?: number | null;
  linkedin_url?: string | null;
  twitter_url?: string | null;
  facebook_url?: string | null;
  work_direct_phone?: string | null;
  mobile_phone?: string | null;
  corporate_phone?: string | null;
  do_not_call?: boolean | null;
  quality_score?: number | null;
  is_verified?: boolean | null;
}

export interface ImportsInsert {
  workspace_id: string;
  filename: string;
  import_type?: ImportsRow["import_type"];
  original_row_count?: number | null;
  status?: ImportsRow["status"];
  processed_by?: string | null;
  storage_path?: string | null;
}

export interface ImportsUpdate {
  filename?: string;
  import_type?: ImportsRow["import_type"];
  original_row_count?: number | null;
  valid_row_count?: number | null;
  new_contacts_count?: number | null;
  duplicate_count?: number | null;
  invalid_count?: number | null;
  new_companies_count?: number | null;
  credits_earned?: number | null;
  status?: ImportsRow["status"];
  error_message?: string | null;
  storage_path?: string | null;
  completed_at?: string | null;
}

// Exports — write shapes (needed by export-generator callers).
// expires_at is set by the trg_export_expires_at trigger on INSERT,
// so we don't expose it on Insert; we DO allow it on Update for parity.
export interface ExportsInsert {
  workspace_id: string;
  contact_count: number;
  credits_spent: number;
  filters?: Json | null;
  format?: ExportsRow["format"];
  fields?: string[] | null;
  storage_path?: string | null;
  status?: ExportsRow["status"];
  created_by?: string | null;
}

export interface ExportsUpdate {
  contact_count?: number;
  credits_spent?: number;
  filters?: Json | null;
  format?: ExportsRow["format"];
  fields?: string[] | null;
  storage_path?: string | null;
  status?: ExportsRow["status"];
  error_message?: string | null;
  completed_at?: string | null;
  expires_at?: string | null;
}

// export_contacts — composite PK insert.
export interface ExportContactsInsert {
  export_id: string;
  contact_id: string;
}

// workspace_contact_access — composite PK insert. The Edge Function
// upserts here so subsequent UI can show "you already have access to
// this contact".
export interface WorkspaceContactAccessInsert {
  workspace_id: string;
  contact_id: string;
  export_id?: string | null;
}

// ─────────────────────────────────────────────────────────────
// supabase-js Database shape
// ─────────────────────────────────────────────────────────────

type Inserts<T> = {
  [K in keyof T]?: T[K] extends { Insert: infer I } ? I : never;
};
type Updates<T> = {
  [K in keyof T]?: T[K] extends { Update: infer U } ? U : never;
};

export interface Database {
  public: {
    Tables: {
      workspaces: { Row: WorkspacesRow };
      workspace_members: { Row: WorkspaceMembersRow };
      companies: { Row: CompaniesRow };
      contacts: {
        Row: ContactsRow;
        Insert: ContactsInsert;
        Update: ContactsUpdate;
      };
      imports: {
        Row: ImportsRow;
        Insert: ImportsInsert;
        Update: ImportsUpdate;
      };
      exports: {
        Row: ExportsRow;
        Insert: ExportsInsert;
        Update: ExportsUpdate;
      };
      export_contacts: {
        Row: ExportContactsRow;
        Insert: ExportContactsInsert;
      };
      credits_ledger: { Row: CreditsLedgerRow };
      workspace_contact_access: {
        Row: WorkspaceContactAccessRow;
        Insert: WorkspaceContactAccessInsert;
      };
      user_profiles: { Row: UserProfilesRow };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

// Convenience aliases — callers that just want the write shape don't
// have to walk the Database nested structure.
export type ContactInsert = Database["public"]["Tables"]["contacts"]["Insert"];
export type ContactUpdate = Database["public"]["Tables"]["contacts"]["Update"];
export type Contact = Database["public"]["Tables"]["contacts"]["Row"];
export type Import = Database["public"]["Tables"]["imports"]["Row"];
export type ImportInsert = Database["public"]["Tables"]["imports"]["Insert"];
export type ImportUpdate = Database["public"]["Tables"]["imports"]["Update"];
export type Export = Database["public"]["Tables"]["exports"]["Row"];
export type ExportInsert = Database["public"]["Tables"]["exports"]["Insert"];
export type ExportUpdate = Database["public"]["Tables"]["exports"]["Update"];
export type ExportContactInsert = Database["public"]["Tables"]["export_contacts"]["Insert"];
export type WorkspaceContactAccess = Database["public"]["Tables"]["workspace_contact_access"]["Row"];
