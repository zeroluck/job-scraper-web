"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { resetResultPosition } from "@/lib/filters/searchParams";
import {
  INSIGHTS_CATEGORY_VALUES,
  LOCATION_GRANULARITY_VALUES,
  type InsightsCategory,
  type LocationGranularity,
} from "@/lib/filters/types";
import type { JobListItem, KeywordInsight } from "@/types";
import TopMatchesList from "@/components/jobs/TopMatchesList";
import { CATEGORY_COLORS, CATEGORY_LABELS } from "./categoryColors";
import {
  DEFAULT_WORD_CLOUD_COUNT,
  WORD_CLOUD_COUNT_OPTIONS,
} from "./WordCloudClient";

const WordCloudClient = dynamic(() => import("./WordCloudClient"), {
  ssr: false,
  loading: () => (
    <div
      aria-label="Loading word cloud"
      className="flex h-64 items-center justify-center text-gray-400"
    >
      Loading word cloud…
    </div>
  ),
});

const LOCATION_GRANULARITY_LABELS: Record<LocationGranularity, string> = {
  city: "City",
  province: "State / Province",
};

function Legend() {
  // Keyword categories only: location/title tabs never appear on "all".
  const entries = Object.entries(CATEGORY_COLORS).filter(
    ([cat]) => cat !== "location" && cat !== "title",
  );
  return (
    <div className="mb-6 flex flex-wrap justify-center gap-4">
      {entries.map(([cat, color]) => (
        <div key={cat} className="flex items-center gap-1.5 text-sm text-gray-600">
          <div className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
          {CATEGORY_LABELS[cat as keyof typeof CATEGORY_LABELS] ?? cat}
        </div>
      ))}
    </div>
  );
}

function TopList({
  keywords,
  limit = 20,
  formatCount,
}: {
  keywords: KeywordInsight[];
  limit?: number;
  formatCount?: (keyword: KeywordInsight) => string;
}) {
  const sorted = [...keywords].sort((a, b) => b.count - a.count).slice(0, limit);
  const format = formatCount ?? ((k) => String(k.count));

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {sorted.map((k, i) => (
        <div
          key={`${k.category}:${k.keyword}:${i}`}
          className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-2 shadow-sm"
        >
          <div className="flex min-w-0 items-center gap-2">
            <span className="w-5 shrink-0 text-sm text-gray-400">{i + 1}</span>
            <div
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: CATEGORY_COLORS[k.category] ?? "#555" }}
            />
            <span className="truncate text-sm font-medium text-gray-800">{k.keyword}</span>
          </div>
          <span className="ml-2 shrink-0 text-sm text-gray-500">{format(k)}</span>
        </div>
      ))}
    </div>
  );
}

function KeywordChip({
  keyword,
  onRemove,
  prefix = "Keyword",
}: {
  keyword: string;
  onRemove: () => void;
  prefix?: string;
}) {
  const label = `${prefix}: ${keyword}`;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-800">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label} filter`}
        className="rounded-full p-0.5 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <X className="h-3 w-3" aria-hidden="true" />
      </button>
    </span>
  );
}

type InsightsClientProps = {
  scopeLabel: string;
  keywords: KeywordInsight[];
  totalKeywords: number;
  visualizedCount?: number;
  limit?: number;
  lastUpdated: string | null;
  activeCategory: InsightsCategory;
  loc?: LocationGranularity;
  foldSuburbs?: boolean;
  perCapita?: boolean;
  selectedKeyword?: string;
  keywordJobs?: JobListItem[];
  keywordTotalCount?: number;
  keywordPage?: number;
  keywordPageSize?: 10 | 25 | 100;
  keywordError?: string;
};

