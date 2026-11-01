import { createClient } from "@supabase/supabase-js";
import "server-only";

export function createSupabaseServiceClient() {
  const url = process.env.JOB_DATA_API_URL;
  const serviceRoleKey = process.env.JOB_DATA_API_TOKEN;
  if (!url || !serviceRoleKey) {
    throw new Error("Missing JOB_DATA_API_URL or JOB_DATA_API_TOKEN");
  }
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
