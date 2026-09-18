import type {
  Job,
  JobListItem,
  JobKeywordInsight as SharedJobKeywordInsight,
  KeywordInsight,
  Resume,
} from "../../types.ts";
import type { PostgrestError } from "@supabase/supabase-js";
import type {
  ApplicationStatus,
  FilterState,
  FilterStatus,
  SortField,
  SortOrder,
} from "../filters/types.ts";
import { parseBooleanSearch, type BooleanSearchNode } from "../jobs/booleanSearch.ts";
import { compatibleArchetypeValues } from "../archetypes/registry.ts";

if (!process.env.NODE_TEST_CONTEXT) {
  await import("server-only");
}

export type { KeywordInsight } from "../../types.ts";

export type KeywordInsightsResult = {
  keywords: KeywordInsight[];
  totalCount: number;
};

export const JOB_LIST_SELECT = [
  "job_id",
  "company",
  "job_title",
  "level",
  "location",
  "status",
  "is_active",
  "job_state",
  "application_date",
  "resume_score",
  "resume_score_stage",
  "is_interested",
  "customized_resume_id",
  "provider",
  "posted_at",
  "last_seen_posted_at",
  "effective_posted_at",
  "posted_relative_text",
  "applicant_count",
  "salary_text",
  "salary_min",
  "salary_max",
  "salary_currency",
  "scraped_at",
  "latest_job_id",
  "repost_count",
  "archetype",
  "is_filtered",
  "filter_reason",
].join(", ");

type SupabaseClientFactory = () => Promise<any>;
type LegacyProvider = string | undefined;

async function createDefaultSupabaseServerClient() {
  const { createSupabaseServerClient } = await import(
    "../../utils/supabase/server.ts"
  );

  return createSupabaseServerClient();
}

let supabaseClientFactory: SupabaseClientFactory = createDefaultSupabaseServerClient;
const createSupabaseServerClient = () => supabaseClientFactory();

export function __setSupabaseClientFactoryForTests(
  factory: SupabaseClientFactory,
) {
  supabaseClientFactory = factory;
}

export function __resetSupabaseClientFactoryForTests() {
  supabaseClientFactory = createDefaultSupabaseServerClient;
}

export function __setKeywordInsightsClientFactoryForTests(
  factory: SupabaseClientFactory,
) {
  __setSupabaseClientFactoryForTests(factory);
}

export function __resetKeywordInsightsClientFactoryForTests() {
  __resetSupabaseClientFactoryForTests();
}

// Helper function to handle Supabase response errors
async function handleResponse({
  data,
  error,
}: {
  data: any[] | null; // Keep 'any' for flexibility or refine if possible
  error: PostgrestError | null;
}): Promise<any> {
  // Keep 'any' or refine return type
  if (error) {
    const details = [error.code, error.message, error.details, error.hint]
      .filter(Boolean)
      .join(" | ");
    console.error("Supabase response error:", details);
    throw new Error(details || "Supabase query failed");
  }
  // Allow returning empty arrays or potentially null for single results handled elsewhere
  // Removed the !data check here as it might be too strict for all cases
  return data;
}

// --- Query Functions ---

export interface JobListQueryOptions<TArchetype extends string = string>
  extends Omit<FilterState<TArchetype>, "pageSize"> {
  pageSize?: number | "all";
}

const dateCutoffCache = new WeakMap<
  object,
  Partial<Record<"24h" | "7d" | "30d", string>>
>();
const booleanSearchCache = new WeakMap<object, Map<JobListKind, Promise<BooleanSearchPage>>>();

export const INSIGHTS_KEYWORD_LIMIT = 250;

export interface KeywordInsightsQueryOptions {
  provider?: string | readonly string[];
  providers?: readonly string[];
  archetype?: string | readonly string[];
  archetypes?: readonly string[];
  levels?: readonly string[];
  filterStatus?: FilterStatus | "all" | "filtered" | "unfiltered";
  companies?: readonly string[];
  jobTitles?: readonly string[];
  provinces?: readonly string[];
  locationScopes?: readonly string[];
  excludeMetros?: readonly string[];
  category?: string;
  minCount?: number;
  limit?: number;
}

export function normalizeInsightsLimit(limit?: number): number {
  if (!Number.isFinite(limit)) return INSIGHTS_KEYWORD_LIMIT;
  const parsed = Math.trunc(limit as number);
  if (!Number.isSafeInteger(parsed)) return INSIGHTS_KEYWORD_LIMIT;
  return Math.min(500, Math.max(1, parsed));
}

type LegacyInterest = boolean | null | undefined;
type InternalJobListOptions = Omit<JobListQueryOptions, "interest"> & {
  interest?: JobListQueryOptions["interest"] | LegacyInterest;
};
type JobListKind = "all" | "new" | "top" | "applied";

const APPLIED_STATUSES: readonly ApplicationStatus[] = [
  "applied",
  "interviewing",
  "offer",
];
const JOB_SORT_FIELDS: Readonly<Record<JobListKind, readonly SortField[]>> = {
  all: ["posted_at", "resume_score", "salary_min", "repost_count", "seen_count"],
  new: ["posted_at", "resume_score", "salary_min", "repost_count", "seen_count"],
  top: ["posted_at", "resume_score", "salary_min", "repost_count", "seen_count"],
  applied: [
    "posted_at",
    "resume_score",
    "application_date",
    "salary_min",
    "repost_count",
    "seen_count",
  ],
};
const DEFAULT_SORT: Readonly<Record<JobListKind, SortField>> = {
  all: "posted_at",
  new: "posted_at",
  top: "resume_score",
  applied: "application_date",
};

function nonEmpty(values: readonly string[] | undefined): string[] | null {
  const normalized = Array.from(
    new Set(values?.map((value) => value.trim()).filter(Boolean)),
  );
  return normalized.length ? normalized : null;
}

function arrayOption(
  plural: readonly string[] | undefined,
  singular: string | readonly string[] | undefined,
  fallback?: readonly string[],
): string[] | null {
  if (plural !== undefined) return nonEmpty(plural);
  if (Array.isArray(singular)) return nonEmpty(singular);
  if (typeof singular === "string") return nonEmpty([singular]);
  return fallback ? nonEmpty(fallback) : null;
}

function finiteNumber(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function safePositiveInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 ? value! : fallback;
}

function pageRange(options: InternalJobListOptions) {
  const page = safePositiveInteger(options.page, 1);
  const requestedPageSize = options.pageSize === "all" ? 100 : options.pageSize;
  const pageSize = Math.min(safePositiveInteger(requestedPageSize, 25), 100);
  const from = (page - 1) * pageSize;
  return { from, to: from + pageSize - 1 };
}

function datePostedCutoff(
  value: InternalJobListOptions["datePosted"],
  options: InternalJobListOptions,
): string | undefined {
  const age = value === "24h" ? 24 : value === "7d" ? 24 * 7 : value === "30d" ? 24 * 30 : 0;
  if (!age || !value) return undefined;
  const cached = dateCutoffCache.get(options)?.[value];
  if (cached) return cached;
  const cutoffDate = new Date(Date.now() - age * 60 * 60 * 1000);
  cutoffDate.setUTCSeconds(0, 0);
  const cutoff = cutoffDate.toISOString();
  const cutoffs = dateCutoffCache.get(options) ?? {};
  cutoffs[value] = cutoff;
  dateCutoffCache.set(options, cutoffs);
  return cutoff;
}

