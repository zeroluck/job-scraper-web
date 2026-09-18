import assert from "node:assert/strict";
import test from "node:test";

import { executeLocationJobsQuery } from "./queries.ts";

test("location jobs pass labels through with bounded pagination", async () => {
  let call: { name: string; params: Record<string, unknown> } | undefined;
  const supabase = {
    async rpc(name: string, params: Record<string, unknown>) {
      call = { name, params };
      return {
        data: [{ job_id: "a", total_count: 1223 }, { job_id: "b", total_count: 1223 }],
        error: null,
      };
    },
  };

  const result = await executeLocationJobsQuery(supabase, {
    granularity: "city",
    label: "  Montreal  ",
    page: 2,
    pageSize: 500,
  });

  assert.equal(call?.name, "get_location_job_ids_date_bounds");
  assert.equal(call?.params.p_granularity, "city");
  assert.equal(call?.params.p_fold_suburbs, false);
  assert.equal(call?.params.p_place_view, "all");
  assert.equal(call?.params.p_posted_after, null);
  assert.equal(call?.params.p_posted_before, null);
  assert.equal(call?.params.p_label, "Montreal");
  assert.equal(call?.params.p_limit, 100);
  assert.equal(call?.params.p_offset, 100);
  assert.deepEqual(result, { jobIds: ["a", "b"], totalCount: 1223 });
});

test("blank labels are rejected before the RPC", async () => {
  let called = false;
  const supabase = {
    async rpc() {
      called = true;
      return { data: [], error: null };
    },
  };

  await assert.rejects(
    executeLocationJobsQuery(supabase, { granularity: "province", label: "   " }),
    /1-200 characters/,
  );
  assert.equal(called, false);
});
