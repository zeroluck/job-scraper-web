import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const aggregate = readFileSync(
  new URL("../../../supabase/migrations/202609180002_get_location_insights.sql", import.meta.url),
  "utf8",
);

const drilldown = readFileSync(
  new URL("../../../supabase/migrations/202609180003_get_location_job_ids.sql", import.meta.url),
  "utf8",
);

test("location aggregate segregates to jobs table with service-only grants", () => {
  // No keyword-table reads: locations can never leak into keyword tabs.
  assert.ok(!/from\s+public\.job_keyword_insights/i.test(aggregate));
  assert.ok(!/join\s+public\.job_keyword_insights/i.test(aggregate));
  assert.match(aggregate, /group by s\.loc_code/i);
  assert.match(aggregate, /p_granularity = 'province'/i);
  assert.match(
    aggregate,
    /revoke all on function public\.get_location_insights[\s\S]+from public, anon, authenticated;/i,
  );
  assert.match(
    aggregate,
    /grant execute on function public\.get_location_insights[\s\S]+to service_role;/i,
  );
});

test("location drill-down keeps bounded empty-page metadata and grants", () => {
  assert.match(drilldown, /least\(greatest\(p_limit,0\),100\)/i);
  assert.match(drilldown, /select null::text, m\.total_count/i);
  assert.match(drilldown, /where not exists \(select 1 from page\)/i);
  assert.match(drilldown, /p_granularity <> 'city'/i);
  assert.match(drilldown, /p_metro = '' and j\.location_metro is null/i);
  assert.match(
    drilldown,
    /revoke all on function public\.get_location_job_ids[\s\S]+from public, anon, authenticated;/i,
  );
  assert.match(
    drilldown,
    /grant execute on function public\.get_location_job_ids[\s\S]+to service_role;/i,
  );
});
