import assert from "node:assert/strict";
import test from "node:test";

import { executeLocationJobsQuery } from "./queries.ts";

test("location jobs map metro codes with bounded pagination", async () => {
  let call: { name: string; params: Record<string, unknown> } | undefined;
  const supabase = {
    async rpc(name: string, params: Record<string, unknown>) {
      call = { name, params };
      return {
        data: [{ job_id: "a", total_count: 1427 }, { job_id: "b", total_count: 1427 }],
        error: null,
      };
    },
  };

  const result = await executeLocationJobsQuery(supabase, {
    granularity: "city",
    code: "toronto",
    page: 2,
    pageSize: 500,
  });

  assert.equal(call?.name, "get_location_job_ids");
  assert.equal(call?.params.p_granularity, "city");
  assert.equal(call?.params.p_metro, "toronto");
  assert.equal(call?.params.p_province, "");
  assert.equal(call?.params.p_limit, 100);
  assert.equal(call?.params.p_offset, 100);
  assert.deepEqual(result, { jobIds: ["a", "b"], totalCount: 1427 });
});

test("null province codes use the empty-string sentinel", async () => {
  let call: { name: string; params: Record<string, unknown> } | undefined;
  const supabase = {
    async rpc(name: string, params: Record<string, unknown>) {
      call = { name, params };
      return { data: [{ job_id: null, total_count: 324 }], error: null };
    },
  };

  const result = await executeLocationJobsQuery(supabase, {
    granularity: "province",
    code: null,
  });

  assert.equal(call?.params.p_granularity, "province");
  assert.equal(call?.params.p_metro, "");
  assert.equal(call?.params.p_province, "");
  assert.deepEqual(result, { jobIds: [], totalCount: 324 });
});