function applyInterestPredicate(
  query: any,
  interest: InternalJobListOptions["interest"],
  useNewPageDefault: boolean,
) {
  if (interest === true || interest === "true") return query.is("is_interested", true);
  if (interest === false || interest === "false") return query.is("is_interested", false);
  if (interest === null || interest === "null") return query.is("is_interested", null);
  return useNewPageDefault
    ? query.or("is_interested.is.null,is_interested.eq.true")
    : query;
}

function applyJobPredicates(
  initialQuery: any,
  kind: JobListKind,
  options: InternalJobListOptions,
) {
  let query = kind === "all"
    ? initialQuery
    : initialQuery.eq("is_active", true).eq("job_state", "new");

  if (kind === "applied") {
    query = options.applicationStatus
      ? query.eq("status", options.applicationStatus)
      : query.in("status", APPLIED_STATUSES);
  } else if (kind !== "all") {
    query = query.eq("status", "new");
  }

  const useScoreDefaults = options.filterStatus !== "entry_level";
  const minScore =
    finiteNumber(options.minScore) ??
    (useScoreDefaults
      ? kind === "top"
        ? 50
        : kind === "new"
          ? 0
          : undefined
      : undefined);
  const maxScore =
    finiteNumber(options.maxScore) ??
    (useScoreDefaults && (kind === "new" || kind === "top") ? 100 : undefined);
  if (minScore !== undefined) query = query.gte("resume_score", minScore);
  if (maxScore !== undefined) query = query.lte("resume_score", maxScore);
  if (options.provider) query = query.eq("provider", options.provider);
  if (options.level?.length) query = query.in("level", options.level);
  if (options.archetype?.length) {
    query = query.in("archetype", compatibleArchetypeValues(options.archetype));
  }
  if (options.province?.length && options.locationScope?.length) {
    const regionalScopes = options.locationScope.filter(
      (scope) => scope !== "country",
    );
    const clauses: string[] = [];
    if (options.locationScope.includes("country")) {
      clauses.push("location_scope.eq.country");
      clauses.push("listing_location_scopes.cs.{country}");
    }
    if (regionalScopes.length) {
      clauses.push(
        `and(location_province_code.in.(${options.province.join(",")}),location_scope.in.(${regionalScopes.join(",")}))`,
      );
      clauses.push(
        `and(listing_location_province_codes.ov.{${options.province.join(",")}},listing_location_scopes.ov.{${regionalScopes.join(",")}})`,
      );
    }
    query = query.or(clauses.join(","));
  } else if (options.province?.length) {
    query = query.or(
      `location_province_code.in.(${options.province.join(",")}),listing_location_province_codes.ov.{${options.province.join(",")}}`,
    );
  } else if (options.locationScope?.length) {
    query = query.or(
      `location_scope.in.(${options.locationScope.join(",")}),listing_location_scopes.ov.{${options.locationScope.join(",")}}`,
    );
  }
  if (options.excludeMetro?.length) {
    query = query.or(
      `location_metro.is.null,location_metro.not.in.(${options.excludeMetro.join(",")})`,
    );
  }

  query = applyInterestPredicate(
    query,
    options.interest,
    kind === "new" && options.filterStatus !== "entry_level",
  );

  if (options.filterStatus === "entry_level") {
    query = query.eq("is_entry_level_filtered", true);
  } else if (options.filterStatus !== "show_filtered" && kind !== "all") {
    query = query.or("is_filtered.is.null,is_filtered.eq.false");
  }

  if (options.hasSalary) query = query.not("salary_min", "is", null);
  const salaryMin = finiteNumber(options.salaryMin);
  const salaryMax = finiteNumber(options.salaryMax);
  if (options.hasSalary && salaryMin !== undefined) query = query.gte("salary_min", salaryMin);
  if (options.hasSalary && salaryMax !== undefined) query = query.lte("salary_min", salaryMax);
  if (options.sortBy === "salary_min") query = query.lte("salary_min", 1_000_000);

  const minRepostCount = finiteNumber(options.minRepostCount);
  const minSeenCount = finiteNumber(options.minSeenCount);
  if (minRepostCount !== undefined) query = query.gte("repost_count", minRepostCount);
  if (minSeenCount !== undefined) query = query.gte("seen_count", minSeenCount);

  const cutoff = datePostedCutoff(options.datePosted, options);
  if (cutoff) query = query.gte("effective_posted_at", cutoff);

  return query;
}

type BooleanSearchPage = {
  jobIds: string[];
  totalCount: number;
};

type JobMembershipProjection = {
  job_id: string;
  archetype: string;
  resume_score: number | null;
  resume_score_stage: string | null;
  is_filtered: boolean;
  filter_reason: string | null;
  customized_resume_id: string | null;
  resume_link: string | null;
};

function overlayMembership<TJob extends JobListItem>(
  job: TJob,
  membership: JobMembershipProjection,
): TJob & Pick<Job, "customized_resumes" | "resume_link"> {
  return {
    ...job,
    archetype: membership.archetype,
    resume_score: membership.resume_score,
    resume_score_stage: membership.resume_score_stage,
    is_filtered: membership.is_filtered,
    filter_reason: membership.filter_reason,
    customized_resume_id: membership.customized_resume_id,
    customized_resumes: membership.resume_link
      ? { resume_link: membership.resume_link }
      : null,
    resume_link: membership.resume_link,
  };
}

async function getMembershipProjections(
  supabase: any,
  jobIds: string[],
  kind: JobListKind,
  options: InternalJobListOptions,
  projectionFilterStatus: string | null = options.filterStatus ?? null,
): Promise<Map<string, JobMembershipProjection>> {
  const projections = new Map<string, JobMembershipProjection>();
  const archetypes = options.archetype?.length
    ? compatibleArchetypeValues(options.archetype)
    : [];
  if (!jobIds.length || !archetypes.length) return projections;
  const scores = scoreBounds(kind, options);
  for (let start = 0; start < jobIds.length; start += 500) {
    const response = await supabase.rpc("get_job_membership_projection_v1", {
      p_job_ids: jobIds.slice(start, start + 500),
      p_archetypes: archetypes,
      p_kind: kind,
      p_filter_status: projectionFilterStatus,
      p_min_score: scores.minScore ?? null,
      p_max_score: scores.maxScore ?? null,
    });
    const rows = ((await handleResponse(response)) ?? []) as JobMembershipProjection[];
    for (const row of rows) projections.set(row.job_id, row);
  }
  return projections;
}

function scoreBounds(kind: JobListKind, options: InternalJobListOptions) {
  const useDefaults = options.filterStatus !== "entry_level";
  return {
    minScore: finiteNumber(options.minScore) ?? (useDefaults ? (kind === "top" ? 50 : kind === "new" ? 0 : undefined) : undefined),
    maxScore: finiteNumber(options.maxScore) ?? (useDefaults && (kind === "new" || kind === "top") ? 100 : undefined),
  };
}

