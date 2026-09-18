import { canonicalizeArchetype } from "../archetypes/registry.ts";
import {
  normalizeInsightsLimit,
  type TitleInsightsQueryOptions,
} from "./queries.ts";

function sortedUnique(values: readonly string[] | undefined): string[] {
  if (!values?.length) return [];
  return Array.from(
    new Set(values.map((v) => v.trim()).filter(Boolean)),
  ).sort();
}

function sortedArchetypes(values: readonly string[] | undefined): string[] {
  if (!values?.length) return [];
  return Array.from(
    new Set(
      values.map((v) => canonicalizeArchetype(v.trim())).filter(Boolean),
    ),
  ).sort();
}

export function normalizeTitleInsightsKey(
  options: TitleInsightsQueryOptions = {},
): string {
  const normalized = {
    providers: sortedUnique(
      options.providers ?? (options.provider ? [options.provider as string] : []),
    ),
    archetypes: sortedArchetypes(
      options.archetypes ??
        (Array.isArray(options.archetype)
          ? options.archetype
          : options.archetype
            ? [options.archetype as string]
            : []),
    ),
    levels: sortedUnique(options.levels ? [...options.levels] : []),
    filterStatus: options.filterStatus ?? null,
    companies: sortedUnique(options.companies ? [...options.companies] : []),
    jobTitles: sortedUnique(options.jobTitles ? [...options.jobTitles] : []),
    provinces: sortedUnique(options.provinces ? [...options.provinces] : []),
    locationScopes: sortedUnique(
      options.locationScopes ? [...options.locationScopes] : [],
    ),
    excludeMetros: sortedUnique(
      options.excludeMetros ? [...options.excludeMetros] : [],
    ),
    minCount: options.minCount ?? 2,
    limit: normalizeInsightsLimit(options.limit),
  };
  return JSON.stringify(normalized);
}

export function deserializeTitleInsightsKey(
  key: string,
): TitleInsightsQueryOptions {
  const parsed = JSON.parse(key) as {
    providers: string[];
    archetypes: string[];
    levels: string[];
    filterStatus: TitleInsightsQueryOptions["filterStatus"];
    companies: string[];
    jobTitles: string[];
    provinces: string[];
    locationScopes: string[];
    excludeMetros: string[];
    minCount: number;
    limit: number;
  };
  return {
    providers: parsed.providers.length ? parsed.providers : undefined,
    archetypes: parsed.archetypes.length ? parsed.archetypes : undefined,
    levels: parsed.levels.length ? parsed.levels : undefined,
    filterStatus: parsed.filterStatus ?? undefined,
    companies: parsed.companies.length ? parsed.companies : undefined,
    jobTitles: parsed.jobTitles.length ? parsed.jobTitles : undefined,
    provinces: parsed.provinces.length ? parsed.provinces : undefined,
    locationScopes: parsed.locationScopes.length
      ? parsed.locationScopes
      : undefined,
    excludeMetros: parsed.excludeMetros.length
      ? parsed.excludeMetros
      : undefined,
    minCount: parsed.minCount,
    limit: parsed.limit,
  };
}
