import "server-only";
import { createJobDataClient } from "./data.ts";

/** Compatibility factory for server database consumers. Never uses request cookies. */
export async function createSupabaseServerClient() {
  return createJobDataClient();
}