function jobIdRpcParams(kind: JobListKind, options: InternalJobListOptions) {
  const requestedSort = options.sortBy;
  const sortBy = requestedSort && JOB_SORT_FIELDS[kind].includes(requestedSort)
    ? requestedSort
    : DEFAULT_SORT[kind];
  const scores = scoreBounds(kind, options);
  return {
    p_kind: kind,
    p_provider: options.provider ?? null,
    p_levels: options.level?.length ? options.level : null,
    p_archetypes: options.archetype?.length ? compatibleArchetypeValues(options.archetype) : null,
    p_interest: options.interest === true ? "true" : options.interest === false ? "false" : options.interest,
    p_application_status: options.applicationStatus ?? null,
    p_filter_status: options.filterStatus ?? null,
    p_min_score: scores.minScore ?? null,
    p_max_score: scores.maxScore ?? null,
    p_provinces: options.province?.length ? options.province : null,
    p_location_scopes: options.locationScope?.length ? options.locationScope : null,
    p_exclude_metros: options.excludeMetro?.length ? options.excludeMetro : null,
    p_has_salary: options.hasSalary === true,
    p_salary_min: finiteNumber(options.salaryMin) ?? null,
    p_salary_max: finiteNumber(options.salaryMax) ?? null,
    p_min_repost_count: finiteNumber(options.minRepostCount) ?? null,
    p_min_seen_count: finiteNumber(options.minSeenCount) ?? null,
    p_posted_after: datePostedCutoff(options.datePosted, options) ?? null,
    p_sort_by: sortBy,
    p_sort_order: options.sortOrder === "asc" ? "asc" : "desc",
  };
}

async function getMembershipJobPage(
  supabase: any,
  kind: JobListKind,
  options: InternalJobListOptions,
  countOnly = false,
): Promise<BooleanSearchPage> {
  const range = countOnly ? null : pageRange(options);
  const jobIds: string[] = [];
  let totalCount = 0;
  let offset = countOnly ? 0 : (range?.from ?? 0);
  do {
    const limit = countOnly ? 1 : (range ? range.to - range.from + 1 : 500);
    const response = await supabase.rpc("get_job_ids_by_membership_v1", {
      ...jobIdRpcParams(kind, options), p_limit: limit, p_offset: offset,
    });
    const rows = ((await handleResponse(response)) ?? []) as Array<{ job_id: string | null; total_count: number | string }>;
    if (rows.length) totalCount = Number(rows[0].total_count);
    const batch = rows.flatMap((row) => typeof row.job_id === "string" ? [row.job_id] : []);
    jobIds.push(...batch);
    offset += batch.length;
    if (countOnly || range || batch.length < limit || offset >= totalCount) break;
  } while (true);
  return { jobIds, totalCount };
}

function booleanSearchAst(query: string | undefined): BooleanSearchNode | null {
  if (!query?.trim()) return null;
  const parsed = parseBooleanSearch(query);
  if (!parsed.ok) throw new Error(`${parsed.error} at character ${parsed.position + 1}`);
  return parsed.ast;
}

async function getBooleanSearchPage(
  supabase: any,
  kind: JobListKind,
  options: InternalJobListOptions,
  ast: BooleanSearchNode,
): Promise<BooleanSearchPage> {
  let byKind = booleanSearchCache.get(options);
  if (!byKind) {
    byKind = new Map();
    booleanSearchCache.set(options, byKind);
  }
  const cached = byKind.get(kind);
  if (cached) return cached;

  const promise = (async () => {
    const range = pageRange(options);
    const requestedLimit = range ? range.to - range.from + 1 : null;
    const requestedOffset = range?.from ?? 0;
    const baseParams = {
      p_search_ast: ast,
      ...jobIdRpcParams(kind, options),
    };
    const jobIds: string[] = [];
    let totalCount = 0;
    let offset = requestedOffset;
    do {
      const remaining = requestedLimit === null
        ? 1000
        : requestedLimit - jobIds.length;
      const limit = Math.min(remaining, 1000);
      if (limit <= 0) break;
      const response = await supabase.rpc("search_job_ids_v1", {
        ...baseParams,
        p_limit: limit,
        p_offset: offset,
      });
      if (response.error) throw new Error(response.error.message || "Boolean job search failed");
      const rows = (response.data ?? []) as Array<{ job_id: string | null; total_count: number | string }>;
      if (rows.length) totalCount = Number(rows[0].total_count);
      const batch = rows.flatMap((row) => typeof row.job_id === "string" ? [row.job_id] : []);
      jobIds.push(...batch);
      offset += batch.length;
      if ((requestedLimit !== null && jobIds.length >= requestedLimit) || batch.length < limit || offset >= totalCount) break;
    } while (true);
    return { jobIds, totalCount };
  })();
  byKind.set(kind, promise);
  return promise;
}

function applyJobSort(query: any, kind: JobListKind, options: InternalJobListOptions) {
  const requestedSort = options.sortBy;
  const sortBy = requestedSort && JOB_SORT_FIELDS[kind].includes(requestedSort)
    ? requestedSort
    : DEFAULT_SORT[kind];
  const sortOrder: SortOrder = options.sortOrder === "asc" ? "asc" : "desc";
  const orderColumn = sortBy === "posted_at" ? "effective_posted_at" : sortBy;
  const orderOptions: { ascending: boolean; nullsFirst?: boolean } = {
    ascending: sortOrder === "asc",
  };
  if (sortBy === "posted_at" || sortBy === "salary_min") {
    orderOptions.nullsFirst = false;
  }

  return query
    .order(orderColumn, orderOptions)
    .order("job_id", { ascending: true });
}

async function getJobRows(kind: JobListKind, options: InternalJobListOptions): Promise<JobListItem[]> {
  const supabase = await supabaseClientFactory();
  const ast = booleanSearchAst(options.query);
  if (ast || options.archetype?.length) {
    const search = ast
      ? await getBooleanSearchPage(supabase, kind, options, ast)
      : await getMembershipJobPage(supabase, kind, options);
    if (!search.jobIds.length) return [];
    const memberships = await getMembershipProjections(
      supabase, search.jobIds, kind, options,
    );
    const jobs: JobListItem[] = [];
    for (let start = 0; start < search.jobIds.length; start += 500) {
      const response = await supabase.from("jobs").select(JOB_LIST_SELECT)
        .in("job_id", search.jobIds.slice(start, start + 500));
      for (const job of ((await handleResponse(response)) ?? []) as JobListItem[]) {
        const membership = memberships.get(job.job_id);
        // A lane-scoped ID page and its projection use the same predicates.
        // Missing projection state is therefore a consistency error, not a
        // reason to leak jobs.* global technology-delivery state.
        if (options.archetype?.length && !membership) {
          throw new Error(`Missing qualifying membership projection for job ${job.job_id}`);
        }
        jobs.push(membership ? overlayMembership(job, membership) : job);
      }
    }
    const rank = new Map(search.jobIds.map((jobId, index) => [jobId, index]));
    return jobs.sort((left, right) => rank.get(left.job_id)! - rank.get(right.job_id)!);
  }
  const createQuery = () =>
    applyJobSort(
      applyJobPredicates(
        supabase.from("jobs").select(JOB_LIST_SELECT),
        kind,
        options,
      ),
      kind,
      options,
    );
  const range = pageRange(options);
  const response = await createQuery().range(range.from, range.to);
  return ((await handleResponse(response)) ?? []) as JobListItem[];
}

