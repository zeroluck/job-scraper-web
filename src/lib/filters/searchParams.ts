import {
  APPLICATION_STATUS_VALUES,
  ARCHETYPE_VALUES,
  DATE_POSTED_VALUES,
  FILTER_STATUS_VALUES,
  INSIGHTS_CATEGORY_VALUES,
  INTEREST_VALUES,
  LEVEL_VALUES,
  LOCATION_FOLD_VALUES,
  LOCATION_GRANULARITY_VALUES,
  LOCATION_RATE_VALUES,
  LOCATION_SCOPE_VALUES,
  LOCATION_TOWN_VALUES,
  METRO_VALUES,
  PROVINCE_VALUES,
  PROVIDER_VALUES,
  SORT_FIELDS,
  SORT_ORDER_VALUES,
  type Archetype,
  type FilterId,
  type FilterState,
} from "./types.ts";

export type NextSearchParams = Record<
  string,
  string | string[] | undefined
>;

export type SearchParamsInput = NextSearchParams | URLSearchParams;

export interface ParseFilterSearchParamsOptions {
  knownArchetypes?: readonly string[];
}

export const ARRAY_FILTER_PARAMS = [
  "level",
  "archetype",
  "company",
  "jobTitle",
  "province",
  "locationScope",
  "excludeMetro",
] as const;

export const FILTER_PARAM_KEYS: Readonly<Record<FilterId, readonly string[]>> = {
  provider: ["provider"],
  interest: ["interest"],
  score: ["minScore", "maxScore"],
  level: ["level"],
  archetype: ["archetype"],
  filterStatus: ["filterStatus"],
  hasSalary: ["hasSalary"],
  salaryRange: ["salaryMin", "salaryMax"],
  repostCount: ["minRepostCount"],
  seenCount: ["minSeenCount"],
  datePosted: ["datePosted", "postedAfter", "postedBefore"],
  applicationStatus: ["applicationStatus"],
  company: ["company"],
  jobTitle: ["jobTitle"],
  location: ["province", "locationScope", "excludeMetro"],
};

