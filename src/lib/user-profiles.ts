// src/lib/user-profiles.ts
//
// Server-side helpers for the user's own Settings profile row.
//
// Privacy rule (PRD §7): user_profiles is permanently walled off from
// contacts. The Settings API and these helpers NEVER write to, nor
// read from, the contacts table. user_profiles is its own surface, RLS
// owns it (see supabase/migrations/007_user_profiles.sql), and the
// fields are deliberately limited to first/last/phone. Email is NOT
// a column here — it lives in auth.users and is only ever read.
//
// Schema: user_profiles { user_id (PK → auth.users), first_name,
// last_name, phone_number (nullable), created_at, updated_at }.

import { createClient } from "@/lib/supabase/server";

/**
 * Row shape for the caller's user_profiles row. Matches 007 exactly.
 */
export interface UserProfile {
  user_id: string;
  first_name: string;
  last_name: string;
  phone_number: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Fetch the caller's user_profiles row. Returns `null` when the row
 * has not been created yet (the Settings page will render an empty
 * form in that case — see SettingsForm.tsx). Does NOT redirect when
 * there is no authenticated user; callers that need a hard gate
 * (e.g. the settings page itself) should pair this with their own
 * auth check or call getWorkspaceContext() upstream.
 *
 * The query selects only the four display columns plus user_id; it
 * never touches contacts and never reads auth.users (email is
 * fetched separately by the page so it stays read-only and never
 * appears in a PATCH body).
 */
export async function getMyProfile(): Promise<UserProfile | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("user_profiles")
    .select("user_id, first_name, last_name, phone_number, created_at, updated_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !data) return null;
  return data as UserProfile;
}