import assert from "node:assert/strict";
import test from "node:test";

import { executeLocationInsightsQuery } from "./queries.ts";

function stubRpc(rows: unknown[]) {
  let call: { name: string; params: Record<string, unknown> } | undefined;
  const supabase = {
    async rpc(name: string, params: Record<string, unknown>) {
      call = { name, params };
      return { data: rows, error: null };
    },
  };
  return { supabase, call: () => call };
}

test("location insights default to unfolded cities and parse census rates", async () => {
  const { supabase, call } = stubRpc([
    {
      label: "Mississauga",
      bucket: "c:mississauga|on",
      count: 417,
      total_count: 900,
      last_updated: null,
      population_2021: 717961,
      per_100k: 58.1,
      stabilized_per_100k: 41.4,
      rate_reliability: 0.93,
      geo_match_quality: "exact",
      is_cma_component: true,
      latitude: 43.589,
      longitude: -79.644,
      contention_jobs: 200,
      observed_contention_jobs: 150,
      applicants_per_hour: 4.25,
      initial_applicants_median: 12,
      first_observation_lag_hours: 3.5,
    },
    {
      label: "Unspecified",
      count: 3,
      total_count: 900,
      last_updated: null,
      population_2021: null,
      per_100k: null,
      stabilized_per_100k: null,
      rate_reliability: null,
    },
  ]);

  const result = await executeLocationInsightsQuery(supabase, {
    granularity: "city",
  });

  assert.equal(call()?.name, "get_location_insights_date_bounds");
  assert.equal(call()?.params.p_granularity, "city");
  assert.equal(call()?.params.p_fold_suburbs, false);
  assert.equal(call()?.params.p_place_view, "all");
  assert.equal(call()?.params.p_posted_after, null);
  assert.equal(call()?.params.p_posted_before, null);
  assert.equal(result.totalCount, 900);
  assert.deepEqual(result.keywords[0], {
    keyword: "Mississauga",
    category: "location",
    bucket: "c:mississauga|on",
    count: 417,
    last_updated: null,
    population_2021: 717961,
    per_100k: 58.1,
    stabilized_per_100k: 41.4,
    rate_reliability: 0.93,
    geo_match_quality: "exact",
    is_cma_component: true,
    latitude: 43.589,
    longitude: -79.644,
    contention_jobs: 200,
    observed_contention_jobs: 150,
    applicants_per_hour: 4.25,
    initial_applicants_median: 12,
    first_observation_lag_hours: 3.5,
  });
  assert.equal(result.keywords[1]?.per_100k, null);
  assert.equal(result.keywords[1]?.stabilized_per_100k, null);
});

test("location insights forward small-town view and retain null numeric fields", async () => {
  const { supabase, call } = stubRpc([{ label: "Moosonee", count: 1, total_count: 1, population_2021: null, per_100k: null, stabilized_per_100k: null, rate_reliability: null }]);
  const result = await executeLocationInsightsQuery(supabase, { placeView: "small_town" });
  assert.equal(call()?.params.p_place_view, "small_town");
  assert.equal(result.keywords[0]?.population_2021, null);
  assert.equal(result.keywords[0]?.per_100k, null);
});

test("location insights forward the fold flag", async () => {
  const { supabase, call } = stubRpc([]);
  await executeLocationInsightsQuery(supabase, {
    granularity: "city",
    foldSuburbs: true,
  });
  assert.equal(call()?.params.p_fold_suburbs, true);
});

test("location insights send inclusive calendar date bounds", async () => {
  const { supabase, call } = stubRpc([]);
  await executeLocationInsightsQuery(supabase, {
    postedAfter: "2026-09-01",
    postedBefore: "2026-09-18",
  });
  assert.equal(call()?.params.p_posted_after, "2026-09-01T00:00:00.000Z");
  assert.equal(call()?.params.p_posted_before, "2026-09-19T00:00:00.000Z");
});
