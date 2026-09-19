import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const reliableContention = readFileSync(
  new URL("../../../supabase/migrations/20260919221500_reliable_applicant_contention.sql", import.meta.url),
  "utf8",
);
const latestWave = readFileSync(
  new URL("../../../supabase/migrations/20260919230000_contention_latest_posting_wave.sql", import.meta.url),
  "utf8",
);
const exactOnly = readFileSync(
  new URL("../../../supabase/migrations/20260919231500_contention_exact_counts_only.sql", import.meta.url),
  "utf8",
);
const migration = `${reliableContention}\n${latestWave}\n${exactOnly}`;

test("contention excludes bounded applicant observations", () => {
  assert.match(migration, /applicant_count_type' = 'exact'/i);
  assert.match(exactOnly, /applicant_count_type' = 'exact'/i);
  assert.doesNotMatch(exactOnly, /applicant_count_type' IS NULL/i);
  assert.doesNotMatch(migration, /applicant_count_type' = 'upper_bound'/i);
  assert.doesNotMatch(migration, /applicant_count_type' = 'lower_bound'/i);
});

test("contention uses paired exact observations and conservative time windows", () => {
  assert.match(migration, /listing_latest_applicant_count\(to_jsonb\(j\.listing_instances\)\)/i);
  assert.match(migration, /max\(value ->> 'posted_at'\) AS posted_at/i);
  assert.match(migration, /IS NOT DISTINCT FROM wave\.posted_at/i);
  assert.match(migration, /interval '6 hours'/i);
  assert.match(migration, /greatest\([\s\S]+3600, 24\)/i);
  assert.match(migration, /coalesce\(s\.observed_rate, s\.normalized_rate\)/i);
  assert.doesNotMatch(migration, /coalesce\(s\.observed_rate, s\.initial_rate\)/i);
});

test("contention migration refreshes the narrow cache and preserves RPC access", () => {
  assert.match(migration, /select public\.refresh_job_location_buckets\(\)/i);
  assert.match(migration, /revoke all on function public\.get_location_insights_date_bounds[\s\S]+from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.get_location_insights_date_bounds[\s\S]+to service_role/i);
});
