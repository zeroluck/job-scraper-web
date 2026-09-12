import assert from "node:assert/strict";
import test from "node:test";
import { isDeepStrictEqual } from "node:util";

import {
  __resetSupabaseClientFactoryForTests,
  __setSupabaseClientFactoryForTests,
  getAllJobs,
  getAllJobsCount,
  getAllActiveJobsCount,
  getAppliedJobs,
  getAppliedJobsCount,
  getDistinctCompanies,
  getDistinctJobTitles,
  getJobFilterSuggestions,
  getJobKeywordInsights,
  getNewJobs,
  getTopScoredJobs,
  getTopScoredJobsCount,
  JOB_LIST_SELECT,
  type JobListQueryOptions,
} from "./queries.ts";
import { SORT_FIELDS, type SortField, type SortOrder } from "../filters/types.ts";

type Call = { method: string; args: unknown[] };

function createQueryClient(options: {
  data?: unknown[];
  count?: number;
  rangeData?: unknown[][];
  rpc?: (name: string, params: Record<string, unknown>) => unknown[];
} = {}) {
  const calls: Call[] = [];
  const response = {
    data: options.data ?? [],
    count: options.count ?? 0,
    error: null,
  };
  const query: Record<string, any> = {};
  let rangeIndex = 0;

  for (const method of [
    "select",
    "eq",
    "in",
    "is",
    "or",
    "gte",
    "lte",
    "not",
    "order",
  ]) {
    query[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return query;
    };
  }

  query.range = async (...args: unknown[]) => {
    calls.push({ method: "range", args });
    return options.rangeData
      ? { ...response, data: options.rangeData[rangeIndex++] ?? [] }
      : response;
  };
  query.then = (resolve: (value: typeof response) => unknown) => resolve(response);

  return {
    calls,
    client: {
      from(table: string) {
        calls.push({ method: "from", args: [table] });
        return query;
      },
      async rpc(name: string, params: Record<string, unknown>) {
        calls.push({ method: "rpc", args: [name, params] });
        return {
          data: options.rpc?.(name, params) ?? [],
          error: null,
        };
      },
    },
  };
}

function predicates(calls: Call[]) {
  return calls.filter((call) => [
    "eq",
    "in",
    "is",
    "or",
    "gte",
    "lte",
    "not",
  ].includes(call.method));
}

function hasCall(calls: Call[], method: string, ...args: unknown[]) {
  return calls.some((call) => call.method === method && isDeepStrictEqual(call.args, args));
}

async function rowCalls(
  getter: (options?: JobListQueryOptions) => Promise<unknown[]>,
  options: JobListQueryOptions = {},
) {
  const mock = createQueryClient();
  __setSupabaseClientFactoryForTests(async () => mock.client);
  await getter(options);
  return mock.calls;
}

const jobLists = [
  { name: "all", rows: getAllJobs, count: getAllJobsCount },
  { name: "new", rows: getNewJobs, count: getAllActiveJobsCount },
  { name: "top", rows: getTopScoredJobs, count: getTopScoredJobsCount },
  { name: "applied", rows: getAppliedJobs, count: getAppliedJobsCount },
] as const;

test.afterEach(() => {
  __resetSupabaseClientFactoryForTests();
});

test("job lists use a narrow projection and never select detail payloads", async () => {
  for (const list of jobLists) {
    const calls = await rowCalls(list.rows);
    assert.equal(hasCall(calls, "select", JOB_LIST_SELECT), true, list.name);
    const projection = calls.find((call) => call.method === "select")?.args[0];
    assert.equal(typeof projection, "string");
    assert.equal((projection as string).includes("*"), false, list.name);
    assert.equal((projection as string).includes("description"), false, list.name);
    assert.equal((projection as string).includes("listing_instances"), false, list.name);
  }
});

test("job-list page size is always bounded to 100", async () => {
  for (const pageSize of ["all", 101, 1000] as const) {
    const calls = await rowCalls(getAllJobs, { page: 2, pageSize });
    assert.equal(hasCall(calls, "range", 100, 199), true, String(pageSize));
  }
});

