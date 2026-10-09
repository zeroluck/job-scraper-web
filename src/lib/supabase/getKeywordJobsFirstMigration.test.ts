import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../../../supabase/migrations/202610090001_qualify_jobs_first_keyword_insights.sql",
    import.meta.url,
  ),
  "utf8",
);

test("keyword aggregate drives from materialized qualifying jobs", () => {
  assert.match(migration, /with qualified_jobs as materialized/i);
  assert.match(
    migration,
    /join qualified_jobs q on q\.job_id = jki\.job_id/i,
  );
  assert.match(
    migration,
    /create index if not exists idx_job_keyword_insights_archetype_job[\s\S]+on public\.job_keyword_insights \(archetype, job_id\)/i,
  );
});

test("keyword aggregate keeps exact per-row lane match and identity", () => {
  assert.match(
    migration,
    /m\.archetype = case when jki\.archetype = 'software_tpm' then 'technology_delivery' else jki\.archetype end/i,
  );
  assert.match(migration, /lower\(btrim\(jki\.keyword\)\) as keyword_key/i);
  assert.match(
    migration,
    /group by lower\(btrim\(jki\.keyword\)\), jki\.category/i,
  );
  assert.match(
    migration,
    /count\(distinct jki\.job_id\)::bigint as insight_count/i,
  );
});

test("keyword RPC remains service-only and retains aggregate settings", () => {
  assert.match(
    migration,
    /revoke all on function public\.get_filtered_keyword_insights[\s\S]+from public, anon, authenticated;/i,
  );
  assert.match(
    migration,
    /grant execute on function public\.get_filtered_keyword_insights[\s\S]+to service_role;/i,
  );
  assert.match(migration, /set work_mem = '256MB'/i);
  assert.match(migration, /set plan_cache_mode = force_custom_plan/i);
});
