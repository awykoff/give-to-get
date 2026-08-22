-- give-to-get.com — Initial Schema
-- Run this in Supabase SQL Editor or via: supabase db push

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- ─────────────────────────────────────────
-- WORKSPACES
-- ─────────────────────────────────────────
CREATE TABLE workspaces (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  slug            TEXT UNIQUE NOT NULL,
  owner_user_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  plan            TEXT NOT NULL DEFAULT 'free'
                    CHECK (plan IN ('free','pro','team','enterprise')),
  stripe_customer_id TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
-- CONTACTS (Global shared pool)
-- ─────────────────────────────────────────
CREATE TABLE contacts (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name                  TEXT NOT NULL,
  last_name                   TEXT NOT NULL,
  email                       TEXT NOT NULL,
  email_normalized            TEXT GENERATED ALWAYS AS (LOWER(TRIM(email))) STORED,
  title                       TEXT,
  seniority                   TEXT CHECK (seniority IN (
                                'C-Suite','VP','Director','Manager',
                                'Individual Contributor','Unknown')),
  company                     TEXT,
  company_domain              TEXT,
  company_size                TEXT CHECK (company_size IN (
                                '1-10','11-50','51-200','201-1000',
                                '1001-5000','5001-10000','10001+','Unknown')),
  vertical                    TEXT,
  location                    TEXT,
  city                        TEXT,
  state                       TEXT,
  country                     TEXT DEFAULT 'US',
  linkedin_url                TEXT,
  phone                       TEXT,
  contributed_by_workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  source_import_id            UUID,
  quality_score               INTEGER DEFAULT 0
                                CHECK (quality_score BETWEEN 0 AND 100),
  is_verified                 BOOLEAN DEFAULT FALSE,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(email_normalized)
);

CREATE INDEX idx_contacts_email_normalized ON contacts(email_normalized);
CREATE INDEX idx_contacts_vertical         ON contacts(vertical);
CREATE INDEX idx_contacts_seniority        ON contacts(seniority);
CREATE INDEX idx_contacts_company          ON contacts(company);
CREATE INDEX idx_contacts_state            ON contacts(state);
CREATE INDEX idx_contacts_contributed_by   ON contacts(contributed_by_workspace_id);
CREATE INDEX idx_contacts_name_trgm        ON contacts
  USING gin((first_name || ' ' || last_name) gin_trgm_ops);

-- ─────────────────────────────────────────
-- IMPORTS
-- ─────────────────────────────────────────
CREATE TABLE imports (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  filename            TEXT NOT NULL,
  original_row_count  INTEGER,
  valid_row_count     INTEGER,
  new_contacts_count  INTEGER DEFAULT 0,
  duplicate_count     INTEGER DEFAULT 0,
  invalid_count       INTEGER DEFAULT 0,
  credits_earned      INTEGER DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','processing','complete','failed')),
  error_message       TEXT,
  storage_path        TEXT,
  processed_by        UUID REFERENCES auth.users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at        TIMESTAMPTZ
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
  expires_at      TIMESTAMPTZ GENERATED ALWAYS AS
                    (created_at + INTERVAL '7 days') STORED
);

CREATE TABLE export_contacts (
  export_id   UUID NOT NULL REFERENCES exports(id) ON DELETE CASCADE,
  contact_id  UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  PRIMARY KEY (export_id, contact_id)
);

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
  COALESCE(SUM(amount), 0) AS balance,
  COALESCE(SUM(amount) FILTER (WHERE type IN ('earn','bonus')), 0) AS total_earned,
  COALESCE(SUM(ABS(amount)) FILTER (WHERE type = 'spend'), 0) AS total_spent
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

-- ─────────────────────────────────────────
-- TRIGGERS
-- ─────────────────────────────────────────

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_workspaces_updated_at
  BEFORE UPDATE ON workspaces FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_contacts_updated_at
  BEFORE UPDATE ON contacts FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

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
ALTER TABLE imports                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE exports                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE export_contacts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE credits_ledger           ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_contact_access ENABLE ROW LEVEL SECURITY;

-- Helper: get workspace_id for current user
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

-- Contacts: globally readable metadata, email gated at app layer
CREATE POLICY "contacts_select" ON contacts FOR SELECT USING (true);
CREATE POLICY "contacts_insert" ON contacts FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- Imports / Exports / Credits: workspace-scoped
CREATE POLICY "imports_workspace"  ON imports        FOR ALL USING (workspace_id = auth_workspace_id());
CREATE POLICY "exports_workspace"  ON exports        FOR ALL USING (workspace_id = auth_workspace_id());
CREATE POLICY "credits_workspace"  ON credits_ledger FOR SELECT USING (workspace_id = auth_workspace_id());
CREATE POLICY "access_workspace"   ON workspace_contact_access FOR SELECT USING (workspace_id = auth_workspace_id());

-- Signup bonus: 100 credits for new workspaces
-- (Call this from your onboarding Edge Function or server action)
-- INSERT INTO credits_ledger (workspace_id, type, amount, description, reference_type, balance_after)
-- VALUES ($1, 'bonus', 100, 'Welcome bonus — 100 free credits', 'signup', 100);