async function getJobCount(kind: JobListKind, options: InternalJobListOptions): Promise<number> {
  const supabase = await supabaseClientFactory();
  const ast = booleanSearchAst(options.query);
  if (ast || options.archetype?.length) {
    return (ast
      ? await getBooleanSearchPage(supabase, kind, options, ast)
      : await getMembershipJobPage(supabase, kind, options, true)).totalCount;
  }
  const query = applyJobPredicates(
    supabase.from("jobs").select("*", { count: "exact", head: true }),
    kind,
    options,
  );
  const { count, error } = await query;
  if (error) throw new Error(error.message || "Failed to get job count");
  return count ?? 0;
}

function legacyListOptions(
  optionsOrPage: JobListQueryOptions | number | undefined,
  pageSize?: number,
  provider?: string,
  minScore?: number,
  maxScore?: number,
  interest?: LegacyInterest,
  query?: string,
): InternalJobListOptions {
  if (typeof optionsOrPage === "object") return optionsOrPage;
  return { page: optionsOrPage, pageSize, provider: provider as any, minScore, maxScore, interest, query };
}

function legacyCountOptions(
  optionsOrProvider: JobListQueryOptions | string | undefined,
  minScore?: number,
  maxScore?: number,
  interest?: LegacyInterest,
  query?: string,
): InternalJobListOptions {
  if (typeof optionsOrProvider === "object") return optionsOrProvider;
  return { provider: optionsOrProvider as any, minScore, maxScore, interest, query };
}

export async function getNewJobs(options?: JobListQueryOptions): Promise<JobListItem[]>;
export async function getNewJobs(
  page?: number,
  pageSize?: number,
  provider?: LegacyProvider,
  minScore?: number,
  maxScore?: number,
  interest?: LegacyInterest,
  query?: string,
): Promise<JobListItem[]>;
export async function getNewJobs(
  optionsOrPage: JobListQueryOptions | number = {},
  pageSize?: number,
  provider?: string,
  minScore?: number,
  maxScore?: number,
  interest?: LegacyInterest,
  query?: string,
): Promise<JobListItem[]> {
  return getJobRows("new", legacyListOptions(optionsOrPage, pageSize, provider, minScore, maxScore, interest, query));
}

export async function getAllJobs(
  options: JobListQueryOptions = {},
): Promise<JobListItem[]> {
  return getJobRows("all", options);
}

export async function getAllJobsCount(
  options: JobListQueryOptions = {},
): Promise<number> {
  return getJobCount("all", options);
}

export async function getAllActiveJobsCount(options?: JobListQueryOptions): Promise<number>;
export async function getAllActiveJobsCount(
  provider?: LegacyProvider,
  minScore?: number,
  maxScore?: number,
  interest?: LegacyInterest,
  query?: string,
): Promise<number>;
export async function getAllActiveJobsCount(
  optionsOrProvider: JobListQueryOptions | string = {},
  minScore?: number,
  maxScore?: number,
  interest?: LegacyInterest,
  query?: string,
): Promise<number> {
  return getJobCount("new", legacyCountOptions(optionsOrProvider, minScore, maxScore, interest, query));
}

export async function getTopScoredJobs(options?: JobListQueryOptions): Promise<JobListItem[]>;
export async function getTopScoredJobs(
  page?: number,
  pageSize?: number,
  provider?: LegacyProvider,
  minScore?: number,
  maxScore?: number,
  interest?: LegacyInterest,
  query?: string,
): Promise<JobListItem[]>;
export async function getTopScoredJobs(
  optionsOrPage: JobListQueryOptions | number = {},
  pageSize?: number,
  provider?: string,
  minScore?: number,
  maxScore?: number,
  interest?: LegacyInterest,
  query?: string,
): Promise<JobListItem[]> {
  return getJobRows("top", legacyListOptions(optionsOrPage, pageSize, provider, minScore, maxScore, interest, query));
}

export async function getTopScoredJobsCount(options?: JobListQueryOptions): Promise<number>;
export async function getTopScoredJobsCount(
  provider?: LegacyProvider,
  minScore?: number,
  maxScore?: number,
  interest?: LegacyInterest,
  query?: string,
): Promise<number>;
export async function getTopScoredJobsCount(
  optionsOrProvider: JobListQueryOptions | string = {},
  minScore?: number,
  maxScore?: number,
  interest?: LegacyInterest,
  query?: string,
): Promise<number> {
  return getJobCount("top", legacyCountOptions(optionsOrProvider, minScore, maxScore, interest, query));
}

function legacyAppliedOptions(
  optionsOrPage: JobListQueryOptions | number | undefined,
  pageSize?: number,
  provider?: string,
  query?: string,
  applicationStatus?: string,
  sortBy?: string,
  sortOrder?: string,
): InternalJobListOptions {
  if (typeof optionsOrPage === "object") return optionsOrPage;
  return {
    page: optionsOrPage,
    pageSize,
    provider: provider as any,
    query,
    applicationStatus: applicationStatus as ApplicationStatus,
    sortBy: sortBy as SortField,
    sortOrder: sortOrder as SortOrder,
  };
}

export async function getAppliedJobs(options?: JobListQueryOptions): Promise<JobListItem[]>;
export async function getAppliedJobs(
  page?: number,
  pageSize?: number,
  provider?: LegacyProvider,
  query?: string,
  applicationStatus?: string,
  sortBy?: string,
  sortOrder?: string,
): Promise<JobListItem[]>;
export async function getAppliedJobs(
  optionsOrPage: JobListQueryOptions | number = {},
  pageSize?: number,
  provider?: string,
  query?: string,
  applicationStatus?: string,
  sortBy?: string,
  sortOrder?: string,
): Promise<JobListItem[]> {
  return getJobRows("applied", legacyAppliedOptions(
    optionsOrPage,
    pageSize,
    provider,
    query,
    applicationStatus,
    sortBy,
    sortOrder,
  ));
}

export async function getAppliedJobsCount(options?: JobListQueryOptions): Promise<number>;
export async function getAppliedJobsCount(
  provider?: LegacyProvider,
  query?: string,
  applicationStatus?: string,
): Promise<number>;
export async function getAppliedJobsCount(
  optionsOrProvider: JobListQueryOptions | string = {},
  query?: string,
  applicationStatus?: string,
): Promise<number> {
  const options = typeof optionsOrProvider === "object"
    ? optionsOrProvider
    : {
      provider: optionsOrProvider as any,
      query,
      applicationStatus: applicationStatus as ApplicationStatus,
    };
  return getJobCount("applied", options);
}

function keywordFilterStatus(
  value: KeywordInsightsQueryOptions["filterStatus"],
): string {
  if (value === "show_filtered" || value === "all") return "all";
  if (value === "entry_level") return "entry_level";
  if (value === "filtered") return "filtered";
  return "unfiltered";
}

