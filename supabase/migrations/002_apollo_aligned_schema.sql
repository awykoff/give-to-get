-- give-to-get.com — Schema v2
-- Apollo-aligned contacts + companies tables
-- Run in Supabase SQL Editor or via: supabase db push

-- ─────────────────────────────────────────
-- EXTENSIONS
-- ─────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- ─────────────────────────────────────────
-- WORKSPACES
-- ─────────────────────────────────────────
CREATE TABLE workspaces (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  slug                TEXT UNIQUE NOT NULL,
  owner_user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  plan                TEXT NOT NULL DEFAULT 'free'
                        CHECK (plan IN ('free','pro','team','enterprise')),
  stripe_customer_id  TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- WORKSPACE MEMBERS
-- ─────────────────────────────────────────
CREATE TABLE workspace_members (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role          TEXT NOT NULL DEFAULT 'member'
                  CHECK (role IN ('admin','member')),
  invited_by    UUID REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, user_id)
);

CREATE INDEX idx_workspace_members_user      ON workspace_members(user_id);
CREATE INDEX idx_workspace_members_workspace ON workspace_members(workspace_id);

-- ─────────────────────────────────────────
-- COMPANIES (Apollo Account export aligned)
-- ─────────────────────────────────────────
CREATE TABLE companies (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  name                    TEXT NOT NULL,
  name_for_emails         TEXT,                    -- "Company Name for Emails"
  website                 TEXT,
  domain                  TEXT,                    -- extracted from website

  -- Apollo IDs (for dedup from Apollo exports)
  apollo_account_id       TEXT UNIQUE,             -- "Apollo Account Id"

  -- Size & Industry
  num_employees           INTEGER,                 -- "# Employees"
  industry                TEXT,                    -- "Industry"
  keywords                TEXT[],                  -- "Keywords" (comma-split)
  sic_codes               TEXT[],                  -- "SIC Codes"
  naics_codes             TEXT[],                  -- "NAICS Codes"
  short_description       TEXT,                    -- "Short Description"
  founded_year            INTEGER,                 -- "Founded Year"
  number_of_retail_locs   INTEGER,                 -- "Number of Retail Locations"

  -- Financials
  annual_revenue          BIGINT,                  -- "Annual Revenue"
  total_funding           BIGINT,                  -- "Total Funding"
  latest_funding          TEXT,                    -- "Latest Funding" (round name)
  latest_funding_amount   BIGINT,                  -- "Latest Funding Amount"
  last_raised_at          DATE,                    -- "Last Raised At"

  -- Location
  street                  TEXT,                    -- "Company Street"
  city                    TEXT,                    -- "Company City"
  state                   TEXT,                    -- "Company State"
  country                 TEXT DEFAULT 'US',       -- "Company Country"
  postal_code             TEXT,                    -- "Company Postal Code"
  address                 TEXT,                    -- "Company Address" (full)
  phone                   TEXT,                    -- "Company Phone"

  -- Social
  linkedin_url            TEXT,                    -- "Company Linkedin Url"
  facebook_url            TEXT,                    -- "Facebook Url"
  twitter_url             TEXT,                    -- "Twitter Url"
  logo_url                TEXT,                    -- "Logo Url"

  -- Technologies
  technologies            TEXT[],                  -- "Technologies" (comma-split)

  -- Hierarchy
  subsidiary_of           TEXT,                    -- "Subsidiary of"
  subsidiary_of_id        TEXT,                    -- "Subsidiary of (Organization ID)"

  -- Provenance
  contributed_by_workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  source_import_id        UUID,                    -- FK to imports

  -- Quality
  quality_score           INTEGER DEFAULT 0 CHECK (quality_score BETWEEN 0 AND 100),

  -- Timestamps
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_companies_name        ON companies(name);
CREATE INDEX idx_companies_domain      ON companies(domain);
CREATE INDEX idx_companies_industry    ON companies(industry);
CREATE INDEX idx_companies_state       ON companies(state);
CREATE INDEX idx_companies_country     ON companies(country);
CREATE INDEX idx_companies_apollo_id   ON companies(apollo_account_id);
CREATE INDEX idx_companies_name_trgm   ON companies USING gin(name gin_trgm_ops);

-- ─────────────────────────────────────────
-- CONTACTS (Apollo Contact export aligned)
-- ─────────────────────────────────────────
CREATE TABLE contacts (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity (global dedup key = email_normalized)
  first_name                  TEXT NOT NULL,
  last_name                   TEXT,
  email                       TEXT NOT NULL,
  email_normalized            TEXT GENERATED ALWAYS AS (LOWER(TRIM(email))) STORED,

  -- Email quality (Apollo fields)
  email_status                TEXT,               -- "Email Status" (verified/unverified/etc)
  email_source                TEXT,               -- "Primary Email Source"
  email_verification_source   TEXT,               -- "Primary Email Verification Source"
  email_confidence            INTEGER,            -- "Email Confidence" (0-100)
  email_catch_all_status      TEXT,               -- "Primary Email Catch-all Status"
  email_last_verified_at      TIMESTAMPTZ,        -- "Primary Email Last Verified At"

  -- Secondary / Tertiary emails
  secondary_email             TEXT,
  secondary_email_source      TEXT,
  secondary_email_status      TEXT,
  tertiary_email              TEXT,
  tertiary_email_source       TEXT,
  tertiary_email_status       TEXT,

  -- Professional
  title                       TEXT,               -- "Title"
  seniority                   TEXT CHECK (seniority IN (
                                'C-Suite','VP','Director','Manager',
                                'Individual Contributor','Unknown')),
  departments                 TEXT[],             -- "Departments" (comma-split)
  sub_departments             TEXT[],             -- "Sub Departments"

  -- Company (denormalized for fast search)
  company_name                TEXT,               -- "Company Name"
  company_id                  UUID REFERENCES companies(id) ON DELETE SET NULL,

  -- Contact channels
  work_direct_phone           TEXT,               -- "Work Direct Phone"
  mobile_phone                TEXT,               -- "Mobile Phone"
  corporate_phone             TEXT,               -- "Corporate Phone"
  home_phone                  TEXT,               -- "Home Phone"
  other_phone                 TEXT,               -- "Other Phone"
  do_not_call                 BOOLEAN DEFAULT FALSE, -- "Do Not Call"

  -- Social
  linkedin_url                TEXT,               -- "Person Linkedin Url"
  twitter_url                 TEXT,               -- "Twitter Url"
  facebook_url                TEXT,               -- "Facebook Url"

  -- Location
  city                        TEXT,               -- "City"
  state                       TEXT,               -- "State"
  country                     TEXT DEFAULT 'US',  -- "Country"

  -- Industry (denormalized from company)
  industry                    TEXT,               -- "Industry"
  vertical                    TEXT,               -- normalized from industry
  keywords                    TEXT[],             -- "Keywords"
  technologies                TEXT[],             -- "Technologies"

  -- Company firmographics (denormalized for fast filter)
  company_city                TEXT,               -- "Company City"
  company_state               TEXT,               -- "Company State"
  company_country             TEXT,               -- "Company Country"
  company_address             TEXT,               -- "Company Address"
  company_phone               TEXT,               -- "Company Phone"
  num_employees               INTEGER,            -- "# Employees"
  annual_revenue              BIGINT,             -- "Annual Revenue"
  total_funding               BIGINT,             -- "Total Funding"
  latest_funding              TEXT,               -- "Latest Funding"
  latest_funding_amount       BIGINT,             -- "Latest Funding Amount"
  last_raised_at              DATE,               -- "Last Raised At"

  -- Apollo IDs
  apollo_contact_id           TEXT UNIQUE,        -- "Apollo Contact Id"
  apollo_account_id           TEXT,               -- "Apollo Account Id"

  -- CRM / pipeline fields
  stage                       TEXT,               -- "Stage"
  lists                       TEXT[],             -- "Lists" (comma-split)
  last_contacted              TIMESTAMPTZ,        -- "Last Contacted"

  -- Outreach tracking
  email_sent                  BOOLEAN DEFAULT FALSE,   -- "Email Sent"
  email_open                  BOOLEAN DEFAULT FALSE,   -- "Email Open"
  email_bounced               BOOLEAN DEFAULT FALSE,   -- "Email Bounced"
  replied                     BOOLEAN DEFAULT FALSE,   -- "Replied"
  demoed                      BOOLEAN DEFAULT FALSE,   -- "Demoed"

  -- Provenance (givetoget)
  contributed_by_workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  source_import_id            UUID,

  -- Quality
  quality_score               INTEGER DEFAULT 0 CHECK (quality_score BETWEEN 0 AND 100),
  is_verified                 BOOLEAN DEFAULT FALSE,

  -- Timestamps
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Global dedup constraint
  UNIQUE(email_normalized)
);

-- Indexes for common filter + search patterns
CREATE INDEX idx_contacts_email_norm    ON contacts(email_normalized);
CREATE INDEX idx_contacts_vertical      ON contacts(vertical);
CREATE INDEX idx_contacts_industry      ON contacts(industry);
CREATE INDEX idx_contacts_seniority     ON contacts(seniority);
CREATE INDEX idx_contacts_company_name  ON contacts(company_name);
CREATE INDEX idx_contacts_company_id    ON contacts(company_id);
CREATE INDEX idx_contacts_state         ON contacts(state);
CREATE INDEX idx_contacts_country       ON contacts(country);
CREATE INDEX idx_contacts_apollo_cid    ON contacts(apollo_contact_id);
CREATE INDEX idx_contacts_apollo_acid   ON contacts(apollo_account_id);
CREATE INDEX idx_contacts_contributed   ON contacts(contributed_by_workspace_id);
CREATE INDEX idx_contacts_lists         ON contacts USING gin(lists);
CREATE INDEX idx_contacts_departments   ON contacts USING gin(departments);

-- Full-text search
CREATE INDEX idx_contacts_fts ON contacts
  USING gin(
    to_tsvector('english',
      COALESCE(first_name,'') || ' ' ||
      COALESCE(last_name,'') || ' ' ||
      COALESCE(company_name,'') || ' ' ||
      COALESCE(title,'')
    )
  );

-- Trigram for ILIKE search
CREATE INDEX idx_contacts_name_trgm ON contacts
  USING gin((COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')) gin_trgm_ops);
CREATE INDEX idx_contacts_company_trgm ON contacts
  USING gin(COALESCE(company_name,'') gin_trgm_ops);

-- ─────────────────────────────────────────
-- IMPORTS
-- ─────────────────────────────────────────
CREATE TABLE imports (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  filename              TEXT NOT NULL,
  import_type           TEXT NOT NULL DEFAULT 'contacts'
                          CHECK (import_type IN ('contacts','companies','mixed')),
  original_row_count    INTEGER,
  valid_row_count       INTEGER,
  new_contacts_count    INTEGER DEFAULT 0,
  duplicate_count       INTEGER DEFAULT 0,
  invalid_count         INTEGER DEFAULT 0,
  new_companies_count   INTEGER DEFAULT 0,
  credits_earned        INTEGER DEFAULT 0,
  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','processing','complete','failed')),
  error_message         TEXT,
  storage_path          TEXT,
  processed_by          UUID REFERENCES auth.users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at          TIMESTAMPTZ
);

CREATE INDEX idx_imports_workspace ON imports(workspace_id);
CREATE INDEX idx_imports_status    ON imports(status);
CREATE INDEX idx_imports_created   ON imports(created_at DESC);

-- ─────────────────────────────────────────
-- EXPORTS
-- ─────────────────────────────────────────
CREATE TABLE exports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  contact_count   INTEGER NOT NULL,
  credits_spent   INTEGER NOT NULL,
  filters         JSONB,
  format          TEXT NOT NULL DEFAULT 'csv'
                    CHECK (format IN ('csv','xlsx','json')),
  fields          TEXT[],
  storage_path    TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','processing','complete','failed')),
  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ
);

CREATE TABLE export_contacts (
  export_id   UUID NOT NULL REFERENCES exports(id) ON DELETE CASCADE,
  contact_id  UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  PRIMARY KEY (export_id, contact_id)
);


-- Auto-set expires_at on export insert
CREATE OR REPLACE FUNCTION set_export_expires_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.expires_at = NEW.created_at + INTERVAL '7 days';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_export_expires_at
  BEFORE INSERT ON exports FOR EACH ROW
  EXECUTE FUNCTION set_export_expires_at();

CREATE INDEX idx_exports_workspace ON exports(workspace_id);
CREATE INDEX idx_exports_created   ON exports(created_at DESC);

-- ─────────────────────────────────────────
-- CREDITS LEDGER (append-only)
-- ─────────────────────────────────────────
CREATE TABLE credits_ledger (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type            TEXT NOT NULL
                    CHECK (type IN ('earn','spend','bonus','refund','adjustment')),
  amount          INTEGER NOT NULL,
  description     TEXT NOT NULL,
  reference_id    UUID,
  reference_type  TEXT CHECK (reference_type IN
                    ('import','export','referral','signup','manual')),
  balance_after   INTEGER NOT NULL,
  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_credits_workspace ON credits_ledger(workspace_id);
CREATE INDEX idx_credits_created   ON credits_ledger(created_at DESC);

-- Balance view
CREATE VIEW workspace_credit_balances AS
SELECT
  workspace_id,
  COALESCE(SUM(amount), 0)                                          AS balance,
  COALESCE(SUM(amount) FILTER (WHERE type IN ('earn','bonus')), 0)  AS total_earned,
  COALESCE(SUM(ABS(amount)) FILTER (WHERE type = 'spend'), 0)       AS total_spent
FROM credits_ledger
GROUP BY workspace_id;

-- ─────────────────────────────────────────
-- WORKSPACE CONTACT ACCESS
-- ─────────────────────────────────────────
CREATE TABLE workspace_contact_access (
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  contact_id      UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  export_id       UUID REFERENCES exports(id),
  unlocked_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, contact_id)
);

CREATE INDEX idx_contact_access_workspace ON workspace_contact_access(workspace_id);
CREATE INDEX idx_contact_access_contact   ON workspace_contact_access(contact_id);

-- ─────────────────────────────────────────
-- TRIGGERS
-- ─────────────────────────────────────────

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_workspaces_updated_at
  BEFORE UPDATE ON workspaces FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_contacts_updated_at
  BEFORE UPDATE ON contacts FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_companies_updated_at
  BEFORE UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Credit earn when import completes
CREATE OR REPLACE FUNCTION handle_import_complete()
RETURNS TRIGGER AS $$
DECLARE current_balance INTEGER;
BEGIN
  IF NEW.status = 'complete' AND OLD.status != 'complete' AND NEW.credits_earned > 0 THEN
    SELECT COALESCE(SUM(amount), 0) INTO current_balance
    FROM credits_ledger WHERE workspace_id = NEW.workspace_id;

    INSERT INTO credits_ledger (
      workspace_id, type, amount, description,
      reference_id, reference_type, balance_after
    ) VALUES (
      NEW.workspace_id, 'earn', NEW.credits_earned,
      'Import: ' || NEW.filename,
      NEW.id, 'import', current_balance + NEW.credits_earned
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_import_credits
  AFTER UPDATE ON imports FOR EACH ROW
  EXECUTE FUNCTION handle_import_complete();

-- Credit deduction when export created
CREATE OR REPLACE FUNCTION handle_export_created()
RETURNS TRIGGER AS $$
DECLARE current_balance INTEGER;
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO current_balance
  FROM credits_ledger WHERE workspace_id = NEW.workspace_id;

  IF current_balance < NEW.credits_spent THEN
    RAISE EXCEPTION 'Insufficient credits: balance %, required %',
      current_balance, NEW.credits_spent;
  END IF;

  INSERT INTO credits_ledger (
    workspace_id, type, amount, description,
    reference_id, reference_type, balance_after
  ) VALUES (
    NEW.workspace_id, 'spend', -NEW.credits_spent,
    'Export: ' || NEW.contact_count || ' contacts',
    NEW.id, 'export', current_balance - NEW.credits_spent
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_export_credits
  AFTER INSERT ON exports FOR EACH ROW
  EXECUTE FUNCTION handle_export_created();

-- ─────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────
ALTER TABLE workspaces               ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_members        ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies                ENABLE ROW LEVEL SECURITY;
ALTER TABLE imports                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE exports                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE export_contacts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE credits_ledger           ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_contact_access ENABLE ROW LEVEL SECURITY;

-- Helper: current user's workspace
CREATE OR REPLACE FUNCTION auth_workspace_id()
RETURNS UUID AS $$
  SELECT workspace_id FROM workspace_members
  WHERE user_id = auth.uid() LIMIT 1
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Workspaces
CREATE POLICY "workspace_select" ON workspaces FOR SELECT
  USING (id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "workspace_update" ON workspaces FOR UPDATE
  USING (owner_user_id = auth.uid());

-- Contacts: metadata globally readable, email gated at app layer
CREATE POLICY "contacts_select" ON contacts FOR SELECT USING (true);
CREATE POLICY "contacts_insert" ON contacts FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- Companies: globally readable
CREATE POLICY "companies_select" ON companies FOR SELECT USING (true);
CREATE POLICY "companies_insert" ON companies FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- Workspace-scoped tables
CREATE POLICY "imports_workspace"  ON imports        FOR ALL USING (workspace_id = auth_workspace_id());
CREATE POLICY "exports_workspace"  ON exports        FOR ALL USING (workspace_id = auth_workspace_id());
CREATE POLICY "credits_workspace"  ON credits_ledger FOR SELECT USING (workspace_id = auth_workspace_id());
CREATE POLICY "access_workspace"   ON workspace_contact_access FOR SELECT USING (workspace_id = auth_workspace_id());

-- ─────────────────────────────────────────
-- APOLLO COLUMN MAP (reference — not SQL)
-- ─────────────────────────────────────────
-- CONTACT CSV → contacts table
--   First Name              → first_name
--   Last Name               → last_name
--   Title                   → title
--   Company Name            → company_name
--   Company Name for Emails → (match to companies.name_for_emails)
--   Email                   → email
--   Email Status            → email_status
--   Primary Email Source    → email_source
--   Email Confidence        → email_confidence
--   Seniority               → seniority (normalize to enum)
--   Departments             → departments[]
--   Sub Departments         → sub_departments[]
--   Work Direct Phone       → work_direct_phone
--   Mobile Phone            → mobile_phone
--   Corporate Phone         → corporate_phone
--   Home Phone              → home_phone
--   Do Not Call             → do_not_call
--   Stage                   → stage
--   Lists                   → lists[]
--   Last Contacted          → last_contacted
--   # Employees             → num_employees
--   Industry                → industry (also derive vertical)
--   Keywords                → keywords[]
--   Person Linkedin Url     → linkedin_url
--   Website                 → (match company)
--   City                    → city
--   State                   → state
--   Country                 → country
--   Company City            → company_city
--   Company State           → company_state
--   Company Country         → company_country
--   Company Address         → company_address
--   Company Phone           → company_phone
--   Technologies            → technologies[]
--   Annual Revenue          → annual_revenue
--   Total Funding           → total_funding
--   Latest Funding          → latest_funding
--   Latest Funding Amount   → latest_funding_amount
--   Last Raised At          → last_raised_at
--   Apollo Contact Id       → apollo_contact_id (dedup key from Apollo)
--   Apollo Account Id       → apollo_account_id
--   Email Sent              → email_sent
--   Email Open              → email_open
--   Email Bounced           → email_bounced
--   Replied                 → replied
--   Demoed                  → demoed
--   Secondary Email         → secondary_email
--   Tertiary Email          → tertiary_email

-- COMPANY CSV → companies table
--   Company Name            → name
--   Company Name for Emails → name_for_emails
--   # Employees             → num_employees
--   Industry                → industry
--   Website                 → website (extract domain)
--   Company Linkedin Url    → linkedin_url
--   Facebook Url            → facebook_url
--   Twitter Url             → twitter_url
--   Company Street          → street
--   Company City            → city
--   Company State           → state
--   Company Country         → country
--   Company Postal Code     → postal_code
--   Company Address         → address
--   Keywords                → keywords[]
--   Company Phone           → phone
--   Technologies            → technologies[]
--   Total Funding           → total_funding
--   Latest Funding          → latest_funding
--   Latest Funding Amount   → latest_funding_amount
--   Last Raised At          → last_raised_at
--   Annual Revenue          → annual_revenue
--   Apollo Account Id       → apollo_account_id (UNIQUE dedup key)
--   SIC Codes               → sic_codes[]
--   NAICS Codes             → naics_codes[]
--   Short Description       → short_description
--   Founded Year            → founded_year
--   Logo Url                → logo_url
--   Subsidiary of           → subsidiary_of
--   Subsidiary of (Org ID)  → subsidiary_of_id
