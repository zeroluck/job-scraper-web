import assert from "node:assert/strict";
import test from "node:test";

import {
  executeHotKeywordInsightsQuery,
  executeKeywordInsightsQuery,
  hotKeywordInsightsShape,
} from "./queries.ts";

const ALL_LANES = [
  "technology_delivery",
  "systems_platform_ops",
  "network_infrastructure",
  "datacenter_operations",
  "ai_workflow_automation",
  "building_controls",
];

function createSummaryClient(rows: unknown[] = [{
  keyword: "Python",
  category: "technology",
  count: 3773,
  last_updated: "2026-10-09T00:00:00Z",
}], count: number | null = 21493) {
  const calls: unknown[][] = [];
  const builder: any = {
    select(fields: string, opts?: unknown) {
      calls.push(["select", fields, opts]);
      return builder;
    },
    eq(field: string, value: unknown) {
      calls.push(["eq", field, value]);
      return builder;
    },
    order(field: string, opts?: unknown) {
      calls.push(["order", field, opts]);
      return builder;
    },
    limit(value: number) {
      calls.push(["limit", value]);
      return builder;
    },
    then(resolve: (value: unknown) => void) {
      resolve({ data: rows, error: null, count });
    },
  };
  return {
    calls,
    client: {
      from(table: string) {
        calls.push(["from", table]);
        return builder;
      },
      rpc() {
        throw new Error("live RPC must not run for hot shapes");
      },
    },
  };
}

test("hot shape matches the default all-lanes unfiltered aggregate", () => {
  assert.deepEqual(
    hotKeywordInsightsShape({ archetypes: ALL_LANES, minCount: 2 }),
    { shapeKey: "v1:default", category: null },
  );
  assert.deepEqual(
    hotKeywordInsightsShape({ archetypes: ALL_LANES, category: "skill" }),
    { shapeKey: "v1:default", category: "skill" },
  );
  assert.deepEqual(
    hotKeywordInsightsShape({ archetypes: ALL_LANES, category: "all" }),
    { shapeKey: "v1:default", category: null },
  );
});

test("hot shape rejects filtered or non-default aggregates", () => {
  assert.equal(hotKeywordInsightsShape({}), null);
  assert.equal(
    hotKeywordInsightsShape({ archetypes: ALL_LANES, companies: ["Acme"] }),
    null,
  );
  assert.equal(
    hotKeywordInsightsShape({ archetypes: ALL_LANES, category: "title" }),
    null,
  );
  assert.equal(
    hotKeywordInsightsShape({ archetypes: ALL_LANES, minCount: 7 }),
    null,
  );
  assert.equal(
    hotKeywordInsightsShape({ archetypes: ALL_LANES, filterStatus: "filtered" }),
    null,
  );
  assert.equal(
    hotKeywordInsightsShape({ archetypes: ["technology_delivery"] }),
    null,
  );
  assert.equal(
    hotKeywordInsightsShape({ archetypes: ALL_LANES, providers: ["linkedin"] }),
    null,
  );
});

test("hot query reads the summary table with exact total", async () => {
  const { client, calls } = createSummaryClient();
  const result = await executeHotKeywordInsightsQuery(
    client,
    { shapeKey: "v1:default", category: null },
    250,
  );

  assert.equal(result.totalCount, 21493);
  assert.equal(result.keywords.length, 1);
  assert.deepEqual(calls[0], ["from", "keyword_insights_summary"]);
  assert.deepEqual(calls[1], [
    "select",
    "keyword, category, count, last_updated",
    { count: "exact" },
  ]);
  assert.ok(calls.some((call) => call[0] === "limit" && call[1] === 250));
});

test("hot category tab filters by category", async () => {
  const { client, calls } = createSummaryClient();
  await executeHotKeywordInsightsQuery(
    client,
    { shapeKey: "v1:default", category: "skill" },
    250,
  );

  assert.ok(calls.some((call) => call[0] === "eq" && call[1] === "category" && call[2] === "skill"));
});

test("keyword insights prefer the summary and fall back when empty", async () => {
  const hot = createSummaryClient();
  const result = await executeKeywordInsightsQuery(hot.client as any, {
    archetypes: ALL_LANES,
    minCount: 2,
  });
  assert.equal(result.totalCount, 21493);
  assert.ok(hot.calls.some((call) => call[0] === "from"));

  let rpcCalled = false;
  const empty = createSummaryClient([], 0);
  const fallbackClient = {
    ...empty.client,
    async rpc() {
      rpcCalled = true;
      return { data: [], error: null };
    },
  };
  const fallback = await executeKeywordInsightsQuery(fallbackClient as any, {
    archetypes: ALL_LANES,
    minCount: 2,
  });
  assert.equal(rpcCalled, true);
  assert.deepEqual(fallback.keywords, []);
});
