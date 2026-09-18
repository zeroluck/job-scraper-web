import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../../supabase/migrations/202609180017_location_posted_date_bounds.sql", import.meta.url),
  "utf8",
);

test("date-bounded location RPCs filter cached effective posting dates", () => {
  assert.match(migration, /get_location_insights_date_bounds/i);
  assert.match(migration, /get_location_job_ids_date_bounds/i);
  assert.match(migration, /p_posted_after timestamptz default null/i);
  assert.match(migration, /p_posted_before timestamptz default null/i);
  assert.match(migration, /effective_posted_at >= \$13/i);
  assert.match(migration, /effective_posted_at < \$14/i);
  assert.match(migration, /effective_posted_at >= \$16/i);
  assert.match(migration, /effective_posted_at < \$17/i);
});

test("date-bounded location RPCs remain service-role only", () => {
  assert.match(migration, /revoke all on function public\.get_location_insights_date_bounds[\s\S]+from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.get_location_job_ids_date_bounds[\s\S]+to service_role/i);
});