test("all, new, top, and applied row/count queries keep every predicate in parity", async () => {
  for (const list of jobLists) {
    const options: JobListQueryOptions = {
      provider: "linkedin",
      interest: "null",
      minScore: 20,
      maxScore: 90,
      level: ["Entry level", "Mid-Senior level"],
      archetype: ["software_tpm"],
      hasSalary: true,
      salaryMin: 100000,
      salaryMax: 200000,
      minRepostCount: 1,
      minSeenCount: 2,
      province: ["AB", "BC"],
      locationScope: ["local", "country"],
      excludeMetro: ["calgary", "vancouver"],
      datePosted: "7d",
      ...(list.name === "applied" ? { applicationStatus: "offer" as const } : {}),
    };
    const rowMock = createQueryClient();
    const countMock = createQueryClient({ count: 1 });
    const clients = [rowMock.client, countMock.client];
    __setSupabaseClientFactoryForTests(async () => clients.shift());

    await list.rows(options);
    await list.count(options);

    assert.deepEqual(predicates(rowMock.calls), predicates(countMock.calls), list.name);
  }
});

test("lane-filtered normal list and count use canonical membership IDs without relation duplication", async () => {
  const rpcRows = [
    { job_id: "job-1", total_count: 2, row_number: 1 },
    { job_id: "job-2", total_count: 2, row_number: 2 },
  ];
  const mock = createQueryClient({
    data: [{ job_id: "job-1" }, { job_id: "job-2" }],
    rpc: (name) => {
      if (name === "get_job_ids_by_membership_v1") return rpcRows;
      assert.equal(name, "get_job_membership_projection_v1");
      return ["job-1", "job-2"].map((job_id) => ({
        job_id,
        archetype: "technology_delivery",
        resume_score: 75,
        resume_score_stage: "initial",
        is_filtered: false,
        filter_reason: null,
        customized_resume_id: null,
        resume_link: null,
      }));
    },
  });
  __setSupabaseClientFactoryForTests(async () => mock.client);

  const rows = await getNewJobs({ archetype: ["software_tpm", "data_pm"], page: 1, pageSize: 25 });
  assert.deepEqual(rows.map((row) => row.job_id), ["job-1", "job-2"]);
  const rpc = mock.calls.find((call) => call.method === "rpc" && call.args[0] === "get_job_ids_by_membership_v1");
  assert.deepEqual((rpc?.args[1] as any).p_archetypes, ["technology_delivery", "software_tpm", "data_pm"]);
  assert.equal(mock.calls.filter((call) => call.method === "in" && call.args[0] === "job_id").length, 1);
});

test("membership RPC count and list retain exact parity when one job matches multiple lanes", async () => {
  const clients = [
    createQueryClient({ data: [{ job_id: "job-1" }], rpc: () => [{ job_id: "job-1", total_count: 1, row_number: 1 }] }).client,
    createQueryClient({ rpc: () => [{ job_id: "job-1", total_count: 1, row_number: 1 }] }).client,
  ];
  __setSupabaseClientFactoryForTests(async () => clients.shift());
  const options = { archetype: ["technology_delivery", "data_pm"], page: 1, pageSize: 25 };
  assert.equal((await getNewJobs(options)).length, 1);
  assert.equal(await getAllActiveJobsCount(options), 1);
});

test("all jobs has no implicit active, state, status, interest, score, or filtered predicates", async () => {
  const calls = await rowCalls(getAllJobs);

  assert.deepEqual(predicates(calls), []);
  assert.deepEqual(calls.filter((call) => call.method === "order"), [
    {
      method: "order",
      args: ["effective_posted_at", { ascending: false, nullsFirst: false }],
    },
    { method: "order", args: ["job_id", { ascending: true }] },
  ]);
});

