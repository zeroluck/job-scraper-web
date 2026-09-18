import assert from "node:assert/strict";
import test from "node:test";

import { buildRouteSearchParams } from "./routeConfig.ts";

function params(entries: [string, string][]): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of entries) p.append(k, v);
  return p;
}

test("All -> Insights retains shared filters, drops list-only", () => {
  const source = params([
    ["provider", "linkedin"],
    ["archetype", "technology_delivery"],
    ["excludeMetro", "toronto"],
    ["minScore", "50"],
    ["interest", "true"],
    ["query", "python"],
    ["page", "3"],
    ["selectedJobId", "abc"],
  ]);
  const next = buildRouteSearchParams(source, "/insights");
  assert.equal(next.get("provider"), "linkedin");
  assert.equal(next.get("archetype"), "technology_delivery");
  assert.equal(next.get("excludeMetro"), "toronto");
  assert.equal(next.get("minScore"), null);
  assert.equal(next.get("interest"), null);
  assert.equal(next.get("query"), null);
  assert.equal(next.get("page"), null);
  assert.equal(next.get("selectedJobId"), null);
});

test("All -> Matches retains query, pageSize, valid sort", () => {
  const source = params([
    ["provider", "linkedin"],
    ["query", "python"],
    ["pageSize", "100"],
    ["sortBy", "resume_score"],
    ["sortOrder", "asc"],
    ["page", "2"],
  ]);
  const next = buildRouteSearchParams(source, "/jobs/top-matches");
  assert.equal(next.get("query"), "python");
  assert.equal(next.get("pageSize"), "100");
  assert.equal(next.get("sortBy"), "resume_score");
  assert.equal(next.get("sortOrder"), "asc");
  assert.equal(next.get("page"), null);
});

test("All -> Applied strips interest/score", () => {
  const source = params([
    ["interest", "false"],
    ["minScore", "90"],
    ["provider", "linkedin"],
  ]);
  const next = buildRouteSearchParams(source, "/jobs/applied");
  assert.equal(next.get("interest"), null);
  assert.equal(next.get("minScore"), null);
  assert.equal(next.get("provider"), "linkedin");
});

test("Insights -> All drops company/title/category", () => {
  const source = params([
    ["company", "Acme"],
    ["jobTitle", "PM"],
    ["category", "skill"],
    ["provider", "linkedin"],
  ]);
  const next = buildRouteSearchParams(source, "/jobs/all");
  assert.equal(next.get("company"), null);
  assert.equal(next.get("jobTitle"), null);
  assert.equal(next.get("category"), null);
  assert.equal(next.get("provider"), "linkedin");
});

test("repeated values survive and page/selectedJobId removed", () => {
  const source = params([
    ["archetype", "a"],
    ["archetype", "a"],
    ["archetype", "b"],
    ["page", "2"],
    ["selectedJobId", "x"],
  ]);
  const next = buildRouteSearchParams(source, "/jobs/new");
  assert.deepEqual(next.getAll("archetype"), ["a", "b"]);
  assert.equal(next.get("page"), null);
  assert.equal(next.get("selectedJobId"), null);
});

test("keyword stays within Insights and never leaks to job lists", () => {
  const source = params([
    ["keyword", " Python "],
    ["page", "4"],
    ["selectedJobId", "job-1"],
  ]);
  const insights = buildRouteSearchParams(source, "/insights");
  assert.equal(insights.get("keyword"), "Python");
  assert.equal(insights.get("page"), null);
  assert.equal(insights.get("selectedJobId"), null);
  assert.equal(buildRouteSearchParams(source, "/jobs/all").get("keyword"), null);
});

test("location category and granularity stay within Insights", () => {
  const source = params([
    ["category", "location"],
    ["loc", "province"],
    ["keyword", "Ontario"],
  ]);
  const insights = buildRouteSearchParams(source, "/insights");
  assert.equal(insights.get("category"), "location");
  assert.equal(insights.get("loc"), "province");
  assert.equal(insights.get("keyword"), "Ontario");
  const list = buildRouteSearchParams(source, "/jobs/all");
  assert.equal(list.get("category"), null);
  assert.equal(list.get("loc"), null);
  assert.equal(list.get("keyword"), null);
});

test("invalid loc values are dropped on insights", () => {
  const source = params([
    ["category", "location"],
    ["loc", "planet"],
  ]);
  const insights = buildRouteSearchParams(source, "/insights");
  assert.equal(insights.get("category"), "location");
  assert.equal(insights.get("loc"), null);
});