function values(input: SearchParamsInput, key: string): string[] {
  if (input instanceof URLSearchParams) return input.getAll(key);
  const value = input[key];
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function oneOf<const T extends readonly string[]>(
  input: SearchParamsInput,
  key: string,
  allowed: T
): T[number] | undefined {
  const value = values(input, key)[0];
  return value !== undefined && allowed.includes(value) ? value : undefined;
}

function text(input: SearchParamsInput, key: string): string | undefined {
  const value = values(input, key)[0]?.trim();
  return value && value.length <= 500 ? value : undefined;
}

function keyword(input: SearchParamsInput): string | undefined {
  const value = values(input, "keyword")[0]?.trim();
  return value && value.length <= 200 ? value : undefined;
}

function textArray(input: SearchParamsInput, key: string): string[] | undefined {
  const result = Array.from(
    new Set(
      values(input, key)
        .map((value) => value.trim())
        .filter((value) => value.length > 0 && value.length <= 200)
    )
  );
  return result.length ? result : undefined;
}

function enumArray<const T extends readonly string[]>(
  input: SearchParamsInput,
  key: string,
  allowed: T
): T[number][] | undefined {
  const result = Array.from(
    new Set(values(input, key).filter((value): value is T[number] => allowed.includes(value)))
  );
  return result.length ? result : undefined;
}

function integer(
  input: SearchParamsInput,
  key: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER
): number | undefined {
  const raw = values(input, key)[0];
  if (raw === undefined || !/^-?\d+$/.test(raw)) return undefined;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : undefined;
}

function pageSize(input: SearchParamsInput): 10 | 25 | 100 | undefined {
  const value = values(input, "pageSize")[0];
  // Keep old shared/bookmarked URLs working without allowing an unbounded read.
  if (value === "all") return 100;
  if (value === "10" || value === "25" || value === "100") {
    return Number(value) as 10 | 25 | 100;
  }
  return undefined;
}

function calendarDate(input: SearchParamsInput, key: string): string | undefined {
  const value = values(input, key)[0];
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value
    ? undefined
    : value;
}

export function withSelectedJobId(
  input: URLSearchParams,
  selectedJobId: string,
): URLSearchParams {
  const params = new URLSearchParams(input);
  params.set("selectedJobId", selectedJobId);
  return params;
}

export function parseFilterSearchParams(input: SearchParamsInput): FilterState;
export function parseFilterSearchParams<const TKnown extends string>(
  input: SearchParamsInput,
  options: { knownArchetypes: readonly TKnown[] }
): FilterState<Archetype<TKnown>>;
export function parseFilterSearchParams(
  input: SearchParamsInput,
  options: ParseFilterSearchParamsOptions = {}
): FilterState<string> {
  const knownArchetypes = Array.from(
    new Set([...(options.knownArchetypes ?? []), ...ARCHETYPE_VALUES])
  ).filter((value) => value.length > 0 && value.length <= 100);
  const hasSalary = oneOf(input, "hasSalary", ["true"] as const);

  const minScore = integer(input, "minScore", 0, 100);
  const maxScore = integer(input, "maxScore", 0, 100);
  const salaryMin = integer(input, "salaryMin", 0);
  const salaryMax = integer(input, "salaryMax", 0);
  const postedAfter = calendarDate(input, "postedAfter");
  const postedBefore = calendarDate(input, "postedBefore");
  const validPostedRange = !postedAfter || !postedBefore || postedAfter <= postedBefore;

  return {
    provider: oneOf(input, "provider", PROVIDER_VALUES),
    interest: oneOf(input, "interest", INTEREST_VALUES),
    minScore:
      minScore !== undefined && maxScore !== undefined && minScore > maxScore
        ? undefined
        : minScore,
    maxScore:
      minScore !== undefined && maxScore !== undefined && minScore > maxScore
        ? undefined
        : maxScore,
    level: enumArray(input, "level", LEVEL_VALUES),
    archetype: enumArray(input, "archetype", knownArchetypes),
    filterStatus: oneOf(input, "filterStatus", FILTER_STATUS_VALUES),
    hasSalary: hasSalary === "true" ? true : undefined,
    salaryMin:
      hasSalary === "true" &&
      !(salaryMin !== undefined && salaryMax !== undefined && salaryMin > salaryMax)
        ? salaryMin
        : undefined,
    salaryMax:
      hasSalary === "true" &&
      !(salaryMin !== undefined && salaryMax !== undefined && salaryMin > salaryMax)
        ? salaryMax
        : undefined,
    minRepostCount: integer(input, "minRepostCount", 0),
    minSeenCount: integer(input, "minSeenCount", 0),
    datePosted: oneOf(input, "datePosted", DATE_POSTED_VALUES),
    postedAfter: validPostedRange ? postedAfter : undefined,
    postedBefore: validPostedRange ? postedBefore : undefined,
    applicationStatus: oneOf(
      input,
      "applicationStatus",
      APPLICATION_STATUS_VALUES
    ),
    company: textArray(input, "company"),
    jobTitle: textArray(input, "jobTitle"),
    province: enumArray(input, "province", PROVINCE_VALUES),
    locationScope: enumArray(input, "locationScope", LOCATION_SCOPE_VALUES),
    excludeMetro: enumArray(input, "excludeMetro", METRO_VALUES),
    category: oneOf(input, "category", INSIGHTS_CATEGORY_VALUES),
    keyword: keyword(input),
    loc: oneOf(input, "loc", LOCATION_GRANULARITY_VALUES),
    fold: oneOf(input, "fold", LOCATION_FOLD_VALUES),
    perCapita: oneOf(input, "percap", ["true"] as const) === "true" ? true : undefined,
    rate: oneOf(input, "rate", LOCATION_RATE_VALUES),
    town: oneOf(input, "town", LOCATION_TOWN_VALUES),
    query: text(input, "query"),
    sortBy: oneOf(input, "sortBy", SORT_FIELDS),
    sortOrder: oneOf(input, "sortOrder", SORT_ORDER_VALUES),
    page: integer(input, "page", 1),
    pageSize: pageSize(input),
    selectedJobId: text(input, "selectedJobId"),
  };
}

export const parseFilters = parseFilterSearchParams;
export const parseSearchParams = parseFilterSearchParams;

export function resetResultPosition(params: URLSearchParams): URLSearchParams {
  params.delete("page");
  params.delete("selectedJobId");
  return params;
}

export function clearSupportedFilters(
  params: URLSearchParams,
  supportedFilters: readonly FilterId[]
): URLSearchParams {
  for (const filter of supportedFilters) {
    for (const key of FILTER_PARAM_KEYS[filter]) params.delete(key);
  }
  return resetResultPosition(params);
}

export function setRepeatedParam(
  params: URLSearchParams,
  key: (typeof ARRAY_FILTER_PARAMS)[number],
  selected: readonly string[]
): URLSearchParams {
  params.delete(key);
  for (const value of Array.from(new Set(selected))) {
    if (value) params.append(key, value);
  }
  return resetResultPosition(params);
}
