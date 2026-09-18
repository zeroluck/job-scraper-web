import { CANONICAL_ARCHETYPES } from "../archetypes/registry.ts";

export const FILTER_IDS = [
  "provider",
  "interest",
  "score",
  "level",
  "archetype",
  "filterStatus",
  "hasSalary",
  "salaryRange",
  "repostCount",
  "seenCount",
  "datePosted",
  "applicationStatus",
  "company",
  "jobTitle",
  "location",
] as const;

export type FilterId = (typeof FILTER_IDS)[number];

export const PROVIDER_VALUES = ["linkedin", "careers_future"] as const;
export type Provider = (typeof PROVIDER_VALUES)[number];

export const INTEREST_VALUES = ["true", "false", "null"] as const;
export type Interest = (typeof INTEREST_VALUES)[number];

export const LEVEL_VALUES = [
  "Not Applicable",
  "Mid-Senior level",
  "Associate",
  "Entry level",
  "Director",
  "Executive",
  "Internship",
] as const;
export type JobLevel = (typeof LEVEL_VALUES)[number];

export const PROVINCE_VALUES = [
  "AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT",
] as const;
export type ProvinceCode = (typeof PROVINCE_VALUES)[number];

export const LOCATION_SCOPE_VALUES = ["country", "province", "local"] as const;
export type LocationScope = (typeof LOCATION_SCOPE_VALUES)[number];

export const METRO_VALUES = [
  "toronto", "montreal", "vancouver", "calgary", "edmonton", "ottawa_gatineau",
  "winnipeg", "quebec_city", "hamilton", "kitchener_waterloo", "london", "halifax",
  "victoria", "regina", "saskatoon",
] as const;
export type MetroCode = (typeof METRO_VALUES)[number];

export const ARCHETYPE_VALUES = [...CANONICAL_ARCHETYPES, "software_tpm"] as const;
export type BuiltInArchetype = (typeof ARCHETYPE_VALUES)[number];
export type Archetype<TKnown extends string = never> = BuiltInArchetype | TKnown;

export const FILTER_STATUS_VALUES = ["show_filtered", "entry_level"] as const;
export type FilterStatus = (typeof FILTER_STATUS_VALUES)[number];
export type ResolvedFilterStatus =
  | "exclude_filtered"
  | "include_all"
  | "only_entry_level_filtered";

export const INSIGHTS_CATEGORY_VALUES = [
  "all",
  "skill",
  "technology",
  "certification",
  "attribute",
  "location",
  "title",
] as const;
export type InsightsCategory = (typeof INSIGHTS_CATEGORY_VALUES)[number];

export const LOCATION_GRANULARITY_VALUES = ["city", "province"] as const;
export type LocationGranularity = (typeof LOCATION_GRANULARITY_VALUES)[number];

// City view only: fold suburbs/satellites into "Greater <Metro>" labels.
// Absent by default (unfolded). Province view ignores it server-side.
export const LOCATION_FOLD_VALUES = ["greater"] as const;
export type LocationFold = (typeof LOCATION_FOLD_VALUES)[number];

export const LOCATION_RATE_VALUES = ["raw", "stabilized"] as const;
export type LocationRate = (typeof LOCATION_RATE_VALUES)[number];

export const LOCATION_TOWN_VALUES = ["small"] as const;
export type LocationTown = (typeof LOCATION_TOWN_VALUES)[number];

export const APPLICATION_STATUS_VALUES = [
  "applied",
  "interviewing",
  "offer",
  "rejected",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUS_VALUES)[number];

export const DATE_POSTED_VALUES = ["24h", "7d", "30d"] as const;
export type DatePosted = (typeof DATE_POSTED_VALUES)[number];

export const SORT_FIELDS = [
  "posted_at",
  "resume_score",
  "application_date",
  "salary_min",
  "repost_count",
  "seen_count",
] as const;
export type SortField = (typeof SORT_FIELDS)[number];

export const SORT_ORDER_VALUES = ["asc", "desc"] as const;
export type SortOrder = (typeof SORT_ORDER_VALUES)[number];

export interface FilterState<TArchetype extends string = BuiltInArchetype> {
  provider?: Provider;
  interest?: Interest;
  minScore?: number;
  maxScore?: number;
  level?: JobLevel[];
  archetype?: TArchetype[];
  filterStatus?: FilterStatus;
  hasSalary?: true;
  salaryMin?: number;
  salaryMax?: number;
  minRepostCount?: number;
  minSeenCount?: number;
  datePosted?: DatePosted;
  postedAfter?: string;
  postedBefore?: string;
  applicationStatus?: ApplicationStatus;
  company?: string[];
  jobTitle?: string[];
  province?: ProvinceCode[];
  locationScope?: LocationScope[];
  excludeMetro?: MetroCode[];
  category?: InsightsCategory;
  keyword?: string;
  loc?: LocationGranularity;
  fold?: LocationFold;
  perCapita?: true;
  rate?: LocationRate;
  town?: LocationTown;
  query?: string;
  sortBy?: SortField;
  sortOrder?: SortOrder;
  page?: number;
  pageSize?: 10 | 25 | 100;
  selectedJobId?: string;
}

export interface SortOption {
  field: SortField;
  label: string;
}

export const SORT_OPTIONS: readonly SortOption[] = [
  { field: "posted_at", label: "Posted Date" },
  { field: "resume_score", label: "Resume Score" },
  { field: "application_date", label: "Application Date" },
  { field: "salary_min", label: "Salary" },
  { field: "repost_count", label: "Repost Count" },
];

export function resolveFilterStatus(
  status: FilterStatus | undefined
): ResolvedFilterStatus {
  if (status === "show_filtered") return "include_all";
  if (status === "entry_level") return "only_entry_level_filtered";
  return "exclude_filtered";
}
