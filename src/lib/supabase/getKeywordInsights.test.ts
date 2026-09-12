import assert from "node:assert/strict";
import test from "node:test";

import {
  __resetKeywordInsightsClientFactoryForTests,
  __setKeywordInsightsClientFactoryForTests,
  getKeywordInsights,
} from "./queries.ts";

test.afterEach(() => {
  __resetKeywordInsightsClientFactoryForTests();
});

test("getKeywordInsights fetches a single bounded batch and keeps totalCount", async () => {
  const calls: { p_limit: number; p_offset: number }[] = [];
  const batch = Array.from({ length: 250 }, (_, index) => ({
    keyword: `kw-${index + 1}`,
    category: "skill",
    count: 10,
    total_count: 8345,
    last_updated: "2026-06-11",
  }));

  __setKeywordInsightsClientFactoryForTests(async () => ({
    async rpc(name: string, params: { p_limit: number; p_offset: number }) {
      assert.equal(name, "get_filtered_keyword_insights");
      calls.push({ p_limit: params.p_limit, p_offset: params.p_offset });
      return { data: batch, error: null };
    },
  }));

  const result = await getKeywordInsights();

  assert.deepEqual(calls, [{ p_limit: 250, p_offset: 0 }]);
  assert.equal(result.totalCount, 8345);
  assert.equal(result.keywords.length, 250);
  assert.equal(result.keywords[0]?.keyword, "kw-1");
  assert.equal("total_count" in result.keywords[0]!, false);
});

test("getKeywordInsights returns an empty aggregate result without requesting another batch", async () => {
  let calls = 0;
  __setKeywordInsightsClientFactoryForTests(async () => ({
    async rpc() {
      calls += 1;
      return { data: [], error: null };
    },
  }));

  const result = await getKeywordInsights({ archetypes: [], minCount: -10 });

  assert.deepEqual(result, { keywords: [], totalCount: 0 });
  assert.equal(calls, 1);
});
