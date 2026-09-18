"use client";

import { X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { FilterId } from "@/lib/filters/types";
import {
  FILTER_PARAM_KEYS,
  parseFilterSearchParams,
  resetResultPosition,
} from "@/lib/filters/searchParams";

interface FilterChipsProps {
  supportedFilters: readonly FilterId[];
  knownArchetypes?: readonly string[];
}

const LABELS: Record<string, (value: string) => string> = {
  provider: (value) =>
    value === "linkedin" ? "LinkedIn" : "MyCareersFuture",
  interest: (value) =>
    value === "true"
      ? "Interested"
      : value === "false"
        ? "Not interested"
        : "Not marked",
  minScore: (value) => `Score at least ${value}`,
  maxScore: (value) => `Score at most ${value}`,
  level: (value) =>
    `Level: ${value === "Not Applicable" ? "Seniority unspecified" : value}`,
  archetype: (value) => `Archetype: ${value}`,
  filterStatus: (value) =>
    value === "show_filtered"
      ? "Include filtered jobs"
      : "Only entry-level filtered jobs",
  hasSalary: () => "Has salary",
  salaryMin: (value) => `Salary at least ${value}`,
  salaryMax: (value) => `Salary at most ${value}`,
  minRepostCount: (value) => `Repost count: at least ${value}`,
  datePosted: (value) =>
    value === "24h" ? "Last 24 hours" : value === "7d" ? "Last week" : "Last month",
  postedAfter: (value) => `Posted from ${value}`,
  postedBefore: (value) => `Posted through ${value}`,
  applicationStatus: (value) =>
    `Status: ${value === "offer" ? "Offer" : value[0].toUpperCase() + value.slice(1)}`,
  company: (value) => `Company: ${value}`,
  jobTitle: (value) => `Title: ${value}`,
  province: (value) => `Province: ${value}`,
  locationScope: (value) =>
    value === "local"
      ? "Cities/local areas"
      : value === "province"
        ? "Province-wide"
        : "Canada-wide",
  excludeMetro: (value) => `Exclude metro: ${value.replaceAll("_", " ")}`,
};

export default function FilterChips({
  supportedFilters,
  knownArchetypes,
}: FilterChipsProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const supportedKeys = new Set(
    supportedFilters.flatMap((filter) => FILTER_PARAM_KEYS[filter])
  );
  const params = new URLSearchParams(searchParams.toString());
  const parsed = knownArchetypes
    ? parseFilterSearchParams(params, { knownArchetypes })
    : parseFilterSearchParams(params);
  const chips: {
    key: string;
    value: string;
    label: string;
    occurrence: number;
  }[] = [];
  const occurrences = new Map<string, number>();

  searchParams.forEach((value, key) => {
    if (
      !supportedKeys.has(key) ||
      !LABELS[key] ||
      !isParsedValue(key, value, parsed)
    ) {
      return;
    }
    const identity = `${key}\u0000${value}`;
    const occurrence = occurrences.get(identity) ?? 0;
    occurrences.set(identity, occurrence + 1);
    chips.push({ key, value, label: LABELS[key](value), occurrence });
  });

  if (!chips.length) return null;

  const remove = (key: string, value: string, occurrence: number) => {
    const next = new URLSearchParams(searchParams.toString());
    const remaining: string[] = [];
    let matched = 0;
    for (const current of next.getAll(key)) {
      if (current === value && matched++ === occurrence) continue;
      remaining.push(current);
    }
    next.delete(key);
    remaining.forEach((current) => next.append(key, current));
    resetResultPosition(next);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2" aria-label="Active filters">
      {chips.map((chip) => (
        <span
          key={`${chip.key}-${chip.value}-${chip.occurrence}`}
          className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-800"
        >
          {chip.label}
          <button
            type="button"
            onClick={() => remove(chip.key, chip.value, chip.occurrence)}
            aria-label={`Remove ${chip.label} filter`}
            className="rounded-full p-0.5 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        </span>
      ))}
    </div>
  );
}

function isParsedValue(
  key: string,
  value: string,
  parsed: ReturnType<typeof parseFilterSearchParams>
): boolean {
  if (
    key === "level" ||
    key === "archetype" ||
    key === "company" ||
    key === "jobTitle" ||
    key === "province" ||
    key === "locationScope" ||
    key === "excludeMetro"
  ) {
    return (parsed[key] as readonly string[] | undefined)?.includes(value) ?? false;
  }
  if (key === "hasSalary") return parsed.hasSalary === true && value === "true";
  if (
    key === "minScore" ||
    key === "maxScore" ||
    key === "salaryMin" ||
    key === "salaryMax" ||
    key === "minRepostCount" ||
    key === "minSeenCount"
  ) {
    return parsed[key] !== undefined && parsed[key] === Number(value);
  }
  if (
    key === "provider" ||
    key === "interest" ||
    key === "filterStatus" ||
    key === "datePosted" ||
    key === "postedAfter" ||
    key === "postedBefore" ||
    key === "applicationStatus"
  ) {
    return parsed[key] === value;
  }
  return false;
}
