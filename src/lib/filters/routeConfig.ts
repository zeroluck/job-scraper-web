import {
  FILTER_PARAM_KEYS,
  type NextSearchParams,
} from "./searchParams.ts";
import type { FilterId, SortField } from "./types.ts";

export type SupportedRoute =
  | "/jobs/all"
  | "/jobs/new"
  | "/jobs/top-matches"
  | "/jobs/applied"
  | "/insights";

const JOB_LIST_FILTERS = [
  "provider",
  "interest",
  "score",
  "level",
  "archetype",
  "filterStatus",
  "hasSalary",
  "salaryRange",
  "repostCount",
  "datePosted",
  "location",
] as const satisfies readonly FilterId[];

export const ROUTE_FILTERS: Record<SupportedRoute, readonly FilterId[]> = {
  "/jobs/all": JOB_LIST_FILTERS,
  "/jobs/new": JOB_LIST_FILTERS,
  "/jobs/top-matches": JOB_LIST_FILTERS,
  "/jobs/applied": [
    "provider",
    "applicationStatus",
    "level",
    "archetype",
    "filterStatus",
    "hasSalary",
    "salaryRange",
    "repostCount",
    "datePosted",
    "location",
  ],
  "/insights": [
    "provider",
    "archetype",
    "level",
    "filterStatus",
    "company",
    "jobTitle",
    "location",
  ],
};

export const ROUTE_SORTS: Record<SupportedRoute, readonly SortField[]> = {
  "/jobs/all": ["posted_at", "resume_score", "salary_min", "repost_count"],
  "/jobs/new": ["posted_at", "resume_score", "salary_min", "repost_count"],
  "/jobs/top-matches": [
    "posted_at",
    "resume_score",
    "salary_min",
    "repost_count",
  ],
  "/jobs/applied": [
    "application_date",
    "resume_score",
    "posted_at",
    "salary_min",
    "repost_count",
  ],
  "/insights": [],
};

function isJobListRoute(route: SupportedRoute): boolean {
  return route !== "/insights";
}

function allowedKeys(route: SupportedRoute): Set<string> {
  const keys = new Set<string>();
  for (const filter of ROUTE_FILTERS[route]) {
    for (const key of FILTER_PARAM_KEYS[filter]) keys.add(key);
  }
  return keys;
}

function appendAll(target: URLSearchParams, key: string, values: string[]) {
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    target.append(key, trimmed);
  }
}

function sourceValues(
  source: URLSearchParams | NextSearchParams,
  key: string,
): string[] {
  if (source instanceof URLSearchParams) return source.getAll(key);
  const value = source[key];
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export function buildRouteSearchParams(
  source: URLSearchParams | NextSearchParams,
  destination: SupportedRoute,
): URLSearchParams {
  const next = new URLSearchParams();
  const keys = allowedKeys(destination);
  // Preserve filter params supported by destination, keeping repeated values.
  for (const key of keys) {
    const values = sourceValues(source, key);
    if (values.length) appendAll(next, key, values);
  }
  const destIsList = isJobListRoute(destination);
  // query/pageSize/sort only travel to job-list routes.
  // Insights UI never sets query, so insights->list leaks nothing in practice.
  if (destIsList) {
    const q = sourceValues(source, "query");
    if (q.length) {
      appendAll(next, "query", q.slice(0, 1));
    }
    const ps = sourceValues(source, "pageSize");
    if (ps.length && ["10", "25", "100", "all"].includes(ps[0]!)) {
      next.set("pageSize", ps[0]!);
    }
    const sortBy = sourceValues(source, "sortBy")[0];
    const sortOrder = sourceValues(source, "sortOrder")[0];
    if (
      sortBy &&
      (ROUTE_SORTS[destination] as readonly string[]).includes(sortBy)
    ) {
      next.set("sortBy", sortBy);
      if (sortOrder === "asc" || sortOrder === "desc") {
        next.set("sortOrder", sortOrder);
      }
    }
  } else {
    // destination is insights: preserve category only if valid.
    const category = sourceValues(source, "category")[0];
    if (
      category &&
      ["all", "skill", "technology", "certification", "attribute"].includes(
        category,
      )
    ) {
      next.set("category", category);
    }
  }
  return next;
}

export function buildRouteHref(
  destination: SupportedRoute,
  source: URLSearchParams | NextSearchParams,
): string {
  const params = buildRouteSearchParams(source, destination);
  const query = params.toString();
  return query ? `${destination}?${query}` : destination;
}

export function sanitizeSearchParamsForRoute(
  input: NextSearchParams,
  destination: SupportedRoute,
): NextSearchParams {
  const params = buildRouteSearchParams(input, destination);
  const out: NextSearchParams = {};
  params.forEach((value, key) => {
    const existing = out[key];
    if (existing === undefined) out[key] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else out[key] = [existing, value];
  });
  return out;
}
