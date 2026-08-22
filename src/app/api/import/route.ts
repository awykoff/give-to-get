import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isPersonalEmail, normalizeEmail } from "@/lib/csv";

export async function POST(req: NextRequest) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Get workspace
  const { data: member } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .single();

  if (!member?.workspace_id) {
    return NextResponse.json({ error: "No workspace found" }, { status: 400 });
  }
  const workspaceId = member.workspace_id;

  const { rows, mapping, fileName } = await req.json() as {
    rows: Record<string, string>[];
    mapping: Record<string, string>;
    fileName: string;
  };

  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "No rows provided" }, { status: 400 });
  }

  // Reverse the mapping: raw_header → canonical_field
  const reverseMap: Record<string, string> = {};
  for (const [raw, canonical] of Object.entries(mapping)) reverseMap[raw] = canonical;

  // Map each row to our contact schema
  const toInsert: Record<string, string>[] = [];
  let invalid_count = 0;

  for (const row of rows) {
    const mapped: Record<string, string> = {};
    for (const [raw, val] of Object.entries(row)) {
      const canonical = reverseMap[raw];
      if (canonical) mapped[canonical] = val.trim();
    }

    const email = mapped["email"];
    if (!email || !email.includes("@") || isPersonalEmail(email)) {
      invalid_count++;
      continue;
    }

    toInsert.push({
      first_name:    mapped["first_name"] ?? null,
      last_name:     mapped["last_name"] ?? null,
      email_normalized: normalizeEmail(email),
      title:         mapped["title"] ?? null,
      company_name:  mapped["company_name"] ?? null,
      vertical:      mapped["vertical"] ?? null,
      seniority:     mapped["seniority"] ?? null,
      city:          mapped["city"] ?? null,
      state:         mapped["state"] ?? null,
      country:       mapped["country"] ?? null,
      company_size:  mapped["company_size"] ?? null,
      phone:         mapped["phone"] ?? null,
      linkedin_url:  mapped["linkedin_url"] ?? null,
      contributed_by_workspace_id: workspaceId,
    });
  }

  if (toInsert.length === 0) {
    // Record the import attempt even if nothing valid
    await supabase.from("imports").insert({
      workspace_id: workspaceId,
      file_name: fileName,
      total_rows: rows.length,
      new_contacts_count: 0,
      duplicate_count: 0,
      invalid_count,
      status: "complete",
    });
    return NextResponse.json({ new_contacts_count: 0, duplicate_count: 0, invalid_count, credits_earned: 0 });
  }

  // Upsert contacts — on conflict (email_normalized) do nothing, return id to detect dupes
  const { data: inserted, error: insertError } = await supabase
    .from("contacts")
    .upsert(toInsert, { onConflict: "email_normalized", ignoreDuplicates: true })
    .select("id");

  if (insertError) {
    console.error("Insert error:", insertError);
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  const new_contacts_count = inserted?.length ?? 0;
  const duplicate_count = toInsert.length - new_contacts_count;
  const credits_earned = new_contacts_count;

  // Earn credits for new contacts
  if (credits_earned > 0) {
    await supabase.from("credits_ledger").insert({
      workspace_id: workspaceId,
      amount: credits_earned,
      type: "earn",
      description: `Import: ${fileName} (+${credits_earned} new contacts)`,
    });
  }

  // Record the import
  await supabase.from("imports").insert({
    workspace_id: workspaceId,
    file_name: fileName,
    total_rows: rows.length,
    new_contacts_count,
    duplicate_count,
    invalid_count,
    status: "complete",
  });

  return NextResponse.json({ new_contacts_count, duplicate_count, invalid_count, credits_earned });
}
