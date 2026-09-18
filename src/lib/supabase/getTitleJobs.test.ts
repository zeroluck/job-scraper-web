import assert from "node:assert/strict";
import test from "node:test";

import { executeTitleJobsQuery } from "./queries.ts";

test("title jobs match normalized labels with bounded pagination", async () => {
  let call: { name: string; params: Record<string, unknown> } | undefined;
  const supabase = {
    async rpc(name: string, params: Record<string, unknown>) {
      call = { name, params };
      return {
        data: [{ job_id: "a", total_count: 194 }],
        error: null,
      };
    },
  };

  const result = await executeTitleJobsQuery(supabase, {
    label: "Project Manager",
    page: 1,
    pageSize: 500,
  });

  assert.equal(call?.name, "get_title_job_ids");
  assert.equal(call?.params.p_title, "Project Manager");
  assert.equal(call?.params.p_limit, 100);
  assert.equal(call?.params.p_offset, 0);
  assert.deepEqual(result, { jobIds: ["a"], totalCount: 194 });
});

test("blank titles are rejected before the RPC", async () => {
  let called = false;
  const supabase = {
    async rpc() {
      called = true;
      return { data: [], error: null };
    },
  };

  await assert.rejects(
    executeTitleJobsQuery(supabase, { label: "  " }),
    /1-200 characters/,
  );
  assert.equal(called, false);
});
