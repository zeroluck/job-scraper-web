import assert from "node:assert/strict";
import test from "node:test";

import type { LocationInsight } from "../../types.ts";
import {
  bubbleRadius,
  contentionCoverage,
  mapMetric,
  mapWeight,
  mappedLocations,
  opportunityLocation,
  smallestBubble,
} from "./locationMapMetrics.ts";

function location(overrides: Partial<LocationInsight> = {}): LocationInsight {
  return {
    keyword: "Toronto",
    category: "location",
    bucket: "m:toronto",
    count: 100,
    population_2021: 1000000,
    per_100k: 10,
    stabilized_per_100k: 12,
    rate_reliability: 0.9,
    geo_match_quality: "exact",
    is_cma_component: false,
    latitude: 43.65,
    longitude: -79.38,
    contention_jobs: 50,
    observed_contention_jobs: 40,
    applicants_per_hour: 5,
    initial_applicants_median: 10,
    first_observation_lag_hours: 2,
    ...overrides,
  };
}

test("map metrics switch between counts, rates, and contention", () => {
  const value = location();
  assert.equal(mapMetric(value, "density", false, false), 100);
  assert.equal(mapMetric(value, "density", true, false), 10);
  assert.equal(mapMetric(value, "density", true, true), 12);
  assert.equal(mapMetric(value, "contention", false, false), 5);
});

test("map weights use stable logarithmic ceilings", () => {
  assert.equal(mapWeight(0, "density", false), 0);
  assert.equal(mapWeight(500, "density", false), 1);
  assert.equal(mapWeight(2500, "density", false), 1);
  assert.ok(mapWeight(1, "contention", false) < mapWeight(8, "contention", false));
  assert.equal(mapWeight(20, "contention", false), 1);
});

test("bubble radii make large markets prominent without exceeding the map cap", () => {
  const twoJobs = bubbleRadius(2, "density", false);
  const vancouver = bubbleRadius(993, "density", false);

  assert.equal(twoJobs, 3);
  assert.ok(vancouver > twoJobs * 6);
  assert.equal(bubbleRadius(10000, "density", false), 32);
  assert.equal(bubbleRadius(20, "contention", false), 32);
});

test("overlap selection prioritizes the smallest bubble", () => {
  const bubbles = [
    { label: "large", radius: 30 },
    { label: "small", radius: 4 },
    { label: "medium", radius: 12 },
  ];

  assert.equal(smallestBubble(bubbles, (bubble) => bubble.radius)?.label, "small");
  assert.equal(smallestBubble([], (bubble: { radius: number }) => bubble.radius), undefined);
});

test("mapping and opportunity selection enforce data quality", () => {
  const lowCompetition = location({ keyword: "Kingston", count: 20, stabilized_per_100k: 50, applicants_per_hour: 1, contention_jobs: 10, observed_contention_jobs: 8 });
  const busy = location({ keyword: "Toronto", count: 100, stabilized_per_100k: 60, applicants_per_hour: 10, contention_jobs: 80 });
  const lowCoverage = location({ keyword: "Unknown", stabilized_per_100k: 100, applicants_per_hour: 0.1, contention_jobs: 1 });
  const unmapped = location({ keyword: "Unmapped", latitude: null, longitude: null });

  assert.equal(contentionCoverage(lowCompetition), 0.5);
  assert.equal(mappedLocations([lowCompetition, unmapped]).length, 1);
  assert.equal(opportunityLocation([busy, lowCompetition, lowCoverage], true, true)?.keyword, "Kingston");
});

test("mapped locations omit city buckets that the label resolver treats as metros", () => {
  const malformedEdmonton = location({ keyword: "Edmonton", bucket: "c:edmonton|ab" });
  const edmontonMetro = location({ keyword: "Edmonton", bucket: "m:edmonton", count: 50 });
  const suffixedCity = location({ keyword: "Calgary (AB)", bucket: "c:calgary|ab" });

  assert.deepEqual(
    mappedLocations([malformedEdmonton, edmontonMetro, suffixedCity]).map((item) => item.bucket),
    ["m:edmonton", "c:calgary|ab"],
  );
});
