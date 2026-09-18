import assert from "node:assert/strict";
import test from "node:test";

import {
  deserializeLocationInsightsKey,
  normalizeLocationInsightsKey,
} from "./locationInsightsCacheKey.ts";

test("location cache key separates granularities and round-trips", () => {
  const city = normalizeLocationInsightsKey({ granularity: "city" });
  const province = normalizeLocationInsightsKey({ granularity: "province" });
  assert.notEqual(city, province);
  assert.deepEqual(deserializeLocationInsightsKey(province), {
    providers: undefined,
    archetypes: undefined,
    levels: undefined,
    filterStatus: undefined,
    companies: undefined,
    jobTitles: undefined,
    provinces: undefined,
    locationScopes: undefined,
    excludeMetros: undefined,
    granularity: "province",
  });
  // Keyword category/minCount/limit must not leak into location keys.
  assert.ok(!city.includes("category"));
});

test("location cache key separates folded and unfolded city views", () => {
  const unfolded = normalizeLocationInsightsKey({ granularity: "city" });
  const folded = normalizeLocationInsightsKey({
    granularity: "city",
    foldSuburbs: true,
  });
  assert.notEqual(unfolded, folded);
  assert.deepEqual(deserializeLocationInsightsKey(folded), {
    providers: undefined,
    archetypes: undefined,
    levels: undefined,
    filterStatus: undefined,
    companies: undefined,
    jobTitles: undefined,
    provinces: undefined,
    locationScopes: undefined,
    excludeMetros: undefined,
    granularity: "city",
    foldSuburbs: true,
  });
  // Legacy keys without the fold flag still deserialize unfolded.
  assert.equal(
    deserializeLocationInsightsKey(unfolded).foldSuburbs,
    undefined,
  );
});
