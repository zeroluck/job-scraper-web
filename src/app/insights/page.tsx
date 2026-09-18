import { Suspense } from "react";

import InsightsClient from "@/components/insights/InsightsClient";
import FilterButton from "@/components/jobs/FilterButton";
import FilterChips from "@/components/jobs/FilterChips";
import { parsePageParam } from "@/lib/filters/pageParam";
import { parseFilterSearchParams } from "@/lib/filters/searchParams";
import { ROUTE_FILTERS, sanitizeSearchParamsForRoute } from "@/lib/filters/routeConfig";
import { getCachedKeywordInsights } from "@/lib/supabase/cachedKeywordInsights";
import { getCachedLocationInsights } from "@/lib/supabase/cachedLocationInsights";
import { getCachedTitleInsights } from "@/lib/supabase/cachedTitleInsights";
import {
  getKeywordJobs,
  getLocationJobs,
  getTitleJobs,
  INSIGHTS_KEYWORD_LIMIT,
  type LocationInsightsGranularity,
} from "@/lib/supabase/queries";
import { CANONICAL_ARCHETYPES, archetypeLabel } from "@/lib/archetypes/registry";

const INSIGHTS_FILTERS = ROUTE_FILTERS["/insights"];
const KNOWN_ARCHETYPES = CANONICAL_ARCHETYPES;

function InsightsHeader() {
  return (
    <>
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Job Market Insights</h1>
          <p className="mt-1 text-gray-500">
            Most commonly requested skills, technologies, certifications and attributes.
          </p>
        </div>
        <Suspense
          fallback={
            <button
              type="button"
              disabled
              className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-400"
            >
              Filters
            </button>
          }
        >
          <FilterButton
            supportedFilters={INSIGHTS_FILTERS}
            knownArchetypes={KNOWN_ARCHETYPES}
          />
        </Suspense>
      </div>
      <Suspense fallback={null}>
        <FilterChips
          supportedFilters={INSIGHTS_FILTERS}
          knownArchetypes={KNOWN_ARCHETYPES}
        />
      </Suspense>
    </>
  );
}

function filterKey(params: Record<string, string | string[] | undefined>): string {
  const sorted: Record<string, string | string[]> = {};
  for (const key of Object.keys(params).sort()) {
    const value = params[key];
    if (value !== undefined) sorted[key] = value;
  }
  return JSON.stringify(sorted);
}

function InsightsSkeleton() {
  return (
    <div
      aria-label="Loading insights"
      className="flex min-h-64 items-center justify-center rounded-xl border border-gray-200 bg-gray-50 text-gray-400"
    >
      Loading insights…
    </div>
  );
}

async function InsightsResults({
  filtersKey,
  scopeLabel,
  activeCategory,
  queryOptions,
  selectedKeyword,
  keywordPage,
  keywordPageSize,
  locationGranularity,
  foldSuburbs,
  perCapita,
}: {
  filtersKey: string;
  scopeLabel: string;
  activeCategory: "all" | "skill" | "technology" | "certification" | "attribute" | "location" | "title";
  queryOptions: Parameters<typeof getCachedKeywordInsights>[0];
  selectedKeyword?: string;
  keywordPage: number;
  keywordPageSize: 10 | 25 | 100;
  locationGranularity?: LocationInsightsGranularity;
  foldSuburbs?: boolean;
  perCapita?: boolean;
}) {
  void filtersKey;
  if (locationGranularity) {
    return (
      <LocationResults
        scopeLabel={scopeLabel}
        queryOptions={queryOptions}
        granularity={locationGranularity}
        foldSuburbs={foldSuburbs === true}
        perCapita={perCapita === true}
        selectedKeyword={selectedKeyword}
        keywordPage={keywordPage}
        keywordPageSize={keywordPageSize}
      />
    );
  }
  if (activeCategory === "title") {
    return (
      <TitleResults
        scopeLabel={scopeLabel}
        queryOptions={queryOptions}
        selectedKeyword={selectedKeyword}
        keywordPage={keywordPage}
        keywordPageSize={keywordPageSize}
      />
    );
  }
  let result: Awaited<ReturnType<typeof getCachedKeywordInsights>> | undefined;
  let errorMessage: string | undefined;
  let keywordResult: Awaited<ReturnType<typeof getKeywordJobs>> | undefined;
  let keywordError: string | undefined;
  const [insightsOutcome, keywordOutcome] = await Promise.allSettled([
    getCachedKeywordInsights(queryOptions),
    selectedKeyword
      ? getKeywordJobs({
        ...queryOptions,
        keyword: selectedKeyword,
        page: keywordPage,
        pageSize: keywordPageSize,
      })
      : Promise.resolve(undefined),
  ]);
  if (insightsOutcome.status === "fulfilled") {
    result = insightsOutcome.value;
  } else {
    errorMessage =
      insightsOutcome.reason instanceof Error
        ? insightsOutcome.reason.message
        : "Failed to load insights.";
  }
  if (keywordOutcome.status === "fulfilled") {
    keywordResult = keywordOutcome.value;
  } else {
    keywordError =
      keywordOutcome.reason instanceof Error
        ? keywordOutcome.reason.message
        : "Failed to load keyword jobs.";
  }

  if (!result) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-red-200 bg-red-50 text-red-400">
        {errorMessage}
      </div>
    );
  }

  return (
    <InsightsClient
      scopeLabel={scopeLabel}
      keywords={result.keywords}
      totalKeywords={result.totalCount}
      visualizedCount={result.keywords.length}
      limit={INSIGHTS_KEYWORD_LIMIT}
      lastUpdated={result.keywords[0]?.last_updated ?? null}
      activeCategory={activeCategory}
      selectedKeyword={selectedKeyword}
      keywordJobs={keywordResult?.jobs}
      keywordTotalCount={keywordResult?.totalCount}
      keywordPage={keywordPage}
      keywordPageSize={keywordPageSize}
      keywordError={keywordError}
    />
  );
}

