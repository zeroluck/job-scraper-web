import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../../../supabase/migrations/202610040002_normalize_keyword_insight_case.sql",
    import.meta.url,
  ),
  "utf8",
);

test("keyword aggregates use case-insensitive identity and distinct job counts", () => {
  assert.match(
    migration,
    /create index if not exists idx_job_keyword_insights_keyword_key_category_job[\s\S]+lower\(btrim\(keyword\)\), category, job_id/i,
  );
  assert.match(
    migration,
    /create index if not exists idx_keyword_insights_keyword_key_category_label[\s\S]+lower\(btrim\(keyword\)\), category, keyword/i,
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
  assert.match(
    migration,
    /from public\.keyword_insights ki[\s\S]+join page p[\s\S]+order by lc\.keyword_key, lc\.category, lc\.label_count desc, lc\.keyword asc/i,
  );
});

test("keyword drill-down uses the same case-insensitive identity", () => {
  assert.match(
    migration,
    /lower\(btrim\(jki\.keyword\)\) = lower\(btrim\(p_keyword\)\)/i,
  );
  assert.match(migration, /least\(greatest\(p_limit,0\),100\)/i);
  assert.match(migration, /select null::text, m\.total_count/i);
});

test("keyword RPCs remain service-only and retain aggregate work memory", () => {
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
  assert.match(
    migration,
    /revoke all on function public\.get_keyword_job_ids[\s\S]+from public, anon, authenticated;/i,
  );
  assert.match(
    migration,
    /grant execute on function public\.get_keyword_job_ids[\s\S]+to service_role;/i,
  );
});
