import type { LocationInsight } from "@/types";
import { METRO_LABELS } from "../../lib/insights/locations.ts";

export type LocationMapMode = "density" | "contention";

export function mapMetric(
  location: LocationInsight,
  mode: LocationMapMode,
  perCapita: boolean,
  stabilized: boolean,
): number | null {
  if (mode === "contention") return location.applicants_per_hour;
  if (!perCapita) return location.count;
  return stabilized ? location.stabilized_per_100k : location.per_100k;
}

export function mapWeight(value: number, mode: LocationMapMode, perCapita: boolean): number {
  const ceiling = mode === "contention" ? 250 : perCapita ? 100 : 500;
  return Math.min(1, Math.log1p(Math.max(value, 0)) / Math.log1p(ceiling));
}

export function contentionCoverage(location: LocationInsight): number {
  return location.count > 0 ? location.contention_jobs / location.count : 0;
}

export function mappedLocations(locations: LocationInsight[]): LocationInsight[] {
  const metroLabels = new Set(Object.values(METRO_LABELS));
  const byLabel = new Map<string, LocationInsight>();
  for (const location of locations) {
    if (location.latitude == null || location.longitude == null) continue;
    // Bare known-metro labels resolve to the metro bucket in the existing
    // drill-down RPC. Do not plot malformed city buckets that would open an
    // empty or different result set when clicked.
    if (location.bucket.startsWith("c:") && metroLabels.has(location.keyword)) continue;
    const existing = byLabel.get(location.keyword);
    if (!existing || location.bucket.startsWith("m:") || location.count > existing.count) {
      byLabel.set(location.keyword, location);
    }
  }
  return [...byLabel.values()];
}

export function opportunityLocation(locations: LocationInsight[]): LocationInsight | null {
  const eligible = locations.filter(
    (location) =>
      location.applicants_per_hour != null &&
      contentionCoverage(location) >= 0.25 &&
      location.count >= 2,
  );
  return eligible.reduce<LocationInsight | null>((best, location) => {
    const availability = location.stabilized_per_100k ?? location.per_100k ?? location.count;
    const score = availability / (1 + (location.applicants_per_hour ?? 0));
    if (!best) return location;
    const bestAvailability = best.stabilized_per_100k ?? best.per_100k ?? best.count;
    const bestScore = bestAvailability / (1 + (best.applicants_per_hour ?? 0));
    return score > bestScore ? location : best;
  }, null);
}