export async function executeKeywordInsightsQuery(
  supabase: any,
  options: KeywordInsightsQueryOptions = {},
): Promise<KeywordInsightsResult> {
  const limit = normalizeInsightsLimit(options.limit);
  const response = await supabase.rpc("get_filtered_keyword_insights", {
    p_providers: arrayOption(options.providers, options.provider),
    p_archetypes: compatibleArchetypeValues(
      arrayOption(options.archetypes, options.archetype, ["technology_delivery"]) ?? [],
    ),
    p_levels: nonEmpty(options.levels),
    p_filter_status: keywordFilterStatus(options.filterStatus),
    p_companies: nonEmpty(options.companies),
    p_job_titles: nonEmpty(options.jobTitles),
    p_provinces: nonEmpty(options.provinces),
    p_location_scopes: nonEmpty(options.locationScopes),
    p_exclude_metros: nonEmpty(options.excludeMetros),
    p_category: options.category && options.category !== "all" ? options.category : null,
    p_min_count: Math.max(0, Math.trunc(finiteNumber(options.minCount) ?? 2)),
    p_limit: limit,
    p_offset: 0,
  });
  const rows = ((await handleResponse(response)) ?? []) as Array<KeywordInsight & {
    total_count?: number | string | null;
  }>;

  const parsedTotal = Number(rows[0]?.total_count);
  const totalCount = Number.isFinite(parsedTotal) ? parsedTotal : rows.length;
  const keywords = rows.map(({ total_count, ...row }) => {
    void total_count;
    return row;
  });
  return { keywords, totalCount };
}

export async function getKeywordInsights(
  options: KeywordInsightsQueryOptions = {},
): Promise<KeywordInsightsResult> {
  const supabase = await supabaseClientFactory();
  return executeKeywordInsightsQuery(supabase, options);
}

export interface KeywordJobsQueryOptions extends KeywordInsightsQueryOptions {
  keyword: string;
  page?: number;
  pageSize?: number;
}

export type LocationInsightsGranularity = "city" | "province";

export interface LocationInsightsQueryOptions {
  provider?: string | readonly string[];
  providers?: readonly string[];
  archetype?: string | readonly string[];
  archetypes?: readonly string[];
  levels?: readonly string[];
  filterStatus?: FilterStatus | "all" | "filtered" | "unfiltered";
  companies?: readonly string[];
  jobTitles?: readonly string[];
  provinces?: readonly string[];
  locationScopes?: readonly string[];
  excludeMetros?: readonly string[];
  granularity?: LocationInsightsGranularity;
}

export interface LocationInsightsResult {
  keywords: KeywordInsight[];
  totalCount: number;
  granularity: LocationInsightsGranularity;
}

export interface LocationJobsQueryOptions
  extends LocationInsightsQueryOptions {
  /** Display label as shown in the cloud; resolved server-side. */
  label: string;
  page?: number;
  pageSize?: number;
}

export interface KeywordJobsResult {
  jobs: JobListItem[];
  totalCount: number;
}

function keywordJobsPage(options: KeywordJobsQueryOptions): {
  keyword: string;
  limit: number;
  offset: number;
} {
  const keyword = options.keyword?.trim();
  if (!keyword || keyword.length > 200) {
    throw new Error("A keyword of 1-200 characters is required");
  }
  const page = safePositiveInteger(options.page, 1);
  const requestedPageSize = Math.trunc(finiteNumber(options.pageSize) ?? 25);
  const limit = Math.min(
    Math.max(Number.isSafeInteger(requestedPageSize) ? requestedPageSize : 25, 1),
    100,
  );
  return { keyword, limit, offset: (page - 1) * limit };
}

export async function executeKeywordJobsQuery(
  supabase: any,
  options: KeywordJobsQueryOptions,
): Promise<{ jobIds: string[]; totalCount: number }> {
  const { keyword, limit, offset } = keywordJobsPage(options);
  const response = await supabase.rpc("get_keyword_job_ids", {
    p_providers: arrayOption(options.providers, options.provider),
    p_archetypes: compatibleArchetypeValues(
      arrayOption(options.archetypes, options.archetype, ["technology_delivery"]) ?? [],
    ),
    p_levels: nonEmpty(options.levels),
    p_filter_status: keywordFilterStatus(options.filterStatus),
    p_companies: nonEmpty(options.companies),
    p_job_titles: nonEmpty(options.jobTitles),
    p_provinces: nonEmpty(options.provinces),
    p_location_scopes: nonEmpty(options.locationScopes),
    p_exclude_metros: nonEmpty(options.excludeMetros),
    p_category: options.category && options.category !== "all" ? options.category : null,
    p_keyword: keyword,
    p_limit: limit,
    p_offset: offset,
  });
  const rows = ((await handleResponse(response)) ?? []) as Array<{
    job_id: string | null;
    total_count?: number | string | null;
  }>;

  const parsedTotal = Number(rows[0]?.total_count);
  const totalCount = Number.isFinite(parsedTotal) ? parsedTotal : rows.length;
  const jobIds = rows.flatMap((row) =>
    typeof row.job_id === "string" ? [row.job_id] : [],
  );
  return { jobIds, totalCount };
}

export async function getKeywordJobs(
  options: KeywordJobsQueryOptions,
): Promise<KeywordJobsResult> {
  const supabase = await supabaseClientFactory();
  const { jobIds, totalCount } = await executeKeywordJobsQuery(supabase, options);
  if (!jobIds.length) return { jobs: [], totalCount };
  const archetypes = compatibleArchetypeValues(
    arrayOption(options.archetypes, options.archetype, ["technology_delivery"]) ?? [],
  );
  const memberships = await getMembershipProjections(
    supabase,
    jobIds,
    "all",
    { archetype: archetypes },
    keywordFilterStatus(options.filterStatus),
  );
  const jobs: JobListItem[] = [];
  for (let start = 0; start < jobIds.length; start += 500) {
    const response = await supabase
      .from("jobs")
      .select(JOB_LIST_SELECT)
      .in("job_id", jobIds.slice(start, start + 500));
    for (const job of ((await handleResponse(response)) ?? []) as JobListItem[]) {
      const membership = memberships.get(job.job_id);
      // The keyword RPC and its projection use the same lane predicates.
      // Missing projection state is therefore a consistency error, not a
      // reason to leak jobs.* global technology-delivery state.
      if (!membership) {
        throw new Error(`Missing qualifying membership projection for job ${job.job_id}`);
      }
      jobs.push(overlayMembership(job, membership));
    }
  }
  const rank = new Map(jobIds.map((jobId, index) => [jobId, index]));
  jobs.sort((left, right) => rank.get(left.job_id)! - rank.get(right.job_id)!);
  return { jobs, totalCount };
}

function locationGranularityOption(
  granularity: LocationInsightsQueryOptions["granularity"],
): LocationInsightsGranularity {
  return granularity === "province" ? "province" : "city";
}

