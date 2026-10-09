import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./[job_id]/route.ts", import.meta.url), "utf8");

test("job details API preserves every requested archetype", () => {
  assert.match(source, /\.getAll\("archetype"\)/);
  assert.doesNotMatch(source, /\.get\("archetype"\)/);
  assert.match(source, /getJobById\(\s*job_id,\s*archetypes\.length \? archetypes : undefined/);
});
