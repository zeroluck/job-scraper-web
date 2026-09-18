import test from "node:test";
import assert from "node:assert/strict";

import {
  clearSupportedFilters,
  parseFilterSearchParams,
  resetResultPosition,
  setRepeatedParam,
  withSelectedJobId,
} from "./searchParams.ts";
import {
  APPLICATION_STATUS_VALUES,
  DATE_POSTED_VALUES,
  LEVEL_VALUES,
  LOCATION_SCOPE_VALUES,
  METRO_VALUES,
  PROVINCE_VALUES,
  PROVIDER_VALUES,
  SORT_FIELDS,
  SORT_ORDER_VALUES,
  resolveFilterStatus,
} from "./types.ts";

test("parses and validates a Next server search params record", () => {
  const parsed = parseFilterSearchParams({
    provider: "linkedin",
    interest: "null",
    level: ["Entry level", "Mid-Senior level", "Fake"],
    archetype: ["software_tpm", "fake"],
    applicationStatus: "offer",
    category: "technology",
    minScore: "0",
    maxScore: "100",
    hasSalary: "true",
    salaryMin: "120000",
    minRepostCount: "2",
    page: "3",
    pageSize: "100",
    province: ["AB", "BC", "XX"],
    locationScope: ["local", "country", "remote"],
    excludeMetro: ["calgary", "vancouver", "fake"],
  });

  assert.equal(parsed.provider, "linkedin");
  assert.equal(parsed.applicationStatus, "offer");
  assert.equal(parsed.category, "technology");
  assert.deepEqual(parsed.level, ["Entry level", "Mid-Senior level"]);
  assert.deepEqual(parsed.archetype, ["software_tpm"]);
  assert.equal(parsed.minScore, 0);
  assert.equal(parsed.hasSalary, true);
  assert.equal(parsed.page, 3);
  assert.equal(parsed.pageSize, 100);
  assert.deepEqual(parsed.province, ["AB", "BC"]);
  assert.deepEqual(parsed.locationScope, ["local", "country"]);
  assert.deepEqual(parsed.excludeMetro, ["calgary", "vancouver"]);
});

test("parses supported page sizes, caps legacy all, and rejects unsupported values", () => {
  for (const value of ["10", "25", "100"] as const) {
    assert.equal(
      parseFilterSearchParams(new URLSearchParams(`pageSize=${value}`)).pageSize,
      Number(value),
    );
  }
  assert.equal(parseFilterSearchParams(new URLSearchParams("pageSize=all")).pageSize, 100);
  for (const value of ["", "0", "1", "50", "101", "-25", "25.0", "ALL"]) {
    assert.equal(
      parseFilterSearchParams(new URLSearchParams(`pageSize=${value}`)).pageSize,
      undefined,
      value,
    );
  }
});

test("selected job URL changes preserve list params without changing pagination", () => {
  const original = new URLSearchParams("query=engineer&page=4&pageSize=25");
  const changed = withSelectedJobId(original, "job-1");
  assert.equal(changed.toString(), "query=engineer&page=4&pageSize=25&selectedJobId=job-1");
  assert.equal(original.has("selectedJobId"), false);
});

test("parses all valid geography values and rejects invalid geography", () => {
  const params = new URLSearchParams();
  for (const value of PROVINCE_VALUES) params.append("province", value);
  for (const value of LOCATION_SCOPE_VALUES) params.append("locationScope", value);
  for (const value of METRO_VALUES) params.append("excludeMetro", value);
  for (const [key, value] of [
    ["province", "XX"],
    ["province", "ab"],
    ["locationScope", "remote"],
    ["excludeMetro", "new_york"],
  ]) params.append(key, value);

  const parsed = parseFilterSearchParams(params);
  assert.deepEqual(parsed.province, [...PROVINCE_VALUES]);
  assert.deepEqual(parsed.locationScope, [...LOCATION_SCOPE_VALUES]);
  assert.deepEqual(parsed.excludeMetro, [...METRO_VALUES]);
});

test("URL parser allowlists every scalar enum", () => {
  const cases = [
    ["provider", PROVIDER_VALUES],
    ["datePosted", DATE_POSTED_VALUES],
    ["applicationStatus", APPLICATION_STATUS_VALUES],
    ["sortBy", SORT_FIELDS],
    ["sortOrder", SORT_ORDER_VALUES],
  ] as const;

  for (const [key, allowed] of cases) {
    for (const value of allowed) {
      assert.equal(
        (parseFilterSearchParams(new URLSearchParams(`${key}=${value}`)) as Record<string, unknown>)[key],
        value,
      );
    }
    assert.equal(
      (parseFilterSearchParams(new URLSearchParams(`${key}=invalid`)) as Record<string, unknown>)[key],
      undefined,
    );
  }
});

