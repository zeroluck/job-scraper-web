import assert from "node:assert/strict";
import test from "node:test";

import {
  metroLabel,
  provinceLabel,
  resolveLocationSelection,
  resolveLocationSelectionIn,
  UNSPECIFIED_LOCATION_LABEL,
} from "./locations.ts";

test("metro and province labels map codes, nulls become Unspecified", () => {
  assert.equal(metroLabel("toronto"), "Toronto");
  assert.equal(metroLabel("ottawa_gatineau"), "Ottawa-Gatineau");
  assert.equal(metroLabel(null), UNSPECIFIED_LOCATION_LABEL);
  assert.equal(metroLabel("unknown_code"), "unknown_code");
  assert.equal(provinceLabel("ON"), "Ontario");
  assert.equal(provinceLabel("QC"), "Quebec");
  assert.equal(provinceLabel(null), UNSPECIFIED_LOCATION_LABEL);
});

test("resolve matches labels to their namespace", () => {
  assert.deepEqual(resolveLocationSelection("Toronto"), {
    granularity: "city",
    code: "toronto",
    label: "Toronto",
  });
  assert.deepEqual(resolveLocationSelection("Ontario"), {
    granularity: "province",
    code: "ON",
    label: "Ontario",
  });
  assert.equal(resolveLocationSelection("Python"), undefined);
  assert.equal(resolveLocationSelection("  "), undefined);
  assert.equal(resolveLocationSelection(undefined), undefined);
});

test("namespace-aware resolve disambiguates Unspecified", () => {
  assert.deepEqual(resolveLocationSelectionIn("Unspecified", "city"), {
    granularity: "city",
    code: null,
    label: "Unspecified",
  });
  assert.deepEqual(resolveLocationSelectionIn("Unspecified", "province"), {
    granularity: "province",
    code: null,
    label: "Unspecified",
  });
  assert.deepEqual(resolveLocationSelectionIn("Toronto", "city"), {
    granularity: "city",
    code: "toronto",
    label: "Toronto",
  });
  // Cross-namespace labels stay segregated.
  assert.equal(resolveLocationSelectionIn("Toronto", "province"), undefined);
  assert.equal(resolveLocationSelectionIn("Ontario", "city"), undefined);
  assert.equal(resolveLocationSelectionIn("Python", "city"), undefined);
});
