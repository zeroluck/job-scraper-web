import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import "server-only";

export async function createSupabaseServerClient() {
  const url = process.env.JOB_DATA_API_URL;
  const serviceRoleKey = process.env.JOB_DATA_API_TOKEN;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing JOB_DATA_API_URL or JOB_DATA_API_TOKEN",
    );
  }

  const cookieStore = await cookies();

  return createServerClient(
    url,
    serviceRoleKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    }
  );
}
