"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { resetResultPosition } from "@/lib/filters/searchParams";
import {
  INSIGHTS_CATEGORY_VALUES,
  type InsightsCategory,
} from "@/lib/filters/types";
import type { KeywordInsight } from "@/types";

const CATEGORY_COLORS: Record<string, string> = {
  skill: "#1976D2",
  technology: "#00897B",
  certification: "#F57C00",
  attribute: "#7B1FA2",
};

const CATEGORY_LABELS: Record<InsightsCategory, string> = {
  all: "All",
  skill: "Skills",
  technology: "Technologies",
  certification: "Certifications",
  attribute: "Attributes",
};

function WordCloud({ keywords }: { keywords: KeywordInsight[] }) {
  if (!keywords.length) {
    return (
      <div className="flex h-64 items-center justify-center text-gray-400">
        No data available for this category.
      </div>
    );
  }

  const maxCount = Math.max(...keywords.map((k) => k.count));
  const minCount = Math.min(...keywords.map((k) => k.count));

  const fontSize = (count: number) => {
    if (maxCount === minCount) return 24;
    const normalized = (count - minCount) / (maxCount - minCount);
    return Math.round(14 + normalized * 42);
  };

  const opacity = (count: number) => {
    if (maxCount === minCount) return 1;
    const normalized = (count - minCount) / (maxCount - minCount);
    return 0.5 + normalized * 0.5;
  };

  return (
    <div className="flex flex-wrap justify-center gap-3 p-6">
      {keywords.map((k, index) => (
        <span
          key={`${k.category}:${k.keyword}:${index}`}
          title={`${k.keyword} — ${k.count} job${k.count !== 1 ? "s" : ""}`}
          style={{
            fontSize: `${fontSize(k.count)}px`,
            color: CATEGORY_COLORS[k.category] ?? "#555",
            opacity: opacity(k.count),
            lineHeight: 1.3,
            cursor: "default",
            transition: "opacity 0.2s",
          }}
          className="select-none hover:opacity-100"
        >
          {k.keyword}
        </span>
      ))}
    </div>
  );
}

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

type InsightsClientProps = {
  scopeLabel: string;
  keywords: KeywordInsight[];
  totalKeywords: number;
  visualizedCount?: number;
  limit?: number;
  lastUpdated: string | null;
  activeCategory: InsightsCategory;
};

export default function InsightsClient({
  scopeLabel,
  keywords,
  totalKeywords,
  visualizedCount,
  limit,
  lastUpdated,
  activeCategory,
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

      {keywords.length ? (
        <>
          <div className="mb-8 min-h-64 rounded-xl border border-gray-200 bg-gray-50">
            {activeCategory === "all" && <Legend />}
            <WordCloud keywords={keywords} />
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
