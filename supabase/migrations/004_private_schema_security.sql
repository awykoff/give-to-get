-- Private schema migration + security hardening
-- Already applied to Supabase on May 2026

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO postgres, service_role;

CREATE OR REPLACE FUNCTION private.auth_workspace_id()
RETURNS UUID AS $$
  SELECT workspace_id FROM public.workspace_members
  WHERE user_id = auth.uid() LIMIT 1
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = '';

CREATE OR REPLACE FUNCTION private.handle_import_complete()
RETURNS TRIGGER AS $$
DECLARE current_balance INTEGER;
BEGIN
  IF NEW.status = 'complete' AND OLD.status != 'complete' AND NEW.credits_earned > 0 THEN
    SELECT COALESCE(SUM(amount), 0) INTO current_balance
    FROM public.credits_ledger WHERE workspace_id = NEW.workspace_id;
    INSERT INTO public.credits_ledger (
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

CREATE OR REPLACE FUNCTION private.handle_export_created()
RETURNS TRIGGER AS $$
DECLARE current_balance INTEGER;
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO current_balance
  FROM public.credits_ledger WHERE workspace_id = NEW.workspace_id;
  IF current_balance < NEW.credits_spent THEN
    RAISE EXCEPTION 'Insufficient credits: balance %, required %',
      current_balance, NEW.credits_spent;
  END IF;
  INSERT INTO public.credits_ledger (
    workspace_id, type, amount, description,
    reference_id, reference_type, balance_after
  ) VALUES (
    NEW.workspace_id, 'spend', -NEW.credits_spent,
    'Export: ' || NEW.contact_count || ' contacts',
    NEW.id, 'export', current_balance - NEW.credits_spent
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';
