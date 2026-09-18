import assert from "node:assert/strict";
import test from "node:test";

import {
  deserializeTitleInsightsKey,
  normalizeTitleInsightsKey,
} from "./titleInsightsCacheKey.ts";

test("title cache key round-trips filter state", () => {
  const key = normalizeTitleInsightsKey({
    archetypes: ["technology_delivery"],
    minCount: 2,
  });
  assert.deepEqual(deserializeTitleInsightsKey(key), {
    providers: undefined,
    archetypes: ["technology_delivery"],
    levels: undefined,
    filterStatus: undefined,
    companies: undefined,
    jobTitles: undefined,
    provinces: undefined,
    locationScopes: undefined,
    excludeMetros: undefined,
    minCount: 2,
    limit: 250,
  });
  // Location granularity must not leak into title keys.
  assert.ok(!key.includes("granularity"));
});