export default function InsightsClient({
  scopeLabel,
  keywords,
  totalKeywords,
  visualizedCount,
  limit,
  lastUpdated,
  activeCategory,
  loc = "city",
  foldSuburbs = false,
  perCapita = false,
  selectedKeyword,
  keywordJobs,
  keywordTotalCount,
  keywordPage = 1,
  keywordPageSize = 25,
  keywordError,
}: InsightsClientProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [visibleCount, setVisibleCount] = useState<number>(
    DEFAULT_WORD_CLOUD_COUNT,
  );

  const isLocation = activeCategory === "location";
  const isTitle = activeCategory === "title";
  // Per-capita is a pure display switch: the server always returns raw
  // counts alongside the rate, so buckets without a census denominator
  // keep their raw count and sort after rated buckets.
  const perCapitaActive = isLocation && perCapita;
  const displayKeywords = useMemo(() => {
    if (!perCapitaActive) return keywords;
    return keywords
      .map((k) => (k.per_100k != null ? { ...k, count: k.per_100k } : k))
      .sort((a, b) => {
        const aRated = a.per_100k != null;
        const bRated = b.per_100k != null;
        if (aRated !== bRated) return aRated ? -1 : 1;
        return b.count - a.count || (a.keyword < b.keyword ? -1 : 1);
      });
  }, [keywords, perCapitaActive]);
  const visibleKeywords = useMemo(
    () => displayKeywords.slice(0, visibleCount),
    [displayKeywords, visibleCount],
  );
  const formatCount = perCapitaActive
    ? (k: KeywordInsight) =>
      k.per_100k != null ? k.per_100k.toFixed(1) : String(k.count)
    : undefined;
  const drillCopy = isLocation
    ? {
      units: totalKeywords === 1 ? "location" : "locations",
      heading: "Jobs in",
      chipPrefix: "Location",
      empty: "No jobs in this location under the current filters.",
    }
    : isTitle
      ? {
        units: totalKeywords === 1 ? "job title" : "job titles",
        heading: "Jobs titled",
        chipPrefix: "Title",
        empty: "No jobs with this title under the current filters.",
      }
      : {
        units: "unique keywords",
        heading: "Jobs mentioning",
        chipPrefix: "Keyword",
        empty: "No jobs mention this keyword under the current filters.",
      };

  const selectCategory = (category: InsightsCategory) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("category", category);
    // Location granularity must not leak onto keyword tabs.
    if (category !== "location") next.delete("loc");
    resetResultPosition(next);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const selectLocationGranularity = (granularity: LocationGranularity) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("category", "location");
    next.set("loc", granularity);
    // Folding only exists in the city view; a folded province link would
    // be a lie, so drop it. Per-capita is display-only and survives.
    if (granularity !== "city") next.delete("fold");
    // A drilled label belongs to one namespace; clear it on switch.
    next.delete("keyword");
    resetResultPosition(next);
    const query = next.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const selectFoldSuburbs = (folded: boolean) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("category", "location");
    next.set("loc", "city");
    if (folded) next.set("fold", "greater");
    else next.delete("fold");
    // Folded and unfolded labels live in different namespaces.
    next.delete("keyword");
    resetResultPosition(next);
    const query = next.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const selectPerCapita = (on: boolean) => {
    const next = new URLSearchParams(searchParams.toString());
    if (on) next.set("percap", "true");
    else next.delete("percap");
    resetResultPosition(next);
    const query = next.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const selectKeyword = (keyword: string, category: string) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("keyword", keyword);
    if (isLocation) {
      next.set("category", "location");
    } else if (
      activeCategory === "all" &&
      (INSIGHTS_CATEGORY_VALUES as readonly string[]).includes(category) &&
      category !== "all"
    ) {
      // Ensure a concrete category so the drill-down list is scoped to the
      // clicked word's category instead of every category at once.
      next.set("category", category);
    }
    resetResultPosition(next);
    const query = next.toString();
    // Push (not replace) so browser Back returns to the undrilled cloud.
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const clearKeyword = () => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("keyword");
    resetResultPosition(next);
    const query = next.toString();
    // Push to keep Back/Forward symmetric with drill-down.
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const keywordTotalPages = Math.max(
    1,
    Math.ceil((keywordTotalCount ?? keywordJobs?.length ?? 0) / keywordPageSize),
  );

  return (
    <div>
      <div className="mb-6">
        <p className="text-sm text-gray-500">
          {scopeLabel} roles. Showing{" "}
          <span className="font-medium text-gray-700">
            {totalKeywords} {drillCopy.units}
          </span>
          {perCapitaActive && (
            <span> (jobs per 100k residents, 2021 Census)</span>
          )}
          {visualizedCount !== undefined &&
            limit !== undefined &&
            totalKeywords > visualizedCount && (
              <span>. Visualizing the top {visualizedCount}</span>
            )}
          .
          {lastUpdated && (
            <span className="ml-2 text-xs text-gray-400">
              Last updated {new Date(lastUpdated).toLocaleDateString()}
            </span>
          )}
        </p>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {INSIGHTS_CATEGORY_VALUES.map((category) => (
          <button
            key={category}
            type="button"
            onClick={() => selectCategory(category)}
            aria-pressed={activeCategory === category}
            className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
              activeCategory === category
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-gray-300 bg-white text-gray-600 hover:border-blue-400"
            }`}
          >
            {CATEGORY_LABELS[category]}
          </button>
        ))}
      </div>

      {selectedKeyword && (
        <section
          aria-label={`${drillCopy.heading} ${selectedKeyword}`}
          className="mb-8"
        >
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-gray-800">
              {drillCopy.heading} &ldquo;{selectedKeyword}&rdquo;
              {keywordTotalCount !== undefined && (
                <span className="ml-2 text-sm font-normal text-gray-600">
                  {keywordTotalCount} {keywordTotalCount === 1 ? "job" : "jobs"}
                </span>
              )}
            </h2>
            <KeywordChip
              keyword={selectedKeyword}
              onRemove={clearKeyword}
              prefix={drillCopy.chipPrefix}
            />
          </div>
          {keywordError ? (
            <div className="flex h-32 items-center justify-center rounded-xl border border-red-200 bg-red-50 px-6 text-center text-sm text-red-700">
              {keywordError}
            </div>
          ) : keywordJobs?.length ? (
            <TopMatchesList
              jobs={keywordJobs}
              currentPage={keywordPage}
              totalPages={keywordTotalPages}
              pageSize={keywordPageSize}
              listTitle={`${drillCopy.heading} ${selectedKeyword}`}
            />
          ) : (
            <div className="flex h-32 items-center justify-center rounded-xl border border-gray-200 bg-gray-50 px-6 text-center text-sm text-gray-600">
              {drillCopy.empty}
            </div>
          )}
        </section>
      )}

      {keywords.length ? (
        <>
          <div className="mb-8 min-h-64 rounded-xl border border-gray-200 bg-gray-50 p-4">
            {activeCategory === "all" && <Legend />}
            {isLocation && (
              <div
                className="mb-2 flex flex-wrap items-center gap-1"
                role="radiogroup"
                aria-label="Location granularity"
              >
                {LOCATION_GRANULARITY_VALUES.map((granularity) => (
                  <button
                    key={granularity}
                    type="button"
                    role="radio"
                    aria-checked={loc === granularity}
                    onClick={() => selectLocationGranularity(granularity)}
                    className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
                      loc === granularity
                        ? "border-blue-600 bg-blue-600 text-white"
                        : "border-gray-300 bg-white text-gray-600 hover:border-blue-400"
                    }`}
                  >
                    {LOCATION_GRANULARITY_LABELS[granularity]}
                  </button>
                ))}
              </div>
            )}
            {isLocation && (
              <div className="mb-2 flex flex-wrap items-center gap-1">
                {loc === "city" && (
                  <button
                    key="fold-suburbs"
                    type="button"
                    aria-pressed={foldSuburbs}
                    title="Fold suburbs and satellites into Greater Toronto, Greater Montreal, …"
                    onClick={() => selectFoldSuburbs(!foldSuburbs)}
                    className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
                      foldSuburbs
                        ? "border-blue-600 bg-blue-600 text-white"
                        : "border-gray-300 bg-white text-gray-600 hover:border-blue-400"
                    }`}
                  >
                    Greater metro areas
                  </button>
                )}
                <button
                  key="per-capita"
                  type="button"
                  aria-pressed={perCapitaActive}
                  title="Show jobs per 100k residents instead of raw counts"
                  onClick={() => selectPerCapita(!perCapitaActive)}
                  className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
                    perCapitaActive
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-gray-300 bg-white text-gray-600 hover:border-blue-400"
                  }`}
                >
                  Per 100k residents
                </button>
              </div>
            )}
            <div
              className="mb-2 flex flex-wrap items-center justify-between gap-2"
              role="radiogroup"
              aria-label="Number of keywords to display"
            >
              <span className="text-xs text-gray-500">
                Showing top {visibleKeywords.length} of {keywords.length}
              </span>
              <div className="flex flex-wrap gap-1">
                {WORD_CLOUD_COUNT_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={visibleCount === option}
                    onClick={() => setVisibleCount(option)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      visibleCount === option
                        ? "border-blue-600 bg-blue-600 text-white"
                        : "border-gray-300 bg-white text-gray-600 hover:border-blue-400"
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
            <WordCloudClient
              keywords={visibleKeywords}
              selectedKeyword={selectedKeyword}
              onWordClick={selectKeyword}
            />
          </div>

          <div className="mb-4">
            <h2 className="mb-3 text-lg font-semibold text-gray-800">
              Top {Math.min(20, keywords.length)} — {CATEGORY_LABELS[activeCategory]}
            </h2>
            <TopList keywords={displayKeywords} limit={20} formatCount={formatCount} />
          </div>
        </>
      ) : (
        <div className="flex h-64 items-center justify-center rounded-xl border border-gray-200 bg-gray-50 px-6 text-center text-gray-400">
          No insights match this category and filter selection.
        </div>
      )}
    </div>
  );
}
