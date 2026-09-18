import assert from "node:assert/strict";
import test from "node:test";

import { METRO_LABELS, PROVINCE_LABELS } from "./locations.ts";

test("label registries cover every known metro and province code", () => {
  for (const code of [
    "toronto", "montreal", "vancouver", "calgary", "edmonton",
    "ottawa_gatineau", "winnipeg", "quebec_city", "hamilton",
    "kitchener_waterloo", "london", "halifax", "victoria", "regina",
    "saskatoon",
  ]) {
    assert.ok(METRO_LABELS[code], `missing metro label for ${code}`);
  }
  for (const code of [
    "AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC",
    "SK", "YT",
  ]) {
    assert.ok(PROVINCE_LABELS[code], `missing province label for ${code}`);
  }
});
