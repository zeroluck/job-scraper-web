import test from "node:test";
import assert from "node:assert/strict";

import {
  __resetKeywordInsightsClientFactoryForTests,
  __setKeywordInsightsClientFactoryForTests,
  getKeywordInsights,
} from "./queries.ts";

type KeywordInsight = {
  keyword: string;
  category: string;
  count: number;
  last_updated?: string | null;
};

type QueryCall = {
  method: "rpc";
  args: [
    name: string,
    params: {
      p_providers: string[] | null;
      p_archetypes: string[] | null;
      p_levels: string[] | null;
      p_filter_status: string;
      p_companies: string[] | null;
      p_job_titles: string[] | null;
      p_provinces: string[] | null;
      p_location_scopes: string[] | null;
      p_exclude_metros: string[] | null;
      p_category: string | null;
      p_min_count: number;
      p_limit: number;
      p_offset: number;
    },
  ];
};

function createSupabaseMock(responseData: Array<KeywordInsight & { total_count?: number }> = [{
  keyword: "roadmap",
  category: "skill",
  count: 5,
  total_count: 1,
  last_updated: "2026-06-11",
}]) {
  const calls: QueryCall[] = [];

  return {
    calls,
    client: {
      async rpc(name: string, params: QueryCall["args"][1]) {
        calls.push({ method: "rpc", args: [name, params] });
        const data = responseData.map((row) => ({
          ...row,
          total_count: row.total_count ?? responseData.length,
        }));
        return {
          data,
          error: null,
        };
      },
    },
  };
}

function filterScopedKeywordInsightsByCategory(
  keywords: KeywordInsight[],
  category: KeywordInsight["category"] | "all",
) {
  return category === "all"
    ? keywords
    : keywords.filter((keyword) => keyword.category === category);
}

test.afterEach(() => {
  __resetKeywordInsightsClientFactoryForTests();
});

test("getKeywordInsights calls the filtered RPC with safe defaults", async () => {
  const { client, calls } = createSupabaseMock();

  __setKeywordInsightsClientFactoryForTests(async () => client);

  const result = await getKeywordInsights();

  assert.equal(result.totalCount, 1);
  assert.deepEqual(calls, [
    {
      method: "rpc",
      args: ["get_filtered_keyword_insights", {
        p_providers: null,
        p_archetypes: ["technology_delivery", "software_tpm"],
        p_levels: null,
        p_filter_status: "unfiltered",
        p_companies: null,
        p_job_titles: null,
        p_provinces: null,
        p_location_scopes: null,
        p_exclude_metros: null,
        p_category: null,
        p_min_count: 2,
        p_limit: 250,
        p_offset: 0,
      }],
    },
  ]);
});

test("getKeywordInsights maps array filters and status to RPC parameters", async () => {
  const mock = createSupabaseMock();
  __setKeywordInsightsClientFactoryForTests(async () => mock.client);

  await getKeywordInsights({
    providers: ["linkedin", "careers_future"],
    archetypes: ["software_tpm", "data_pm"],
    levels: ["Entry level"],
    filterStatus: "show_filtered",
    companies: ["Acme"],
    jobTitles: ["Program Manager"],
    category: "skill",
    minCount: 7,
  });

  assert.deepEqual(mock.calls[0]?.args[1], {
    p_providers: ["linkedin", "careers_future"],
    p_archetypes: ["technology_delivery", "software_tpm", "data_pm"],
    p_levels: ["Entry level"],
    p_filter_status: "all",
    p_companies: ["Acme"],
    p_job_titles: ["Program Manager"],
    p_provinces: null,
    p_location_scopes: null,
    p_exclude_metros: null,
    p_category: "skill",
    p_min_count: 7,
    p_limit: 250,
    p_offset: 0,
  });
});

test("RPC result rows retain category data without total_count metadata", async () => {
  const scopedRows: KeywordInsight[] = [
    {
      keyword: "Roadmapping",
      category: "skill",
      count: 5,
      last_updated: "2026-06-11",
    },
    {
      keyword: "Python",
      category: "technology",
      count: 2,
      last_updated: "2026-06-11",
    },
    {
      keyword: "PMP",
      category: "certification",
      count: 3,
      last_updated: "2026-06-11",
    },
  ];

  const { client } = createSupabaseMock(scopedRows);
  __setKeywordInsightsClientFactoryForTests(async () => client);

  const result = await getKeywordInsights({ archetype: "software_tpm" });
  const technologyRows = filterScopedKeywordInsightsByCategory(result.keywords, "technology");

  assert.deepEqual(technologyRows, [
    {
      keyword: "Python",
      category: "technology",
      count: 2,
      last_updated: "2026-06-11",
    },
  ]);
});
