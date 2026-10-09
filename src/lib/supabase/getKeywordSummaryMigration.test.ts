import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../../../supabase/migrations/202610090002_keyword_insights_summary.sql",
    import.meta.url,
  ),
  "utf8",
);

test("keyword summary pre-aggregates the default hot shape", () => {
  assert.match(
    migration,
    /create table if not exists public\.keyword_insights_summary/i,
  );
  assert.match(
    migration,
    /create or replace function public\.refresh_keyword_insights_summary\(\)/i,
  );
  assert.match(migration, /get_filtered_keyword_insights\(/i);
  assert.match(migration, /100000/);
  assert.match(migration, /cron\.schedule\(\s*'refresh-keyword-insights-summary'\s*,\s*'\*\/15 \* \* \* \*'/i);
});

test("keyword summary remains service-only", () => {
  assert.match(
    migration,
    /revoke all on table public\.keyword_insights_summary from public, anon, authenticated;/i,
  );
  assert.match(
    migration,
    /grant select on table public\.keyword_insights_summary to service_role;/i,
  );
  assert.match(
    migration,
    /revoke all on function public\.refresh_keyword_insights_summary\(\) from public, anon, authenticated;/i,
  );
  assert.match(
    migration,
    /grant execute on function public\.refresh_keyword_insights_summary\(\) to service_role;/i,
  );
});
