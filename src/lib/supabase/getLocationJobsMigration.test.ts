import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../../supabase/migrations/202609180006_location_fold_percapita.sql", import.meta.url),
  "utf8",
);

test("location resolution unfolds suburbs by default with opt-in metro folding", () => {
  // Alias table (created in 0004) still drives suburb -> metro folding,
  // but only when asked; 0006 extends it for the Quebec half of Ottawa.
  assert.match(migration, /into public\.metro_aliases/i);
  assert.match(migration, /\('gatineau', 'QC', 'ottawa_gatineau'\)/i);
  // Folding is an explicit flag, defaulting to unfolded cities.
  assert.match(migration, /fold_suburbs boolean default false/i);
  // Core cities stay on the metro bucket even when unfolded.
  assert.match(migration, /metro_is_core/i);
  // Folded metros render as "Greater <Metro>".
  assert.match(migration, /'Greater Toronto'/);
  assert.match(migration, /metro_folded_display/i);
  // Scope-wide listings break out instead of collapsing to Unspecified.
  assert.match(migration, /'Canada-wide'/);
  assert.match(migration, /'-wide'/);
  assert.match(migration, /'Unspecified'/);
  // Cross-province city collisions get qualified.
  assert.match(migration, /collisions/i);
});

test("province view resolves metro-only rows via metro_province", () => {
  assert.match(migration, /metro_province/i);
  assert.match(migration, /WHEN 'calgary' THEN 'ab'/i);
  assert.match(migration, /WHEN 'ottawa_gatineau' THEN 'on'/i);
});

test("location RPCs resolve display labels with service-only grants", () => {
  assert.match(migration, /location_label_bucket\(p_label, p_granularity, p_fold_suburbs\)/i);
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

test("location insights expose census denominators for per-capita rates", () => {
  assert.match(migration, /census_population_2021/i);
  assert.match(migration, /population_2021/i);
  assert.match(migration, /per_100k/i);
});
