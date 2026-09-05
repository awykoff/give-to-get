// Service-role Supabase client for Edge Functions.
//
// IMPORTANT: this client bypasses RLS. It is only ever instantiated inside
// an Edge Function that has access to SUPABASE_SERVICE_ROLE_KEY. It must
// never be created from code that runs in the browser, and the service-role
// key must never be exposed to client-side bundles.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export function createServiceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url) throw new Error("SUPABASE_URL is not set");
  if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");

  return createClient(url, serviceKey, {
    auth: {
      // Edge Functions don't use cookies or session persistence.
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
