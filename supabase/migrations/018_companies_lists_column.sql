-- 018_companies_lists_column.sql
--
-- Adds a `lists` text[] column to the companies table for the Company
-- Lists feature (v1 tag pattern — a list name is a string in the array;
-- no separate lists table).
--
-- Mirrors the contacts.lists pattern from 002 (column + GIN index) so
-- company lookup-by-list has the same index-backed shape as contacts.
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS lists TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_companies_lists
  ON companies USING GIN (lists);