test("job-list filters emit their individual Supabase predicates", async () => {
  const cases: Array<{
    name: string;
    options: JobListQueryOptions;
    expected: Call;
  }> = [
    { name: "provider", options: { provider: "linkedin" }, expected: { method: "eq", args: ["provider", "linkedin"] } },
    { name: "interest true", options: { interest: "true" }, expected: { method: "is", args: ["is_interested", true] } },
    { name: "interest false", options: { interest: "false" }, expected: { method: "is", args: ["is_interested", false] } },
    { name: "interest null", options: { interest: "null" }, expected: { method: "is", args: ["is_interested", null] } },
    { name: "minimum score", options: { minScore: 17 }, expected: { method: "gte", args: ["resume_score", 17] } },
    { name: "maximum score", options: { maxScore: 83 }, expected: { method: "lte", args: ["resume_score", 83] } },
    { name: "repeated levels", options: { level: ["Entry level", "Director"] }, expected: { method: "in", args: ["level", ["Entry level", "Director"]] } },
    { name: "repeated archetypes", options: { archetype: ["software_tpm", "data_pm"] }, expected: { method: "rpc", args: ["get_job_ids_by_membership_v1"] } },
    { name: "has salary", options: { hasSalary: true }, expected: { method: "not", args: ["salary_min", "is", null] } },
    { name: "salary minimum", options: { hasSalary: true, salaryMin: 90000 }, expected: { method: "gte", args: ["salary_min", 90000] } },
    { name: "salary maximum", options: { hasSalary: true, salaryMax: 180000 }, expected: { method: "lte", args: ["salary_min", 180000] } },
    { name: "repost minimum", options: { minRepostCount: 2 }, expected: { method: "gte", args: ["repost_count", 2] } },
    { name: "seen minimum", options: { minSeenCount: 3 }, expected: { method: "gte", args: ["seen_count", 3] } },
    { name: "provinces", options: { province: ["AB", "BC"] }, expected: { method: "or", args: ["location_province_code.in.(AB,BC),listing_location_province_codes.ov.{AB,BC}"] } },
    { name: "location scopes", options: { locationScope: ["local", "country"] }, expected: { method: "or", args: ["location_scope.in.(local,country),listing_location_scopes.ov.{local,country}"] } },
    { name: "excluded metros", options: { excludeMetro: ["calgary", "vancouver"] }, expected: { method: "or", args: ["location_metro.is.null,location_metro.not.in.(calgary,vancouver)"] } },
  ];

  for (const item of cases) {
    const calls = await rowCalls(getNewJobs, item.options);
    assert.ok(
      item.expected.method === "rpc"
        ? calls.some((call) => call.method === "rpc" && call.args[0] === item.expected.args[0])
        : hasCall(calls, item.expected.method, ...item.expected.args),
      item.name,
    );
  }

  const noSalary = await rowCalls(getNewJobs, { salaryMin: 90000, salaryMax: 180000 });
  assert.equal(noSalary.some((call) => call.args[0] === "salary_min"), false);
});

test("province filters can include Canada-wide jobs without restricting them to a province", async () => {
  const mock = createQueryClient({ data: [] });
  __setSupabaseClientFactoryForTests(async () => mock.client);

  await getNewJobs({
    province: ["AB", "BC"],
    locationScope: ["local", "country"],
  });

  assert.ok(mock.calls.some((call) =>
    call.method === "or" &&
      call.args[0] ===
        "location_scope.eq.country,listing_location_scopes.cs.{country},and(location_province_code.in.(AB,BC),location_scope.in.(local)),and(listing_location_province_codes.ov.{AB,BC},listing_location_scopes.ov.{local})"
  ));
});

test("interest and filterStatus defaults and overrides are exact", async () => {
  const defaultCalls = await rowCalls(getNewJobs);
  assert.ok(hasCall(defaultCalls, "or", "is_interested.is.null,is_interested.eq.true"));
  assert.ok(hasCall(defaultCalls, "or", "is_filtered.is.null,is_filtered.eq.false"));

  const shownCalls = await rowCalls(getNewJobs, { filterStatus: "show_filtered" });
  assert.equal(predicates(shownCalls).some((call) => String(call.args[0]).includes("is_filtered")), false);

  const entryCalls = await rowCalls(getNewJobs, { filterStatus: "entry_level" });
  assert.ok(hasCall(entryCalls, "eq", "is_entry_level_filtered", true));
  assert.equal(predicates(entryCalls).some((call) => String(call.args[0]).includes("is_filtered")), false);
  assert.equal(predicates(entryCalls).some((call) => String(call.args[0]).includes("is_interested")), false);
  assert.equal(predicates(entryCalls).some((call) => call.args[0] === "resume_score"), false);

  const topCalls = await rowCalls(getTopScoredJobs);
  assert.ok(hasCall(topCalls, "gte", "resume_score", 50));
  assert.ok(hasCall(topCalls, "lte", "resume_score", 100));
  assert.equal(predicates(topCalls).some((call) => String(call.args[0]).includes("is_interested")), false);
});

test("date-posted filters are bounded", async () => {
  for (const [datePosted, hours] of [["24h", 24], ["7d", 168], ["30d", 720]] as const) {
    const now = Date.now();
    const calls = await rowCalls(getNewJobs, { datePosted });
    const cutoff = calls.find(
      (call) => call.method === "gte" && call.args[0] === "effective_posted_at",
    )?.args[1];
    assert.equal(typeof cutoff, "string");
    const age = now - Date.parse(cutoff as string);
    assert.ok(age >= hours * 3_600_000 && age < hours * 3_600_000 + 61_000, datePosted);
  }
});

