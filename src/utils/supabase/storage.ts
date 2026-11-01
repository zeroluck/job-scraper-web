import "server-only";
import { createClient } from "@supabase/supabase-js";

/** Legacy Supabase Storage only. Never use these credentials for database access. */
export function createSupabaseStorageClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for legacy Storage");
  }
  const client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  // Do not expose .from/.rpc: this client must not become a source DB escape hatch.
  return { storage: client.storage };
}
