// src/app/api/user-profiles/route.ts
//
// GET  /api/user-profiles — return the caller's user_profiles row
//                            (or 404 when the row has not been
//                            created yet).
// PATCH /api/user-profiles — upsert on user_id = auth.uid(). Body
//                            shape: { first_name, last_name,
//                            phone_number? }. phone_number stays
//                            optional (PRD 5.8). Validation: first
//                            /last names are required, trimmed,
//                            non-empty, ≤ 80 chars; phone_number is
//                            either null or matches an E.164-ish
//                            pattern (digits, +, -, spaces — we
//                            deliberately accept the small set of
//                            characters a real user might type
//                            rather than a strict regex that would
//                            reject "555-123-4567").
//
// Privacy: this route NEVER reads from or writes to the contacts
// table. It only reads from auth.users (for the caller's own id) and
// user_profiles. The body shape explicitly does NOT include
// company/title/email — email is read-only from auth.users and is
// never settable here.
//
// Auth: the route uses the cookie-backed server client. A request
// with no authenticated user is a hard 401. We rely on RLS
// (user_profiles_insert/update policies pin auth.uid() = user_id) so
// no separate authorization check is needed — even if a client tries
// to spoof user_id in the body, the RLS WITH CHECK pins it to
// auth.uid() on the way in.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Length caps — chosen to match the column shape (TEXT) without
// allowing pathological inputs that would bloat the row or be a
// prompt-injection vector for the rendered name display.
const NAME_MAX = 80;
const PHONE_MAX = 32;

// Phone regex — E.164-ish. Matches:
//   * an optional leading +
//   * 4..32 chars drawn from digits, spaces, dashes, parentheses,
//     and dots (E.164 itself is +15551234567; we accept the same
//     shapes the contacts table accepts via the CSV pipeline).
// We deliberately do NOT try to validate full ITU E.164 here — a
// real-world US user typing "(555) 123-4567" should round-trip
// cleanly. The point is to reject garbage (letters, SQL fragments,
// control chars), not to be a phone-number authority.
const PHONE_RE = /^[+0-9 ()\-.]+$/;

interface PatchBody {
  first_name?: unknown;
  last_name?: unknown;
  phone_number?: unknown;
}

function isNonEmptyString(v: unknown, max: number): v is string {
  return typeof v === "string" && v.trim().length > 0 && v.trim().length <= max;
}

function normalizePhone(v: unknown): string | null | "INVALID" {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return "INVALID";
  const trimmed = v.trim();
  if (trimmed.length === 0) return null; // empty string treated as null
  if (trimmed.length > PHONE_MAX) return "INVALID";
  if (!PHONE_RE.test(trimmed)) return "INVALID";
  return trimmed;
}

export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("user_profiles")
    .select("user_id, first_name, last_name, phone_number, created_at, updated_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: "Failed to load profile" },
      { status: 500 },
    );
  }

  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(data);
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate first_name / last_name. Both are required. We accept the
  // trimmed form so a stray " " in the field doesn't pass validation
  // but real data with surrounding whitespace does.
  if (!isNonEmptyString(body.first_name, NAME_MAX)) {
    return NextResponse.json(
      { error: "first_name is required (1–80 chars)" },
      { status: 400 },
    );
  }
  if (!isNonEmptyString(body.last_name, NAME_MAX)) {
    return NextResponse.json(
      { error: "last_name is required (1–80 chars)" },
      { status: 400 },
    );
  }

  const firstName = body.first_name.trim();
  const lastName = body.last_name.trim();

  const phone = normalizePhone(body.phone_number);
  if (phone === "INVALID") {
    return NextResponse.json(
      {
        error:
          "phone_number may be null, empty, or match digits + spaces + dashes + parentheses + dots + leading +",
      },
      { status: 400 },
    );
  }

  // Upsert: keyed on user_id = auth.uid() (the PK). The
  // user_profiles_insert / user_profiles_update policies pin
  // auth.uid() = user_id on both INSERT and UPDATE, so even if the
  // body tried to slip user_id in we couldn't write to anyone else's
  // row.
  const { data, error } = await supabase
    .from("user_profiles")
    .upsert(
      {
        user_id: user.id,
        first_name: firstName,
        last_name: lastName,
        phone_number: phone,
      },
      { onConflict: "user_id" },
    )
    .select("user_id, first_name, last_name, phone_number, created_at, updated_at")
    .single();

  if (error) {
    // The most likely cause here is RLS (policies pin auth.uid() =
    // user_id) or a transient network error. Surface a stable message
    // so the client doesn't have to parse Postgres strings.
    return NextResponse.json(
      { error: "Failed to save profile" },
      { status: 500 },
    );
  }

  return NextResponse.json(data);
}