test("Boolean search uses the safe RPC, hydrates one bounded page, and preserves RPC order", async () => {
  const mock = createQueryClient({
    data: [{ job_id: "2" }, { job_id: "1" }],
    rpc: (name) => name === "search_job_ids_v1"
      ? [
          { job_id: "1", total_count: 42, row_number: 1 },
          { job_id: "2", total_count: 42, row_number: 2 },
        ]
      : [],
  });
  __setSupabaseClientFactoryForTests(async () => mock.client);
  try {
    const options = {
      query: 'TPM AND (cloud OR "program manager") NOT sales',
      page: 1,
      pageSize: 25,
    } as const;
    const rows = await getNewJobs(options);
    const count = await getAllActiveJobsCount(options);
    assert.deepEqual(rows.map((row) => row.job_id), ["1", "2"]);
    assert.equal(count, 42);
    const rpcCalls = mock.calls.filter((call) => call.method === "rpc" && call.args[0] === "search_job_ids_v1");
    assert.equal(rpcCalls.length, 1);
    const params = rpcCalls[0].args[1] as Record<string, unknown>;
    assert.equal(params.p_kind, "new");
    assert.equal(params.p_limit, 25);
    assert.equal(params.p_offset, 0);
    assert.deepEqual(params.p_search_ast, {
      type: "and",
      children: [
        { type: "term", term: "TPM" },
        {
          type: "or",
          children: [
            { type: "term", term: "cloud" },
            { type: "term", term: "program manager" },
          ],
        },
        { type: "term", term: "sales", negated: true },
      ],
    });
    assert.ok(hasCall(mock.calls, "in", "job_id", ["1", "2"]));
  } finally {
    __resetSupabaseClientFactoryForTests();
  }
});

test("Boolean lane search forwards memberships for exact count and deep-page list parity", async () => {
  const hydrated = {
    job_id: "job-501",
    archetype: "technology_delivery",
    resume_score: 11,
    resume_score_stage: "initial",
    is_filtered: false,
    filter_reason: null,
    customized_resume_id: null,
  };
  const mock = createQueryClient({
    data: [hydrated],
    rpc: (name) => {
      if (name === "search_job_ids_v1") {
        return [{ job_id: "job-501", total_count: 777, row_number: 501 }];
      }
      if (name === "get_job_membership_projection_v1") {
        return [{
          job_id: "job-501",
          archetype: "network_infrastructure",
          resume_score: 91,
          resume_score_stage: "custom",
          is_filtered: false,
          filter_reason: null,
          customized_resume_id: "resume-network",
          resume_link: "network.pdf",
        }];
      }
      return [];
    },
  });
  __setSupabaseClientFactoryForTests(async () => mock.client);
  const options: JobListQueryOptions = {
    query: "cloud AND delivery",
    archetype: ["software_tpm", "network_infrastructure"],
    page: 21,
    pageSize: 25,
  };
  const rows = await getNewJobs(options);
  assert.deepEqual(rows.map((job) => job.job_id), ["job-501"]);
  assert.equal(rows[0].archetype, "network_infrastructure");
  assert.equal(rows[0].resume_score, 91);
  assert.equal(rows[0].resume_score_stage, "custom");
  assert.equal(rows[0].customized_resume_id, "resume-network");
  assert.equal(rows[0].resume_link, "network.pdf");
  const projectionCall = mock.calls.find(
    (call) => call.method === "rpc" && call.args[0] === "get_job_membership_projection_v1",
  );
  assert.deepEqual((projectionCall?.args[1] as any).p_archetypes, [
    "technology_delivery", "software_tpm", "network_infrastructure",
  ]);
  assert.equal((projectionCall?.args[1] as any).p_min_score, 0);
  assert.equal(await getAllActiveJobsCount(options), 777);
  const params = mock.calls.find((call) => call.method === "rpc")?.args[1] as any;
  assert.equal(params.p_offset, 500);
  assert.deepEqual(params.p_archetypes, ["technology_delivery", "software_tpm", "network_infrastructure"]);
});

test("malformed Boolean search fails before a database request", async () => {
  const mock = createQueryClient();
  __setSupabaseClientFactoryForTests(async () => mock.client);
  try {
    await assert.rejects(() => getNewJobs({ query: "cloud AND" }), /AND must be followed/);
    assert.equal(mock.calls.length, 0);
  } finally {
    __resetSupabaseClientFactoryForTests();
  }
});

