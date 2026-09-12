import { Suspense } from "react";

import InsightsClient from "@/components/insights/InsightsClient";
import FilterButton from "@/components/jobs/FilterButton";
import FilterChips from "@/components/jobs/FilterChips";
import { parseFilterSearchParams } from "@/lib/filters/searchParams";
import { ROUTE_FILTERS, sanitizeSearchParamsForRoute } from "@/lib/filters/routeConfig";
import { getCachedKeywordInsights } from "@/lib/supabase/cachedKeywordInsights";
import { INSIGHTS_KEYWORD_LIMIT } from "@/lib/supabase/queries";
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
}: {
  filtersKey: string;
  scopeLabel: string;
  activeCategory: "all" | "skill" | "technology" | "certification" | "attribute";
  queryOptions: Parameters<typeof getCachedKeywordInsights>[0];
}) {
  void filtersKey;
  let result: Awaited<ReturnType<typeof getCachedKeywordInsights>> | undefined;
  let errorMessage: string | undefined;
  try {
    result = await getCachedKeywordInsights(queryOptions);
  } catch (error) {
    errorMessage =
      error instanceof Error ? error.message : "Failed to load insights.";
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
  const key = filterKey(rawParams);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <InsightsHeader />
      <Suspense key={key} fallback={<InsightsSkeleton />}>
        <InsightsResults
          filtersKey={key}
          scopeLabel={scopeLabel}
          activeCategory={activeCategory}
          queryOptions={queryOptions}
        />
      </Suspense>
    </div>
  );
}
