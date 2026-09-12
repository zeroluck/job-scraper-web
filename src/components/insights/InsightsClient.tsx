"use client";

import dynamic from "next/dynamic";
import { X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { resetResultPosition } from "@/lib/filters/searchParams";
import {
  INSIGHTS_CATEGORY_VALUES,
  type InsightsCategory,
} from "@/lib/filters/types";
import type { JobListItem, KeywordInsight } from "@/types";
import TopMatchesList from "@/components/jobs/TopMatchesList";
import { CATEGORY_COLORS, CATEGORY_LABELS } from "./categoryColors";

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

function Legend() {
  return (
    <div className="mb-6 flex flex-wrap justify-center gap-4">
      {Object.entries(CATEGORY_COLORS).map(([cat, color]) => (
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
}: {
  keywords: KeywordInsight[];
  limit?: number;
}) {
  const sorted = [...keywords].sort((a, b) => b.count - a.count).slice(0, limit);

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
          <span className="ml-2 shrink-0 text-sm text-gray-500">{k.count}</span>
        </div>
      ))}
    </div>
  );
}

function KeywordChip({
  keyword,
  onRemove,
}: {
  keyword: string;
  onRemove: () => void;
}) {
  const label = `Keyword: ${keyword}`;
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

  const selectCategory = (category: InsightsCategory) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("category", category);
    resetResultPosition(next);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const selectKeyword = (keyword: string, category: string) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("keyword", keyword);
    // Ensure a concrete category so the drill-down list is scoped to the
    // clicked word's category instead of every category at once.
    if (
      activeCategory === "all" &&
      (INSIGHTS_CATEGORY_VALUES as readonly string[]).includes(category) &&
      category !== "all"
    ) {
      next.set("category", category);
    }
    resetResultPosition(next);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const clearKeyword = () => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("keyword");
    resetResultPosition(next);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
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
          <span className="font-medium text-gray-700">{totalKeywords} unique keywords</span>
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
          aria-label={`Jobs mentioning ${selectedKeyword}`}
          className="mb-8"
        >
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-gray-800">
              Jobs mentioning &ldquo;{selectedKeyword}&rdquo;
              {keywordTotalCount !== undefined && (
                <span className="ml-2 text-sm font-normal text-gray-600">
                  {keywordTotalCount} {keywordTotalCount === 1 ? "job" : "jobs"}
                </span>
              )}
            </h2>
            <KeywordChip keyword={selectedKeyword} onRemove={clearKeyword} />
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
              listTitle={`Jobs mentioning ${selectedKeyword}`}
            />
          ) : (
            <div className="flex h-32 items-center justify-center rounded-xl border border-gray-200 bg-gray-50 px-6 text-center text-sm text-gray-600">
              No jobs mention this keyword under the current filters.
            </div>
          )}
        </section>
      )}

      {keywords.length ? (
        <>
          <div className="mb-8 min-h-64 rounded-xl border border-gray-200 bg-gray-50">
            {activeCategory === "all" && <Legend />}
            <WordCloudClient keywords={keywords} onWordClick={selectKeyword} />
          </div>

          <div className="mb-4">
            <h2 className="mb-3 text-lg font-semibold text-gray-800">
              Top {Math.min(20, keywords.length)} — {CATEGORY_LABELS[activeCategory]}
            </h2>
            <TopList keywords={keywords} limit={20} />
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