test("URL parser covers interest, filter status, ranges, counts, and safe text", () => {
  for (const interest of ["true", "false", "null"] as const) {
    assert.equal(parseFilterSearchParams(new URLSearchParams(`interest=${interest}`)).interest, interest);
  }
  for (const filterStatus of ["show_filtered", "entry_level"] as const) {
    assert.equal(
      parseFilterSearchParams(new URLSearchParams(`filterStatus=${filterStatus}`)).filterStatus,
      filterStatus,
    );
  }

  const parsed = parseFilterSearchParams(new URLSearchParams(
    "minScore=0&maxScore=100&hasSalary=true&salaryMin=90000&salaryMax=180000&minRepostCount=0&minSeenCount=4&page=2&query=%20TPM%20&selectedJobId=job-1",
  ));
  assert.deepEqual(
    {
      minScore: parsed.minScore,
      maxScore: parsed.maxScore,
      hasSalary: parsed.hasSalary,
      salaryMin: parsed.salaryMin,
      salaryMax: parsed.salaryMax,
      minRepostCount: parsed.minRepostCount,
      minSeenCount: parsed.minSeenCount,
      page: parsed.page,
      query: parsed.query,
      selectedJobId: parsed.selectedJobId,
    },
    {
      minScore: 0,
      maxScore: 100,
      hasSalary: true,
      salaryMin: 90000,
      salaryMax: 180000,
      minRepostCount: 0,
      minSeenCount: 4,
      page: 2,
      query: "TPM",
      selectedJobId: "job-1",
    },
  );
});

test("parses repeated URLSearchParams and retains selected text values", () => {
  const params = new URLSearchParams();
  for (const level of LEVEL_VALUES) params.append("level", level);
  params.append("company", "Acme");
  params.append("company", "Globex");
  params.append("company", "Acme");

  const parsed = parseFilterSearchParams(params);
  assert.deepEqual(parsed.level, [...LEVEL_VALUES]);
  assert.deepEqual(parsed.company, ["Acme", "Globex"]);
});

test("rejects malformed scalar values and unknown enums", () => {
  const parsed = parseFilterSearchParams({
    provider: "all",
    applicationStatus: "offered",
    category: "tools",
    filterStatus: "exclude_filtered",
    minScore: "5.5",
    maxScore: "101",
    minSeenCount: "-1",
    hasSalary: "false",
    sortBy: "company",
    sortOrder: "sideways",
    page: "0",
  });

  assert.deepEqual(parsed, {
    provider: undefined,
    interest: undefined,
    minScore: undefined,
    maxScore: undefined,
    level: undefined,
    archetype: undefined,
    filterStatus: undefined,
    hasSalary: undefined,
    salaryMin: undefined,
    salaryMax: undefined,
    minRepostCount: undefined,
    minSeenCount: undefined,
    datePosted: undefined,
    applicationStatus: undefined,
    company: undefined,
    jobTitle: undefined,
    province: undefined,
    locationScope: undefined,
    excludeMetro: undefined,
    category: undefined,
    keyword: undefined,
    loc: undefined,
    query: undefined,
    sortBy: undefined,
    sortOrder: undefined,
    page: undefined,
    pageSize: undefined,
    selectedJobId: undefined,
  });
});

test("rejects inverted ranges and ignores salary bounds unless salary is enabled", () => {
  const parsed = parseFilterSearchParams(
    new URLSearchParams(
      "minScore=90&maxScore=10&salaryMin=100&salaryMax=200",
    ),
  );

  assert.equal(parsed.minScore, undefined);
  assert.equal(parsed.maxScore, undefined);
  assert.equal(parsed.salaryMin, undefined);
  assert.equal(parsed.salaryMax, undefined);

  const invertedSalary = parseFilterSearchParams(
    new URLSearchParams("hasSalary=true&salaryMin=200&salaryMax=100"),
  );
  assert.equal(invertedSalary.salaryMin, undefined);
  assert.equal(invertedSalary.salaryMax, undefined);
});

test("allows explicit known archetype extensions without accepting arbitrary values", () => {
  const params = new URLSearchParams(
    "archetype=data_pm&archetype=fake&archetype=software_tpm"
  );
  assert.deepEqual(
    parseFilterSearchParams(params, { knownArchetypes: ["data_pm"] }).archetype,
    ["data_pm", "software_tpm"]
  );
});

test("resolves filterStatus semantics", () => {
  assert.equal(resolveFilterStatus(undefined), "exclude_filtered");
  assert.equal(resolveFilterStatus("show_filtered"), "include_all");
  assert.equal(
    resolveFilterStatus("entry_level"),
    "only_entry_level_filtered"
  );
});

test("URL helpers preserve query and sorts while resetting result position", () => {
  const params = new URLSearchParams(
    "query=engineer&sortBy=posted_at&sortOrder=desc&page=4&selectedJobId=abc&provider=linkedin&interest=true"
  );
  clearSupportedFilters(params, ["provider"]);

  assert.equal(params.get("query"), "engineer");
  assert.equal(params.get("sortBy"), "posted_at");
  assert.equal(params.get("sortOrder"), "desc");
  assert.equal(params.get("interest"), "true");
  assert.equal(params.has("provider"), false);
  assert.equal(params.has("page"), false);
  assert.equal(params.has("selectedJobId"), false);

  setRepeatedParam(params, "level", ["Associate", "Associate", "Director"]);
  assert.deepEqual(params.getAll("level"), ["Associate", "Director"]);
  params.set("page", "2");
  resetResultPosition(params);
  assert.equal(params.has("page"), false);
});

test("parses location category and granularity, rejects invalid loc", () => {
  assert.equal(
    parseFilterSearchParams({ category: "location", loc: "province" }).category,
    "location",
  );
  assert.equal(
    parseFilterSearchParams({ category: "location", loc: "province" }).loc,
    "province",
  );
  assert.equal(
    parseFilterSearchParams({ category: "location", loc: "city" }).loc,
    "city",
  );
  assert.equal(
    parseFilterSearchParams({ category: "location", loc: "planet" }).loc,
    undefined,
  );
  assert.equal(
    parseFilterSearchParams({ category: "location" }).loc,
    undefined,
  );
});