async function TitleResults({
  scopeLabel,
  queryOptions,
  selectedKeyword,
  keywordPage,
  keywordPageSize,
}: {
  scopeLabel: string;
  queryOptions: Parameters<typeof getCachedKeywordInsights>[0];
  selectedKeyword?: string;
  keywordPage: number;
  keywordPageSize: 10 | 25 | 100;
}) {
  const { category: _category, ...titleFilters } = queryOptions ?? {};
  void _category;
  let result: Awaited<ReturnType<typeof getCachedTitleInsights>> | undefined;
  let errorMessage: string | undefined;
  try {
    result = await getCachedTitleInsights({ ...titleFilters, minCount: 2 });
  } catch (error) {
    errorMessage =
      error instanceof Error ? error.message : "Failed to load title insights.";
  }

  if (!result) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-red-200 bg-red-50 text-red-400">
        {errorMessage}
      </div>
    );
  }

  // Same segregation rule as locations: only a label from this cloud drills.
  const validSelection = selectedKeyword &&
      result.keywords.some((k) => k.keyword === selectedKeyword)
    ? selectedKeyword
    : undefined;
  let jobsResult: Awaited<ReturnType<typeof getTitleJobs>> | undefined;
  let jobsError: string | undefined;
  if (validSelection) {
    try {
      jobsResult = await getTitleJobs({
        ...titleFilters,
        label: validSelection,
        page: keywordPage,
        pageSize: keywordPageSize,
      });
    } catch (error) {
      jobsError =
        error instanceof Error ? error.message : "Failed to load title jobs.";
    }
  }

  return (
    <InsightsClient
      scopeLabel={scopeLabel}
      keywords={result.keywords}
      totalKeywords={result.totalCount}
      visualizedCount={result.keywords.length}
      limit={INSIGHTS_KEYWORD_LIMIT}
      lastUpdated={result.keywords[0]?.last_updated ?? null}
      activeCategory="title"
      selectedKeyword={validSelection}
      keywordJobs={jobsResult?.jobs}
      keywordTotalCount={jobsResult?.totalCount}
      keywordPage={keywordPage}
      keywordPageSize={keywordPageSize}
      keywordError={jobsError}
    />
  );
}