export async function executeLocationInsightsQuery(
  supabase: any,
  options: LocationInsightsQueryOptions = {},
): Promise<LocationInsightsResult> {
  const granularity = locationGranularityOption(options.granularity);
  const response = await supabase.rpc("get_location_insights", {
    p_providers: arrayOption(options.providers, options.provider),
    p_archetypes: compatibleArchetypeValues(
      arrayOption(options.archetypes, options.archetype, ["technology_delivery"]) ?? [],
    ),
    p_levels: nonEmpty(options.levels),
    p_filter_status: keywordFilterStatus(options.filterStatus),
    p_companies: nonEmpty(options.companies),
    p_job_titles: nonEmpty(options.jobTitles),
    p_provinces: nonEmpty(options.provinces),
    p_location_scopes: nonEmpty(options.locationScopes),
    p_exclude_metros: nonEmpty(options.excludeMetros),
    p_granularity: granularity,
  });
  const rows = ((await handleResponse(response)) ?? []) as Array<{
    label?: string | null;
    count?: number | string | null;
    total_count?: number | string | null;
    last_updated?: string | null;
  }>;

  const parsedTotal = Number(rows[0]?.total_count);
  const totalCount = Number.isFinite(parsedTotal) ? parsedTotal : rows.length;
  // Labels arrive display-ready from the RPC (metros, cities, scope
  // buckets); the client passes them through untouched.
  const keywords: KeywordInsight[] = rows.flatMap((row) =>
    typeof row.label === "string" && row.label
      ? [{
        keyword: row.label,
        category: "location",
        count: Number(row.count) || 0,
        last_updated: row.last_updated ?? null,
      }]
      : [],
  );
  return { keywords, totalCount, granularity };
}

export async function getLocationInsights(
  options: LocationInsightsQueryOptions = {},
): Promise<LocationInsightsResult> {
  const supabase = await supabaseClientFactory();
  return executeLocationInsightsQuery(supabase, options);
}

function locationJobsPage(options: LocationJobsQueryOptions): {
  granularity: LocationInsightsGranularity;
  label: string;
  limit: number;
  offset: number;
} {
  const granularity = locationGranularityOption(options.granularity);
  const label = options.label?.trim();
  if (!label || label.length > 200) {
    throw new Error("A location label of 1-200 characters is required");
  }
  const page = safePositiveInteger(options.page, 1);
  const requestedPageSize = Math.trunc(finiteNumber(options.pageSize) ?? 25);
  const limit = Math.min(
    Math.max(Number.isSafeInteger(requestedPageSize) ? requestedPageSize : 25, 1),
    100,
  );
  return {
    granularity,
    label,
    limit,
    offset: (page - 1) * limit,
  };
}

export async function executeLocationJobsQuery(
  supabase: any,
  options: LocationJobsQueryOptions,
): Promise<{ jobIds: string[]; totalCount: number }> {
  const { granularity, label, limit, offset } = locationJobsPage(options);
  const response = await supabase.rpc("get_location_job_ids", {
    p_providers: arrayOption(options.providers, options.provider),
    p_archetypes: compatibleArchetypeValues(
      arrayOption(options.archetypes, options.archetype, ["technology_delivery"]) ?? [],
    ),
    p_levels: nonEmpty(options.levels),
    p_filter_status: keywordFilterStatus(options.filterStatus),
    p_companies: nonEmpty(options.companies),
    p_job_titles: nonEmpty(options.jobTitles),
    p_provinces: nonEmpty(options.provinces),
    p_location_scopes: nonEmpty(options.locationScopes),
    p_exclude_metros: nonEmpty(options.excludeMetros),
    p_granularity: granularity,
    p_label: label,
    p_limit: limit,
    p_offset: offset,
  });
  const rows = ((await handleResponse(response)) ?? []) as Array<{
    job_id: string | null;
    total_count?: number | string | null;
  }>;

  const parsedTotal = Number(rows[0]?.total_count);
  const totalCount = Number.isFinite(parsedTotal) ? parsedTotal : rows.length;
  const jobIds = rows.flatMap((row) =>
    typeof row.job_id === "string" ? [row.job_id] : [],
  );
  return { jobIds, totalCount };
}

export async function getLocationJobs(
  options: LocationJobsQueryOptions,
): Promise<KeywordJobsResult> {
  const supabase = await supabaseClientFactory();
  const { jobIds, totalCount } = await executeLocationJobsQuery(supabase, options);
  if (!jobIds.length) return { jobs: [], totalCount };
  const archetypes = compatibleArchetypeValues(
    arrayOption(options.archetypes, options.archetype, ["technology_delivery"]) ?? [],
  );
  const memberships = await getMembershipProjections(
    supabase,
    jobIds,
    "all",
    { archetype: archetypes },
    keywordFilterStatus(options.filterStatus),
  );
  const jobs: JobListItem[] = [];
  for (let start = 0; start < jobIds.length; start += 500) {
    const response = await supabase
      .from("jobs")
      .select(JOB_LIST_SELECT)
      .in("job_id", jobIds.slice(start, start + 500));
    for (const job of ((await handleResponse(response)) ?? []) as JobListItem[]) {
      const membership = memberships.get(job.job_id);
      // Same lane predicates as the location RPC; a missing projection is a
      // consistency error, not a reason to leak unscoped job state.
      if (!membership) {
        throw new Error(`Missing qualifying membership projection for job ${job.job_id}`);
      }
      jobs.push(overlayMembership(job, membership));
    }
  }
  const rank = new Map(jobIds.map((jobId, index) => [jobId, index]));
  jobs.sort((left, right) => rank.get(left.job_id)! - rank.get(right.job_id)!);
  return { jobs, totalCount };
}

export async function getJobKeywordInsights(
  jobId: string,
  archetype?: string | readonly string[],
): Promise<JobKeywordInsight[]> {
  const supabase = await supabaseClientFactory();
  let query = supabase
    .from("job_keyword_insights")
    .select("job_id, keyword, category, analyzed_at, archetype, provider")
    .eq("job_id", jobId);
  const requested = Array.isArray(archetype)
    ? nonEmpty(archetype)
    : typeof archetype === "string" ? nonEmpty([archetype]) : null;
  if (requested?.length) {
    query = query.in("archetype", compatibleArchetypeValues(requested));
  }
  const response = query
    .order("category", { ascending: true })
    .order("keyword", { ascending: true });
  return (((await handleResponse(response)) ?? []) as JobKeywordInsight[]);
}

export type JobKeywordInsight = SharedJobKeywordInsight & {
  job_id: string;
  analyzed_at: string | null;
};

export type JobFilterSuggestionField = "company" | "jobTitle";

export async function getJobFilterSuggestions(
  field: JobFilterSuggestionField,
  query = "",
  limit = 20,
): Promise<string[]> {
  if (field !== "company" && field !== "jobTitle") {
    throw new Error("Unsupported suggestion field");
  }
  const normalizedQuery = query.trim().slice(0, 100);
  const normalizedLimit = Math.min(
    Math.max(Math.trunc(finiteNumber(limit) ?? 5000), 1),
    5000,
  );
  const supabase = await supabaseClientFactory();
  const response = await supabase.rpc("search_job_filter_suggestions", {
    p_field: field,
    p_query: normalizedQuery,
    p_limit: normalizedLimit,
  });
  const rows = ((await handleResponse(response)) ?? []) as Array<{ value: string | null }>;
  return Array.from(new Set(rows.map((row) => row.value).filter((value): value is string => Boolean(value))))
    .slice(0, normalizedLimit);
}

export function getDistinctCompanies(query = "", limit = 5000): Promise<string[]> {
  return getJobFilterSuggestions("company", query, limit);
}

export function getDistinctJobTitles(query = "", limit = 5000): Promise<string[]> {
  return getJobFilterSuggestions("jobTitle", query, limit);
}

/**
 * Gets the count of applied jobs on a specific date.
 * @param dateThe date string in 'YYYY-MM-DD' format.
 * @returns A promise that resolves to the number of jobs applied on that date.
 */
