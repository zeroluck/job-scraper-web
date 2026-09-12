import assert from "node:assert/strict";
import test from "node:test";

import { executeKeywordJobsQuery } from "./queries.ts";

test("keyword jobs use bounded pagination and retain sentinel totals", async () => {
  let call: { name: string; params: Record<string, unknown> } | undefined;
  const supabase = {
    async rpc(name: string, params: Record<string, unknown>) {
      call = { name, params };
      return {
        data: [{ job_id: null, total_count: 42 }],
        error: null,
      };
    },
  };

  const result = await executeKeywordJobsQuery(supabase, {
    keyword: "  Python  ",
    page: 3,
    pageSize: 500,
  });

  assert.equal(call?.name, "get_keyword_job_ids");
  assert.equal(call?.params.p_keyword, "Python");
  assert.equal(call?.params.p_filter_status, "unfiltered");
  assert.equal(call?.params.p_limit, 100);
  assert.equal(call?.params.p_offset, 200);
  assert.deepEqual(result, { jobIds: [], totalCount: 42 });
});

test("keyword jobs reject blank and oversized keywords", async () => {
  const supabase = { rpc: () => assert.fail("RPC must not be called") };
  await assert.rejects(
    executeKeywordJobsQuery(supabase, { keyword: " " }),
    /keyword of 1-200 characters/,
  );
  await assert.rejects(
    executeKeywordJobsQuery(supabase, { keyword: "x".repeat(201) }),
    /keyword of 1-200 characters/,
  );
});
