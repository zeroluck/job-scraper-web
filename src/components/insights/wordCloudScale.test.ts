import assert from "node:assert/strict";
import test from "node:test";

import {
  computeWordFontSize,
  getWordAnimationDelay,
  WORD_CLOUD_MAX_FONT,
  WORD_CLOUD_MIN_FONT,
} from "./wordCloudScale.ts";

test("font scale maps min and max to bounds", () => {
  assert.equal(computeWordFontSize(42, 42, 1419), WORD_CLOUD_MIN_FONT);
  assert.equal(computeWordFontSize(1419, 42, 1419), WORD_CLOUD_MAX_FONT);
});

test("sqrt scale spreads long-tail counts", () => {
  const agile = computeWordFontSize(210, 42, 1419);
  const scrum = computeWordFontSize(85, 42, 1419);
  const kanban = computeWordFontSize(42, 42, 1419);
  // Linear would put 210 at ~19px; sqrt lifts it to ~26px.
  assert.ok(agile >= 25, `agile ${agile} should be >= 25`);
  assert.ok(scrum >= 19, `scrum ${scrum} should be >= 19`);
  assert.ok(agile > scrum && scrum > kanban);
});

test("font scale falls back for degenerate domains", () => {
  assert.equal(
    computeWordFontSize(10, 10, 10),
    Math.round((WORD_CLOUD_MIN_FONT + WORD_CLOUD_MAX_FONT) / 2),
  );
});

test("animation delay staggers then caps", () => {
  assert.equal(getWordAnimationDelay(0), 0);
  assert.equal(getWordAnimationDelay(5), 50);
  assert.equal(getWordAnimationDelay(30), 300);
  assert.equal(getWordAnimationDelay(249), 300);
});
