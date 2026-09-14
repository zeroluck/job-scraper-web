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

test("sqrt scale spreads long-tail counts with small smalls", () => {
  const agile = computeWordFontSize(210, 42, 1419);
  const scrum = computeWordFontSize(85, 42, 1419);
  const kanban = computeWordFontSize(42, 42, 1419);
  // Wide 10-64 range: tail stays small but distinguishable.
  assert.equal(kanban, WORD_CLOUD_MIN_FONT);
  assert.ok(scrum >= 13, `scrum ${scrum} should be >= 13`);
  assert.ok(agile >= 22, `agile ${agile} should be >= 22`);
  assert.ok(agile > scrum && scrum > kanban);
  assert.ok(agile - kanban >= 10, "tail spread should be >= 10px");
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
  assert.equal(getWordAnimationDelay(60), 600);
  assert.equal(getWordAnimationDelay(249), 600);
});