export async function getAppliedJobsCountByDate(
  localDateString: string,
): Promise<number> {
  // localDateString is "YYYY-MM-DD", e.g., "2025-05-21" from server's local TZ
  const supabase = await createSupabaseServerClient();
  const appliedStatuses = ["applied", "interviewing", "offer"];

  // Create a Date object representing the start of the local day (00:00:00 local time)
  // For "2025-05-21", this will be 2025-05-21T00:00:00 in the server's local timezone.
  const startOfLocalDay = new Date(localDateString);

  // Convert the start of the local day to a UTC ISO string for the query
  const startOfDayUTCForQuery = startOfLocalDay.toISOString();

  // Create a Date object for the end of the local day
  // Start with the beginning of the local day again
  const endOfLocalDay = new Date(localDateString);
  // Advance it by one full day to get the start of the *next* local day
  endOfLocalDay.setDate(startOfLocalDay.getDate() + 1);

  // Convert the start of the next local day to a UTC ISO string for the query boundary
  const startOfNextDayUTCForQuery = endOfLocalDay.toISOString();

  // For debugging:
  // console.log(`Querying for applications on local date: ${localDateString}`);
  // console.log(`UTC Range: >= ${startOfDayUTCForQuery} and < ${startOfNextDayUTCForQuery}`);

  const { count, error } = await supabase
    .from("jobs")
    .select("*", { count: "exact", head: true })
    .eq("is_active", true)
    .in("status", appliedStatuses)
    .eq("job_state", "new") // Retained this filter if it's still relevant
    .gte("application_date", startOfDayUTCForQuery) // Greater than or equal to the start of the local day (in UTC)
    .lt("application_date", startOfNextDayUTCForQuery); // Less than the start of the next local day (in UTC)

  if (error) {
    console.error(
      `Supabase count error (applied jobs on local date ${localDateString}):`,
      error,
    );
    throw new Error(error.message);
  }

  return count ?? 0;
}

export async function getJobById(
  job_id: string,
  archetype?: string | readonly string[],
): Promise<Job | null> {
  // The jobs table now stores one canonical row per role; job_id remains the stable canonical row identifier.
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("jobs")
    .select("*, customized_resumes!jobs_customized_resume_id_fkey(resume_link)")
    .eq("job_id", job_id)
    .single(); // Use single() if you expect only one or zero results

  if (error && error.code !== "PGRST116") {
    // PGRST116: Row not found, which is okay for single()
    console.error("Supabase response error:", error);
    throw new Error(error.message);
  }
  // The 'data' object will now potentially include a 'customized_resumes' field:
  // e.g., { ..., customized_resume_id: 'xyz', customized_resumes: { resume_link: '...' } }
  // or { ..., customized_resume_id: null, customized_resumes: null }
  const job = data as Job | null;
  const requested = Array.isArray(archetype)
    ? nonEmpty(archetype)
    : typeof archetype === "string" ? nonEmpty([archetype]) : null;
  if (!job || !requested?.length) return job;
  const options: InternalJobListOptions = { archetype: requested };
  const memberships = await getMembershipProjections(
    supabase, [job_id], "all", options,
  );
  const membership = memberships.get(job_id);
  return membership ? overlayMembership(job, membership) : null;
}

// New function to update a job by its ID
export async function updateJobById(
  job_id: string,
  updates: Pick<
    Partial<Job>,
    "application_date" | "is_interested" | "notes" | "status"
  >,
): Promise<Job | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("jobs")
    .update(updates)
    .eq("job_id", job_id)
    .select() // Select the updated row
    .single(); // Expect a single row to be returned

  // The handleResponse function might need adjustment if it's not designed for single object returns
  // or if you want specific error handling for updates.
  // For now, we'll adapt the error handling similar to getJobById.
  if (error) {
    // PGRST116: Row not found, which means the job_id didn't match any record.
    if (error.code === "PGRST116") {
      console.warn(`Job with ID ${job_id} not found for update.`);
      return null;
    }
    console.error("Supabase update error:", error);
    throw new Error(error.message);
  }
  return data as Job | null; // Cast to Job or null
}

/**
 * Retrieves a specific customized resume by its ID.
 * @param resume_id The ID of the customized resume to retrieve.
 * @returns A promise that resolves to the Resume object or null if not found.
 */
export async function getCustomizedResumeById(
  resume_id: string,
): Promise<Resume | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("customized_resumes") // Target the 'customized_resumes' table
    .select("*")
    .eq("id", resume_id) // Assuming 'id' is the primary key column
    .single();

  if (error && error.code !== "PGRST116") {
    // PGRST116: Row not found, which is okay for single()
    console.error("Supabase error fetching customized resume:", error);
    throw new Error(error.message);
  }
  return data as Resume | null;
}

/**
 * Updates specified fields of a customized resume by its ID.
 * @param resume_id The ID of the customized resume to update.
 * @param updates An object containing the fields to update.
 * @returns A promise that resolves to the updated Resume object or null if not found.
 */
export async function updateCustomizedResumeById(
  resume_id: string,
  updates: Partial<Omit<Resume, "id" | "created_at" | "last_updated">>, // Exclude system-managed fields from direct update via this function
): Promise<Resume | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("customized_resumes") // Target the 'customized_resumes' table
    .update(updates)
    .eq("id", resume_id) // Assuming 'id' is the primary key column
    .select()
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      // Row not found
      console.warn(
        `Customized resume with ID ${resume_id} not found for update.`,
      );
      return null;
    }
    console.error("Supabase error updating customized resume:", error);
    throw new Error(error.message);
  }
  return data as Resume | null;
}

// New function to upload a personalized resume PDF to Supabase Storage
/**
 * Uploads a personalized resume PDF to Supabase Storage.
 * @param job_id The ID of the job for which the resume is personalized.
 * @param file The PDF file to upload.
 * @returns A promise that resolves to an object containing the public URL of the uploaded file.
 * @throws Will throw an error if the upload fails or the public URL cannot be retrieved.
 */
export async function uploadPersonalizedResume(
  fileName: string,
  file: File,
): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const filePath = fileName;

  console.log("Uploading file to path:", filePath);

  const { data: uploadData, error: uploadError } = await supabase.storage
    .from("personalized_resumes") // Updated bucket name
    .upload(filePath, file, {
      upsert: true, // Overwrite if file already exists
    });

  if (uploadError) {
    console.error("Supabase storage upload error:", uploadError);
    throw new Error(
      `Failed to upload personalized resume: ${uploadError.message}`,
    );
  }

  if (!uploadData || !uploadData.path) {
    console.error(
      "Supabase storage upload error: No path returned despite no error.",
    );
    throw new Error(
      "Failed to upload personalized resume: No path returned from storage.",
    );
  }

  return fileName;
}

/**
 * Retrieves the user profile from the 'base_resume' table.
 * Fetches the latest row as per the backend architecture.
 * @returns A promise that resolves to the Resume object or null if not found.
 */
export async function getUserProfileByEmail(): Promise<Resume | null> {
  const supabase = await createSupabaseServerClient();

  // Fetch the latest base resume from the 'base_resume' table
  // This follows the backend's architecture of keeping a single/latest base resume.
  const { data, error } = await supabase
    .from("base_resume")
    .select("resume_data")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      // PGRST116: Row not found, which is okay
      console.warn("No base resume found in the 'base_resume' table.");
      return null;
    }
    console.error("Supabase error fetching base resume:", error);
    throw new Error(error.message);
  }

  return (data as any)?.resume_data as Resume | null;
}

