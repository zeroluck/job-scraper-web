import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../../supabase/migrations/20260919044413_location_map_insights.sql", import.meta.url),
  "utf8",
);
const coordinateSeed = readFileSync(
  new URL("../../../supabase/migrations/20260919050342_canada_place_coordinates.sql", import.meta.url),
  "utf8",
);

test("map insights reuse filtered cached rows and return aggregate coordinates", () => {
  assert.match(migration, /from public\.job_location_buckets b/i);
  assert.match(migration, /left join public\.insight_place_coordinates pc on pc\.bucket = a\.bucket/i);
  assert.match(migration, /percentile_cont\(0\.5\)/i);
  assert.match(migration, /count\(coalesce\(s\.observed_rate, s\.initial_rate\)\)/i);
  assert.doesNotMatch(migration, /coalesce\(s\.observed_rate, s\.initial_rate, 0\)/i);
});

test("map tables and RPC remain service-role only", () => {
  assert.match(migration, /revoke all on table public\.insight_place_coordinates from public, anon, authenticated/i);
  assert.match(migration, /revoke all on function public\.get_location_insights_date_bounds[\s\S]+from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.get_location_insights_date_bounds[\s\S]+to service_role/i);
});

test("Canadian seed covers cities, metros, and provinces", () => {
  const rows = coordinateSeed.match(/\('[cmp]:/g) ?? [];
  assert.ok(rows.length >= 400);
  assert.match(coordinateSeed, /\('m:toronto'/i);
  assert.match(coordinateSeed, /\('p:nu'/i);
  assert.match(coordinateSeed, /\('c:mississauga\|on'/i);
  assert.match(coordinateSeed, /GeoNames/);
});
