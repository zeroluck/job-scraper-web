import assert from "node:assert/strict";
import test from "node:test";

import { normalizeKeywordInsightsKey } from "./keywordInsightsCacheKey.ts";

test("archetype and metro order produce the same key", () => {
  const a = normalizeKeywordInsightsKey({
    archetypes: ["b", "a"],
    excludeMetros: ["toronto", "montreal"],
  });
  const b = normalizeKeywordInsightsKey({
    archetypes: ["a", "b"],
    excludeMetros: ["montreal", "toronto"],
  });
  assert.equal(a, b);
});

test("duplicates produce the same key", () => {
  const a = normalizeKeywordInsightsKey({ archetypes: ["a", "a", "b"] });
  const b = normalizeKeywordInsightsKey({ archetypes: ["b", "a"] });
  assert.equal(a, b);
});

test("different category produces a different key", () => {
  const a = normalizeKeywordInsightsKey({ category: "skill" });
  const b = normalizeKeywordInsightsKey({ category: "technology" });
  assert.notEqual(a, b);
});
