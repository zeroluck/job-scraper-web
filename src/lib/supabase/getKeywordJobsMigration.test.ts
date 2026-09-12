import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../../supabase/migrations/202609120003_fix_keyword_job_drilldown.sql", import.meta.url),
  "utf8",
);

test("keyword-job RPC keeps bounded empty-page metadata and service-only grants", () => {
  assert.match(migration, /least\(greatest\(p_limit,0\),100\)/i);
  assert.match(migration, /select null::text, m\.total_count/i);
  assert.match(migration, /where not exists \(select 1 from page\)/i);
  assert.match(migration, /p_keyword is not null and jki\.keyword = p_keyword/i);
  assert.match(
    migration,
    /revoke all on function public\.get_keyword_job_ids[\s\S]+from public, anon, authenticated;/i,
  );
  assert.match(
    migration,
    /grant execute on function public\.get_keyword_job_ids[\s\S]+to service_role;/i,
  );
});
