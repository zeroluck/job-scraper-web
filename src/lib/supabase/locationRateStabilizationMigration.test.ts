import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const cacheMigration = readFileSync(
  new URL("../../../supabase/migrations/202609180012_location_rpc_stabilization.sql", import.meta.url),
  "utf8",
);
const rpcMigration = readFileSync(
  new URL("../../../supabase/migrations/202609180014_dynamic_location_rpc_plans.sql", import.meta.url),
  "utf8",
);
const geographyMigration = readFileSync(
  new URL("../../../supabase/migrations/202609180015_statcan_cma_membership.sql", import.meta.url),
  "utf8",
);

test("location stabilization caches all bucket modes and refreshes on location changes", () => {
  assert.match(cacheMigration, /create table if not exists public\.job_location_buckets/i);
  assert.match(cacheMigration, /city_bucket text not null/i);
  assert.match(cacheMigration, /folded_city_bucket text not null/i);
  assert.match(cacheMigration, /province_bucket text not null/i);
  assert.match(cacheMigration, /after insert or update of[\s\S]+location[\s\S]+on public\.jobs/i);
  assert.match(cacheMigration, /refresh_job_location_buckets/i);
});

test("location stabilization keeps cached data and maintenance service-only", () => {
  assert.match(cacheMigration, /alter table public\.job_location_buckets enable row level security/i);
  assert.match(cacheMigration, /revoke all on table public\.job_location_buckets from public, anon, authenticated/i);
  assert.match(cacheMigration, /revoke all on function public\.sync_job_location_buckets\(\) from public, anon, authenticated/i);
});

test("location stabilization exposes both rates and enforces small-town exclusions", () => {
  assert.match(rpcMigration, /p_place_view text default 'all'/i);
  assert.match(rpcMigration, /stabilized_per_100k numeric/i);
  assert.match(rpcMigration, /rate_reliability numeric/i);
  assert.match(rpcMigration, /p\.population_2021 between 1 and 99999/i);
  assert.match(rpcMigration, /not p\.is_cma_component/i);
  assert.match(rpcMigration, /p\.geo_match_quality in \('exact', 'parent'\)/i);
});

test("location RPCs use narrow cached rows and one canonical place-view signature", () => {
  assert.match(rpcMigration, /from public\.job_location_buckets b/i);
  assert.doesNotMatch(rpcMigration, /public\.location_bucket\(/i);
  assert.match(rpcMigration, /return query execute/i);
  assert.match(cacheMigration, /job_archetype_memberships_location_cover_idx/i);
});

test("StatCan membership classifies all seeded examples deterministically", () => {
  assert.match(geographyMigration, /'c:brossard\|qc'.+'cma', true/i);
  assert.match(geographyMigration, /'c:moosonee\|on', null, null, null, false/i);
  assert.match(geographyMigration, /'c:invermay\|sk', null, null, null, false/i);
});
