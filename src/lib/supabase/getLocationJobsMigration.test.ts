import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../../supabase/migrations/202609180004_location_display_resolution.sql", import.meta.url),
  "utf8",
);

test("location resolution folds suburbs and buckets scopes", () => {
  // Alias table drives suburb -> metro folding.
  assert.match(migration, /create table if not exists public\.metro_aliases/i);
  assert.match(migration, /\('brossard', 'QC', 'montreal'\)/i);
  assert.match(migration, /\('kanata', 'ON', 'ottawa_gatineau'\)/i);
  assert.match(migration, /\('london', '', 'london'\)/i);
  // Scope-wide listings break out instead of collapsing to Unspecified.
  assert.match(migration, /'Canada-wide'/);
  assert.match(migration, /'-wide'/);
  assert.match(migration, /'Unspecified'/);
  // Cross-province city collisions get qualified.
  assert.match(migration, /collisions/i);
});

test("location RPCs resolve display labels with service-only grants", () => {
  assert.match(migration, /location_label_bucket\(p_label, p_granularity\)/i);
  assert.match(migration, /least\(greatest\(p_limit,0\),100\)/i);
  assert.match(migration, /select null::text, m\.total_count/i);
  assert.match(migration, /where not exists \(select 1 from page\)/i);
  assert.match(
    migration,
    /revoke all on function public\.get_location_insights[\s\S]+from public, anon, authenticated;/i,
  );
  assert.match(
    migration,
    /grant execute on function public\.get_location_insights[\s\S]+to service_role;/i,
  );
  assert.match(
    migration,
    /revoke all on function public\.get_location_job_ids[\s\S]+from public, anon, authenticated;/i,
  );
  assert.match(
    migration,
    /grant execute on function public\.get_location_job_ids[\s\S]+to service_role;/i,
  );
});
