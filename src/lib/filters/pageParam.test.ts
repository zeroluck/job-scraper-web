import assert from "node:assert/strict";
import test from "node:test";

import { parsePageParam } from "./pageParam.ts";

test("parses a valid page without retaining unsupported route parameters", () => {
  assert.equal(parsePageParam({ page: "12", selectedJobId: "job-1" }), 12);
  assert.equal(parsePageParam({ page: ["3", "4"] }), 3);
});

test("rejects malformed pages", () => {
  for (const page of [undefined, "", "0", "-1", "1.5", "unsafe"]) {
    assert.equal(parsePageParam({ page }), undefined);
  }
});
