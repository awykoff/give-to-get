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
// last_name, phone_number (nullable), avatar_url (nullable, added by
// 011), created_at, updated_at }.

import { createClient } from "@/lib/supabase/server";

/**
 * Row shape for the caller's user_profiles row. Matches 007 plus the
 * avatar_url column added by 011. Kept for backward compat with the
 * Settings page and any other callers that need the full row.
 */
export interface UserProfile {
  user_id: string;
  first_name: string;
  last_name: string;
  phone_number: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Narrow shape for the header (TopBar) profile element. Returns only
 * the three fields the header actually renders, so the TopBar's
 * interface stays small and the header never accidentally starts
 * displaying phone_number or audit timestamps just because the
 * underlying row shape changed.
 *
 * `initials` is derived server-side so the TopBar (a client
 * component) doesn't have to repeat the same logic, and so we can
 * change the algorithm (e.g. prefer last name when no first name is
 * available, fall back to email-local-part when there's no profile
 * row at all) in one place.
 *
 * `email` is passed in by the caller (the layout, which has it from
 * getUser()/supabase.auth.getUser()) rather than re-fetched here, so
 * this helper does not touch auth.users.
 */
export interface HeaderProfile {
  firstName: string | null;
  lastName: string | null;
  initials: string;
  avatarUrl: string | null;
}

/**
 * Compute initials from first/last name, falling back to email local
 * part when no profile row exists. Pure function; lives next to the
 * type so the algorithm and the contract move together.
 */
export function initialsFor(
  firstName: string | null,
  lastName: string | null,
  email: string | null,
): string {
  const a = (firstName ?? "").trim();
  const b = (lastName ?? "").trim();
  if (a && b) return (a[0] + b[0]).toUpperCase();
  if (a) return a.slice(0, 2).toUpperCase();
  if (b) return b.slice(0, 2).toUpperCase();
  if (email) {
    const local = email.split("@")[0] ?? "";
    return local.slice(0, 2).toUpperCase() || "?";
  }
  return "?";
}

/**
 * Fetch the caller's user_profiles row. Returns `null` when the row
 * has not been created yet (the Settings page will render an empty
 * form in that case — see SettingsForm.tsx). Does NOT redirect when
 * there is no authenticated user; callers that need a hard gate
 * (e.g. the settings page itself) should pair this with their own
 * auth check or call getWorkspaceContext() upstream.
 *
 * The query selects only the display columns plus user_id; it
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
    .select(
      "user_id, first_name, last_name, phone_number, avatar_url, created_at, updated_at",
    )
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !data) return null;
  return data as UserProfile;
}

/**
 * Fetch the narrow profile data the header (TopBar) needs. Returns a
 * fully-populated HeaderProfile even when the user_profiles row does
 * not exist yet — the caller passes in the authenticated user's
 * email so initials can be derived from the email local-part as a
 * last resort.
 *
 * Safe to call from any server component inside the (dashboard)
 * route group; never touches contacts.
 */
export async function getHeaderProfile(
  email: string | null,
): Promise<HeaderProfile> {
  const profile = await getMyProfile();
  return {
    firstName: profile?.first_name ?? null,
    lastName: profile?.last_name ?? null,
    initials: initialsFor(
      profile?.first_name ?? null,
      profile?.last_name ?? null,
      email,
    ),
    avatarUrl: profile?.avatar_url ?? null,
  };
}