async function LocationResults({
  scopeLabel,
  queryOptions,
  granularity,
  foldSuburbs,
  perCapita,
  selectedKeyword,
  keywordPage,
  keywordPageSize,
}: {
  scopeLabel: string;
  queryOptions: Parameters<typeof getCachedKeywordInsights>[0];
  granularity: LocationInsightsGranularity;
  foldSuburbs: boolean;
  perCapita: boolean;
  selectedKeyword?: string;
  keywordPage: number;
  keywordPageSize: 10 | 25 | 100;
}) {
  const { category: _category, minCount: _minCount, limit: _limit, ...locationFilters } = queryOptions ?? {};
  void _category;
  void _minCount;
  void _limit;
  let result: Awaited<ReturnType<typeof getCachedLocationInsights>> | undefined;
  let errorMessage: string | undefined;
  try {
    result = await getCachedLocationInsights({ ...locationFilters, granularity, foldSuburbs });
  } catch (error) {
    errorMessage =
      error instanceof Error ? error.message : "Failed to load location insights.";
  }

  if (!result) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-red-200 bg-red-50 text-red-400">
        {errorMessage}
      </div>
    );
  }

  // A drill-down label is only honored when it names a bucket in the
  // current cloud, so keywords from other tabs (or the other granularity)
  // can never leak into the locations list.
  const validSelection = selectedKeyword &&
      result.keywords.some((k) => k.keyword === selectedKeyword)
    ? selectedKeyword
    : undefined;
  let jobsResult: Awaited<ReturnType<typeof getLocationJobs>> | undefined;
  let jobsError: string | undefined;
  if (validSelection) {
    try {
      jobsResult = await getLocationJobs({
        ...locationFilters,
        granularity,
        foldSuburbs,
        label: validSelection,
        page: keywordPage,
        pageSize: keywordPageSize,
      });
    } catch (error) {
      jobsError =
        error instanceof Error ? error.message : "Failed to load location jobs.";
    }
  }

  return (
    <InsightsClient
      scopeLabel={scopeLabel}
      keywords={result.keywords}
      totalKeywords={result.totalCount}
      visualizedCount={result.keywords.length}
      limit={result.keywords.length}
      lastUpdated={result.keywords[0]?.last_updated ?? null}
      activeCategory="location"
      loc={granularity}
      foldSuburbs={foldSuburbs}
      perCapita={perCapita}
      selectedKeyword={validSelection}
      keywordJobs={jobsResult?.jobs}
      keywordTotalCount={jobsResult?.totalCount}
      keywordPage={keywordPage}
      keywordPageSize={keywordPageSize}
      keywordError={jobsError}
    />
  );
}

export default async function InsightsPage({
  searchParams,
}: {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const rawParams = (await searchParams) ?? {};
  const params = sanitizeSearchParamsForRoute(rawParams, "/insights");
  const filters = parseFilterSearchParams(params, {
    knownArchetypes: KNOWN_ARCHETYPES,
  });
  const archetypes = filters.archetype?.length
    ? filters.archetype
    : [...KNOWN_ARCHETYPES];
  const activeCategory = filters.category ?? "all";
  const loc = filters.loc ?? "city";
  // Fold only applies to the city view; province ignores it server-side,
  // so drop it from the URL state there to keep shared links honest.
  const foldSuburbs = activeCategory === "location" && loc === "city"
    ? filters.fold === "greater"
    : false;
  const perCapita = filters.perCapita === true;
  const rawNavigation = parseFilterSearchParams(rawParams);
  const keywordPage = parsePageParam(rawParams) ?? 1;
  const keywordPageSize = rawNavigation.pageSize ?? 25;
  const scopeLabel = archetypes.map(archetypeLabel).join(", ");
  const queryOptions = {
    providers: filters.provider ? [filters.provider] : undefined,
    archetypes,
    levels: filters.level,
    filterStatus: filters.filterStatus,
    companies: filters.company,
    jobTitles: filters.jobTitle,
    provinces: filters.province,
    locationScopes: filters.locationScope,
    excludeMetros: filters.excludeMetro,
    category: activeCategory,
    minCount: 2,
    limit: INSIGHTS_KEYWORD_LIMIT,
  };
  const aggregateParams = { ...params };
  delete aggregateParams.keyword;
  const key = filterKey(aggregateParams);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <InsightsHeader />
      <Suspense key={key} fallback={<InsightsSkeleton />}>
        <InsightsResults
          filtersKey={key}
          scopeLabel={scopeLabel}
          activeCategory={activeCategory}
          queryOptions={queryOptions}
          selectedKeyword={filters.keyword}
          keywordPage={keywordPage}
          keywordPageSize={keywordPageSize}
          locationGranularity={activeCategory === "location" ? loc : undefined}
          foldSuburbs={foldSuburbs}
          perCapita={perCapita}
        />
      </Suspense>
    </div>
  );
}
