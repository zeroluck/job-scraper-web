import "server-only";
import { createJobDataClient } from "./data.ts";

/** Compatibility factory: the configured least-privileged data token, not a service role. */
export function createSupabaseServiceClient() {
  return createJobDataClient();
}