test("Boolean search retains total count for an empty result page", async () => {
  const mock = createQueryClient({
    rpc: () => [{ job_id: null, total_count: 42, row_number: null }],
  });
  __setSupabaseClientFactoryForTests(async () => mock.client);
  try {
    const options = { query: '"program manager"', page: 99, pageSize: 25 } as const;
    assert.deepEqual(await getNewJobs(options), []);
    assert.equal(await getAllActiveJobsCount(options), 42);
    assert.equal(mock.calls.filter((call) => call.method === "rpc").length, 1);
  } finally {
    __resetSupabaseClientFactoryForTests();
  }
});

test("membership list/count retains total count for an empty deep page", async () => {
  const mock = createQueryClient({
    rpc: (name) => name === "get_job_ids_by_membership_v1"
      ? [{ job_id: null as unknown as string, total_count: 12, row_number: null as unknown as number }]
      : [],
  });
  __setSupabaseClientFactoryForTests(async () => mock.client);
  const options = { archetype: ["data_pm"], page: 99, pageSize: 25 };
  assert.deepEqual(await getNewJobs(options), []);
  assert.equal(await getAllActiveJobsCount(options), 12);
});

test("applied status supports every value and has an exact default", async () => {
  for (const status of ["applied", "interviewing", "offer", "rejected"] as const) {
    const calls = await rowCalls(getAppliedJobs, { applicationStatus: status });
    assert.ok(hasCall(calls, "eq", "status", status), status);
  }
  const calls = await rowCalls(getAppliedJobs);
  assert.ok(hasCall(calls, "in", "status", ["applied", "interviewing", "offer"]));
});

test("sort fields and orders are allowlisted per job list", async () => {
  const configs = [
    { rows: getAllJobs, allowed: SORT_FIELDS.filter((field) => field !== "application_date"), fallback: "posted_at" },
    { rows: getNewJobs, allowed: SORT_FIELDS.filter((field) => field !== "application_date"), fallback: "posted_at" },
    { rows: getTopScoredJobs, allowed: SORT_FIELDS.filter((field) => field !== "application_date"), fallback: "resume_score" },
    { rows: getAppliedJobs, allowed: [...SORT_FIELDS], fallback: "application_date" },
  ] as const;

  for (const config of configs) {
    for (const requested of [...SORT_FIELDS, "company"] as const) {
      for (const order of ["asc", "desc"] as const) {
        const calls = await rowCalls(config.rows, {
          sortBy: requested as SortField,
          sortOrder: order,
        });
        const selectedSort = config.allowed.includes(requested as never) ? requested : config.fallback;
        const expected = selectedSort === "posted_at" ? "effective_posted_at" : selectedSort;
        const options = selectedSort === "posted_at" || selectedSort === "salary_min"
          ? { ascending: order === "asc", nullsFirst: false }
          : { ascending: order === "asc" };
        assert.deepEqual(calls.filter((call) => call.method === "order"), [
          { method: "order", args: [expected, options] },
          { method: "order", args: ["job_id", { ascending: true }] },
        ]);
      }
    }
    const invalidOrder = await rowCalls(config.rows, { sortOrder: "sideways" as SortOrder });
    const fallbackOptions = config.fallback === "posted_at"
      ? { ascending: false, nullsFirst: false }
      : { ascending: false };
    assert.deepEqual(invalidOrder.find((call) => call.method === "order")?.args[1], fallbackOptions);
  }
});

test("posted-date sorting uses the latest source posting and keeps unknown dates last", async () => {
  const descending = await rowCalls(getNewJobs, {
    sortBy: "posted_at",
    sortOrder: "desc",
  });
  assert.deepEqual(descending.filter((call) => call.method === "order"), [
    {
      method: "order",
      args: ["effective_posted_at", { ascending: false, nullsFirst: false }],
    },
    { method: "order", args: ["job_id", { ascending: true }] },
  ]);

  const ascending = await rowCalls(getNewJobs, {
    sortBy: "posted_at",
    sortOrder: "asc",
  });
  assert.deepEqual(ascending.filter((call) => call.method === "order"), [
    {
      method: "order",
      args: ["effective_posted_at", { ascending: true, nullsFirst: false }],
    },
    { method: "order", args: ["job_id", { ascending: true }] },
  ]);
});

