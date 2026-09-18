import type { LocationGranularity } from "../filters/types.ts";

export const METRO_LABELS: Record<string, string> = {
  toronto: "Toronto",
  montreal: "Montreal",
  vancouver: "Vancouver",
  calgary: "Calgary",
  edmonton: "Edmonton",
  "ottawa_gatineau": "Ottawa-Gatineau",
  winnipeg: "Winnipeg",
  "quebec_city": "Quebec City",
  hamilton: "Hamilton",
  "kitchener_waterloo": "Kitchener-Waterloo",
  london: "London",
  halifax: "Halifax",
  victoria: "Victoria",
  regina: "Regina",
  saskatoon: "Saskatoon",
};

export const PROVINCE_LABELS: Record<string, string> = {
  AB: "Alberta",
  BC: "British Columbia",
  MB: "Manitoba",
  NB: "New Brunswick",
  NL: "Newfoundland and Labrador",
  NS: "Nova Scotia",
  NT: "Northwest Territories",
  NU: "Nunavut",
  ON: "Ontario",
  PE: "Prince Edward Island",
  QC: "Quebec",
  SK: "Saskatchewan",
  YT: "Yukon",
};

/** Display label for jobs with no metro/province recorded. */
export const UNSPECIFIED_LOCATION_LABEL = "Unspecified";

export function metroLabel(code: string | null): string {
  if (!code) return UNSPECIFIED_LOCATION_LABEL;
  return METRO_LABELS[code] ?? code;
}

export function provinceLabel(code: string | null): string {
  if (!code) return UNSPECIFIED_LOCATION_LABEL;
  return PROVINCE_LABELS[code] ?? code;
}

export interface LocationSelection {
  granularity: LocationGranularity;
  /** Raw metro/province code, or null for the Unspecified bucket. */
  code: string | null;
  label: string;
}

/**
 * Resolve a drill-down keyword label back to its location bucket.
 * Metro labels win on conflict; "Unspecified" stays ambiguous and must be
 * resolved with an explicit granularity via resolveLocationSelectionIn.
 */
export function resolveLocationSelection(
  label: string | undefined,
): LocationSelection | undefined {
  if (!label) return undefined;
  const trimmed = label.trim();
  if (!trimmed) return undefined;
  for (const [code, name] of Object.entries(METRO_LABELS)) {
    if (name === trimmed) return { granularity: "city", code, label: name };
  }
  for (const [code, name] of Object.entries(PROVINCE_LABELS)) {
    if (name === trimmed) return { granularity: "province", code, label: name };
  }
  return undefined;
}

/** Namespace-aware resolve; the only way to disambiguate "Unspecified". */
export function resolveLocationSelectionIn(
  label: string | undefined,
  granularity: LocationGranularity,
): LocationSelection | undefined {
  if (!label) return undefined;
  const trimmed = label.trim();
  if (!trimmed) return undefined;
  if (trimmed === UNSPECIFIED_LOCATION_LABEL) {
    return { granularity, code: null, label: trimmed };
  }
  const table = granularity === "city" ? METRO_LABELS : PROVINCE_LABELS;
  for (const [code, name] of Object.entries(table)) {
    if (name === trimmed) return { granularity, code, label: name };
  }
  return undefined;
}