/**
 * Updates the base resume data in the 'base_resume' table.
 * Finds the latest row and updates its resume_data JSONB column.
 * @param resumeData The full Resume data object to save.
 * @returns The updated Resume data or null.
 */
export async function updateBaseResume(
  resumeData: Omit<Resume, "id" | "created_at" | "parsed_at" | "last_updated" | "resume_link">,
): Promise<Resume | null> {
  const supabase = await createSupabaseServerClient();

  // First, find the latest base resume row ID
  const { data: existing, error: fetchError } = await supabase
    .from("base_resume")
    .select("id")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (fetchError) {
    if (fetchError.code === "PGRST116") {
      console.warn("No base resume found to update.");
      return null;
    }
    console.error("Error fetching base resume for update:", fetchError);
    throw new Error(fetchError.message);
  }

  // Update the resume_data JSONB column
  const { data, error } = await supabase
    .from("base_resume")
    .update({ resume_data: resumeData })
    .eq("id", existing.id)
    .select("resume_data")
    .single();

  if (error) {
    console.error("Error updating base resume:", error);
    throw new Error(error.message);
  }

  return (data as any)?.resume_data as Resume | null;
}

// --- New Count Functions ---

/**
 * Gets the count of expired jobs.
 * @returns A promise that resolves to the number of expired jobs.
 */
export async function getExpiredJobsCount(): Promise<number> {
  const supabase = await createSupabaseServerClient();
  const { count, error } = await supabase
    .from("jobs")
    .select("*", { count: "exact", head: true })
    .eq("job_state", "expired");

  if (error) {
    console.error("Supabase count error (expired jobs):", error);
    throw new Error(error.message);
  }
  return count ?? 0;
}

/**
 * Gets the count of jobs pending to be scored (resume_score is null).
 * @returns A promise that resolves to the number of jobs pending scoring.
 */
export async function getPendingScoreJobsCount(): Promise<number> {
  const supabase = await createSupabaseServerClient();
  const { count, error } = await supabase
    .from("jobs")
    .select("*", { count: "exact", head: true })
    .is("resume_score", null)
    .eq("is_active", true) // Assuming we only count active jobs
    .eq("status", "new") // And new jobs that haven't been processed beyond initial scraping
    .eq("job_state", "new");

  if (error) {
    console.error("Supabase count error (pending score jobs):", error);
    throw new Error(error.message);
  }
  return count ?? 0;
}

/**
 * Gets the count of jobs that have already been scored (resume_score is not null).
 * @returns A promise that resolves to the number of scored jobs.
 */
export async function getScoredJobsCount(): Promise<number> {
  const supabase = await createSupabaseServerClient();
  const { count, error } = await supabase
    .from("jobs")
    .select("*", { count: "exact", head: true })
    .not("resume_score", "is", null)
    .eq("is_active", true)
    .eq("status", "new")
    .eq("job_state", "new");

  if (error) {
    console.error("Supabase count error (scored jobs):", error);
    throw new Error(error.message);
  }
  return count ?? 0;
}

/**
 * Gets the count of jobs which have a custom resume generated (customized_resume_id is not null).
 * @returns A promise that resolves to the number of jobs with a custom resume.
 */
export async function getCustomResumeJobsCount(): Promise<number> {
  const supabase = await createSupabaseServerClient();
  const { count, error } = await supabase
    .from("jobs")
    .select("*", { count: "exact", head: true })
    .not("customized_resume_id", "is", null)
    .eq("is_active", true); // Assuming active jobs

  if (error) {
    console.error("Supabase count error (custom resume jobs):", error);
    throw new Error(error.message);
  }
  return count ?? 0;
}

/**
 * Gets the count of jobs which have no custom resume (customized_resume_id is null).
 * @returns A promise that resolves to the number of jobs without a custom resume.
 */
export async function getNoCustomResumeJobsCount(): Promise<number> {
  const supabase = await createSupabaseServerClient();
  const { count, error } = await supabase
    .from("jobs")
    .select("*", { count: "exact", head: true })
    .is("customized_resume_id", null)
    .eq("is_active", true); // Assuming active jobs

  if (error) {
    console.error("Supabase count error (no custom resume jobs):", error);
    throw new Error(error.message);
  }
  return count ?? 0;
}

/**
 * Gets the count of scored jobs based on the original resume.
 * (resume_score is not null AND resume_score_stage is "initial")
 * @returns A promise that resolves to the number of jobs scored with the original resume.
 */
export async function getScoredWithOriginalResumeCount(): Promise<number> {
  const supabase = await createSupabaseServerClient();
  const { count, error } = await supabase
    .from("jobs")
    .select("*", { count: "exact", head: true })
    .not("resume_score", "is", null)
    .eq("resume_score_stage", "initial")
    .eq("is_active", true)
    .eq("status", "new")
    .eq("job_state", "new");

  if (error) {
    console.error("Supabase count error (scored with original resume):", error);
    throw new Error(error.message);
  }
  return count ?? 0;
}

/**
 * Gets the count of scored jobs based on a custom resume.
 * (resume_score is not null AND resume_score_stage is "custom")
 * @returns A promise that resolves to the number of jobs scored with a custom resume.
 */
export async function getScoredWithCustomResumeCount(): Promise<number> {
  const supabase = await createSupabaseServerClient();
  const { count, error } = await supabase
    .from("jobs")
    .select("*", { count: "exact", head: true })
    .not("resume_score", "is", null)
    .eq("resume_score_stage", "custom")
    .eq("is_active", true)
    .eq("status", "new")
    .eq("job_state", "new");

  if (error) {
    console.error("Supabase count error (scored with custom resume):", error);
    throw new Error(error.message);
  }
  return count ?? 0;
}

/**
 * Gets the count of jobs from LinkedIn.
 * Filters for active, new status, and new job_state jobs by default.
 * @returns A promise that resolves to the number of LinkedIn jobs.
 */
export async function getLinkedInJobsCount(): Promise<number> {
  const supabase = await createSupabaseServerClient();
  const { count, error } = await supabase
    .from("jobs")
    .select("*", { count: "exact", head: true })
    .eq("provider", "linkedin")
    .eq("is_active", true) // Consider if these filters are always needed
    .eq("job_state", "new");

  if (error) {
    console.error("Supabase count error (LinkedIn jobs):", error);
    throw new Error(error.message);
  }
  return count ?? 0;
}

/**
 * Gets the count of jobs from Careers Future.
 * Filters for active, new status, and new job_state jobs by default.
 * @returns A promise that resolves to the number of Careers Future jobs.
 */
export async function getCareersFutureJobsCount(): Promise<number> {
  const supabase = await createSupabaseServerClient();
  const { count, error } = await supabase
    .from("jobs")
    .select("*", { count: "exact", head: true })
    .eq("provider", "careers_future")
    .eq("is_active", true) // Consider if these filters are always needed
    .eq("job_state", "new");

  if (error) {
    console.error("Supabase count error (Careers Future jobs):", error);
    throw new Error(error.message);
  }
  return count ?? 0;
}