test("salary sorting excludes implausible parser outliers", async () => {
  const options = {
    sortBy: "salary_min",
    sortOrder: "desc",
  } as const;
  const calls = await rowCalls(getAllJobs, options);
  const countMock = createQueryClient({ count: 1 });
  __setSupabaseClientFactoryForTests(async () => countMock.client);
  await getAllJobsCount(options);

  assert.ok(hasCall(calls, "lte", "salary_min", 1_000_000));
  assert.ok(hasCall(countMock.calls, "lte", "salary_min", 1_000_000));
  assert.deepEqual(calls.filter((call) => call.method === "order"), [
    {
      method: "order",
      args: ["salary_min", { ascending: false, nullsFirst: false }],
    },
    { method: "order", args: ["job_id", { ascending: true }] },
  ]);
});

test("pagination supports 10, 25, 100 and caps legacy all", async () => {
  for (const pageSize of [10, 25, 100] as const) {
    const calls = await rowCalls(getNewJobs, { page: 2, pageSize });
    assert.deepEqual(calls.at(-1), { method: "range", args: [pageSize, pageSize * 2 - 1] });
  }

  const cappedBatch = Array.from({ length: 100 }, (_, index) => ({ job_id: `job-${index}` }));
  const mock = createQueryClient({ rangeData: [cappedBatch] });
  __setSupabaseClientFactoryForTests(async () => mock.client);
  const rows = await getNewJobs({ page: 99, pageSize: "all" });
  assert.equal(rows.length, 100);
  assert.deepEqual(mock.calls.filter((call) => call.method === "range"), [
    { method: "range", args: [9800, 9899] },
  ]);
});

test("job keyword insights select the complete confirmed row and use deterministic order", async () => {
  const mock = createQueryClient({ data: [{
    job_id: "job-1",
    keyword: "Roadmapping",
    category: "skill",
    analyzed_at: "2026-08-20T00:00:00Z",
    archetype: "software_tpm",
    provider: "linkedin",
  }] });
  __setSupabaseClientFactoryForTests(async () => mock.client);

  const rows = await getJobKeywordInsights("job-1");

  assert.equal(rows.length, 1);
  assert.deepEqual(mock.calls, [
    { method: "from", args: ["job_keyword_insights"] },
    { method: "select", args: ["job_id, keyword, category, analyzed_at, archetype, provider"] },
    { method: "eq", args: ["job_id", "job-1"] },
    { method: "order", args: ["category", { ascending: true }] },
    { method: "order", args: ["keyword", { ascending: true }] },
  ]);
});

test("job keyword insights filter canonical and compatible explicit archetype context", async () => {
  const mock = createQueryClient();
  __setSupabaseClientFactoryForTests(async () => mock.client);

  await getJobKeywordInsights("job-1", "software_tpm");

  assert.deepEqual(mock.calls, [
    { method: "from", args: ["job_keyword_insights"] },
    { method: "select", args: ["job_id, keyword, category, analyzed_at, archetype, provider"] },
    { method: "eq", args: ["job_id", "job-1"] },
    { method: "in", args: ["archetype", ["technology_delivery", "software_tpm"]] },
    { method: "order", args: ["category", { ascending: true }] },
    { method: "order", args: ["keyword", { ascending: true }] },
  ]);
});

test("suggestion helpers call the allowlisted RPC with bounded inputs", async () => {
  const mock = createQueryClient({
    rpc: () => [{ value: "Acme" }, { value: "Acme" }, { value: "Beta" }],
  });
  __setSupabaseClientFactoryForTests(async () => mock.client);

  assert.deepEqual(await getDistinctCompanies(`  ${"x".repeat(120)}  `, 100), ["Acme", "Beta"]);
  assert.deepEqual(await getDistinctJobTitles("TPM", 2), ["Acme", "Beta"]);
  assert.deepEqual(mock.calls.filter((call) => call.method === "rpc"), [
    {
      method: "rpc",
      args: ["search_job_filter_suggestions", {
        p_field: "company",
        p_query: "x".repeat(100),
        p_limit: 100,
      }],
    },
    {
      method: "rpc",
      args: ["search_job_filter_suggestions", {
        p_field: "jobTitle",
        p_query: "TPM",
        p_limit: 2,
      }],
    },
  ]);
  await assert.rejects(
    () => getJobFilterSuggestions("arbitrary" as "company"),
    /Unsupported suggestion field/,
  );
});
