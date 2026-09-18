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
      count: 417,
      total_count: 900,
      last_updated: null,
      population_2021: 717961,
      per_100k: 58.1,
    },
    {
      label: "Unspecified",
      count: 3,
      total_count: 900,
      last_updated: null,
      population_2021: null,
      per_100k: null,
    },
  ]);

  const result = await executeLocationInsightsQuery(supabase, {
    granularity: "city",
  });

  assert.equal(call()?.name, "get_location_insights");
  assert.equal(call()?.params.p_granularity, "city");
  assert.equal(call()?.params.p_fold_suburbs, false);
  assert.equal(result.totalCount, 900);
  assert.deepEqual(result.keywords[0], {
    keyword: "Mississauga",
    category: "location",
    count: 417,
    last_updated: null,
    population_2021: 717961,
    per_100k: 58.1,
  });
  assert.equal(result.keywords[1]?.per_100k, null);
});

test("location insights forward the fold flag", async () => {
  const { supabase, call } = stubRpc([]);
  await executeLocationInsightsQuery(supabase, {
    granularity: "city",
    foldSuburbs: true,
  });
  assert.equal(call()?.params.p_fold_suburbs, true);
});
