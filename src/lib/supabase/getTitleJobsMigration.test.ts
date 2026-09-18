import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../../supabase/migrations/202609180005_title_insights.sql", import.meta.url),
  "utf8",
);

test("title aggregate normalizes spellings with service-only grants", () => {
  // Jobs-table only: titles can never leak into keyword/location tabs.
  assert.ok(!/job_keyword_insights/i.test(migration.replace(/--.*$/gm, "")));
  assert.match(migration, /lower\(btrim\(j\.job_title\)\)/i);
  assert.match(migration, /least\(greatest\(p_limit,0\),100\)/i);
  assert.match(migration, /select null::text, m\.total_count/i);
  assert.match(migration, /where not exists \(select 1 from page\)/i);
  assert.match(
    migration,
    /revoke all on function public\.get_title_insights[\s\S]+from public, anon, authenticated;/i,
  );
  assert.match(
    migration,
    /grant execute on function public\.get_title_insights[\s\S]+to service_role;/i,
  );
  assert.match(
    migration,
    /revoke all on function public\.get_title_job_ids[\s\S]+from public, anon, authenticated;/i,
  );
  assert.match(
    migration,
    /grant execute on function public\.get_title_job_ids[\s\S]+to service_role;/i,
  );
});
