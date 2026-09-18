"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";

import SearchableMultiSelect from "./SearchableMultiSelect";
import {
  APPLICATION_STATUS_VALUES,
  DATE_POSTED_VALUES,
  LEVEL_VALUES,
  LOCATION_SCOPE_VALUES,
  METRO_VALUES,
  PROVINCE_VALUES,
  type FilterId,
} from "@/lib/filters/types";
import {
  FILTER_PARAM_KEYS,
  clearSupportedFilters,
  parseFilterSearchParams,
  resetResultPosition,
  setRepeatedParam,
} from "@/lib/filters/searchParams";
import { CANONICAL_ARCHETYPES } from "@/lib/archetypes/registry";
import { METRO_LABELS, PROVINCE_LABELS } from "@/lib/insights/locations";

export interface JobFiltersSidebarProps {
  supportedFilters: readonly FilterId[];
  isOpen: boolean;
  onClose: () => void;
  id?: string;
  knownArchetypes?: readonly string[];
}

const PROVIDERS = [
  { value: "linkedin", label: "LinkedIn" },
  { value: "careers_future", label: "MyCareersFuture" },
] as const;

const INTERESTS = [
  { value: "true", label: "Interested" },
  { value: "false", label: "Not interested" },
  { value: "null", label: "Not marked" },
] as const;

const APPLICATION_STATUS_LABELS = {
  applied: "Applied",
  interviewing: "Interviewing",
  offer: "Offer",
  rejected: "Rejected",
} as const;

const DATE_OPTIONS = [
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last week" },
  { value: "30d", label: "Last month" },
] as const;
const LEVEL_LABELS: Record<string, string> = {
  "Not Applicable": "Seniority unspecified",
};

const SCOPE_OPTIONS = [
  { value: "local", label: "Cities and local areas" },
  { value: "province", label: "Province-wide listings" },
  { value: "country", label: "Canada-wide listings" },
] as const;


const inputClass =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20";

function url(pathname: string, params: URLSearchParams): string {
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export default function JobFiltersSidebar({
  supportedFilters,
  isOpen,
  onClose,
  id = "job-filters-sidebar",
  knownArchetypes = [],
}: JobFiltersSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const paramsKey = searchParams.toString();
  const [draftParamsKey, setDraftParamsKey] = useState(paramsKey);
  const [isApplying, startApply] = useTransition();
  const wasOpen = useRef(isOpen);
  const prevParamsKey = useRef(paramsKey);

  useEffect(() => {
    // Sync the draft when the drawer opens. While open, only follow the
    // committed URL when there are no unsaved edits, so an in-flight Apply
    // never wipes out tweaks made before it commits.
    if (isOpen && !wasOpen.current) {
      setDraftParamsKey(paramsKey);
    } else if (isOpen && paramsKey !== prevParamsKey.current) {
      const hasUnsavedEdits = draftParamsKey !== prevParamsKey.current;
      if (!hasUnsavedEdits) setDraftParamsKey(paramsKey);
    }
    wasOpen.current = isOpen;
    prevParamsKey.current = paramsKey;
  }, [isOpen, paramsKey, draftParamsKey]);

  const filters = useMemo(
    () =>
      parseFilterSearchParams(new URLSearchParams(draftParamsKey), {
        knownArchetypes,
      }),
    [knownArchetypes, draftParamsKey]
  );
  const archetypes = useMemo(
    () => Array.from(new Set([...CANONICAL_ARCHETYPES, ...knownArchetypes])),
    [knownArchetypes]
  );

  const updateDraft = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      setDraftParamsKey((current) => {
        const next = new URLSearchParams(current);
        mutate(next);
        resetResultPosition(next);
        return next.toString();
      });
    },
    []
  );

  const updateScalar = useCallback(
    (key: string, value: string | undefined) => {
      updateDraft((next) => {
        if (value === undefined || value === "") next.delete(key);
        else next.set(key, value);
      });
    },
    [updateDraft]
  );

  const updateArray = useCallback(
    (
      key:
        | "level"
        | "archetype"
        | "company"
        | "jobTitle"
        | "province"
        | "locationScope"
        | "excludeMetro",
      selected: string[]
    ) => {
      updateDraft((next) => setRepeatedParam(next, key, selected));
    },
    [updateDraft]
  );

  const clearFilters = () => {
    updateDraft((next) => {
      clearSupportedFilters(next, supportedFilters);
    });
  };

  const hasUnappliedChanges = draftParamsKey !== paramsKey;

  const applyFilters = () => {
    const target = draftParamsKey;
    // Keep the drawer open so results can be refined without reopening.
    startApply(() => {
      router.replace(url(pathname, new URLSearchParams(target)), {
        scroll: false,
      });
    });
  };

  const hasActiveFilters = supportedFilters.some((filter) => {
    if (filter === "score") {
      return filters.minScore !== undefined || filters.maxScore !== undefined;
    }
    if (filter === "salaryRange") {
      return filters.salaryMin !== undefined || filters.salaryMax !== undefined;
    }
    if (filter === "repostCount") return filters.minRepostCount !== undefined;
    if (filter === "seenCount") return filters.minSeenCount !== undefined;
    if (filter === "location") {
      return (
        filters.province !== undefined ||
        filters.locationScope !== undefined ||
        filters.excludeMetro !== undefined
      );
    }
    // Generic fallback based on param keys so composite filters work.
    const keys = FILTER_PARAM_KEYS[filter];
    if (keys) {
      const draft = new URLSearchParams(draftParamsKey);
      return keys.some((key) => draft.has(key));
    }
    return filters[filter as keyof typeof filters] !== undefined;
  });

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (
        event.key !== "Tab" ||
        window.matchMedia("(min-width: 64rem)").matches
      ) {
        return;
      }
      const sidebar = document.getElementById(id);
      const focusable = sidebar?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), summary, [tabindex]:not([tabindex='-1'])"
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [id, isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <>
      <button
        type="button"
        aria-label="Close filters"
        className="fixed inset-0 z-40 cursor-default bg-black/45 lg:hidden"
        onClick={onClose}
      />
      <aside
        id={id}
        role="dialog"
        aria-label="Job filters"
        className="fixed inset-0 z-50 flex h-dvh w-full flex-col bg-white shadow-2xl lg:inset-y-0 lg:left-auto lg:right-0 lg:w-96 lg:border-l lg:border-gray-200"
      >
        <header className="flex min-h-16 items-center justify-between border-b border-gray-200 px-5">
          <div>
            <h2 className="font-semibold text-gray-950">Filters</h2>
            <p className="text-xs text-gray-500">Changes apply together</p>
          </div>
          <div className="flex items-center gap-3">
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="text-sm font-medium text-blue-700 hover:text-blue-900"
              >
                Clear filters
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close filters"
              className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 hover:text-gray-950 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-5 pb-8">
          {supportedFilters.includes("provider") && (
            <FilterSection label="Provider">
              <RadioList
                name="provider"
                value={filters.provider}
                options={PROVIDERS}
                onChange={(value) => updateScalar("provider", value)}
              />
            </FilterSection>
          )}

          {supportedFilters.includes("datePosted") && (
            <FilterSection label="Date posted">
              <RadioList
                name="datePosted"
                value={filters.datePosted}
                options={DATE_OPTIONS.filter((option) =>
                  DATE_POSTED_VALUES.includes(option.value)
                )}
                emptyLabel="All time"
                onChange={(value) =>
                  updateDraft((next) => {
                    if (value) next.set("datePosted", value);
                    else next.delete("datePosted");
                    if (value) {
                      next.delete("postedAfter");
                      next.delete("postedBefore");
                    }
                  })
                }
              />
              {pathname === "/insights" && (
                <div className="mt-4 grid grid-cols-2 gap-3 border-t border-gray-200 pt-4">
                  <label className="text-xs font-medium text-gray-600">
                    Posted from
                    <input
                      type="date"
                      value={filters.postedAfter ?? ""}
                      max={filters.postedBefore}
                      onChange={(event) =>
                        updateDraft((next) => {
                          next.delete("datePosted");
                          if (event.target.value) next.set("postedAfter", event.target.value);
                          else next.delete("postedAfter");
                        })
                      }
                      className={`${inputClass} mt-1`}
                    />
                  </label>
                  <label className="text-xs font-medium text-gray-600">
                    Posted through
                    <input
                      type="date"
                      value={filters.postedBefore ?? ""}
                      min={filters.postedAfter}
                      onChange={(event) =>
                        updateDraft((next) => {
                          next.delete("datePosted");
                          if (event.target.value) next.set("postedBefore", event.target.value);
                          else next.delete("postedBefore");
                        })
                      }
                      className={`${inputClass} mt-1`}
                    />
                  </label>
                  <p className="col-span-2 text-xs text-gray-500">
                    Bounds use the effective posting date and include the full through date.
                  </p>
                </div>
              )}
            </FilterSection>
          )}

          {supportedFilters.includes("interest") && (
            <FilterSection label="Interest status">
              <RadioList
                name="interest"
                value={filters.interest}
                options={INTERESTS}
                onChange={(value) => updateScalar("interest", value)}
              />
            </FilterSection>
          )}

          {supportedFilters.includes("score") && (
            <FilterSection label="Resume score">
              <div className="grid grid-cols-2 gap-3">
                <NumericDraft
                  label="Minimum score"
                  value={filters.minScore}
                  minimum={0}
                  maximum={100}
                  onCommit={(value) => updateScalar("minScore", value)}
                />
                <NumericDraft
                  label="Maximum score"
                  value={filters.maxScore}
                  minimum={0}
                  maximum={100}
                  onCommit={(value) => updateScalar("maxScore", value)}
                />
              </div>
            </FilterSection>
          )}

          {supportedFilters.includes("level") && (
            <FilterSection label="Level">
              <CheckboxList
                values={LEVEL_VALUES}
                selected={filters.level ?? []}
                labels={LEVEL_LABELS}
                onChange={(selected) => updateArray("level", selected)}
              />
            </FilterSection>
          )}

          {supportedFilters.includes("location") && (
            <FilterSection label="Geographic location">
              <div className="space-y-5">
                <CheckboxList
                  values={PROVINCE_VALUES}
                  selected={filters.province ?? []}
                  labels={PROVINCE_LABELS}
                  onChange={(selected) => updateArray("province", selected)}
                />
                <fieldset>
                  <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Listing coverage
                  </legend>
                  <CheckboxList
                    values={LOCATION_SCOPE_VALUES}
                    selected={filters.locationScope ?? []}
                    labels={Object.fromEntries(
                      SCOPE_OPTIONS.map((option) => [option.value, option.label]),
                    )}
                    onChange={(selected) => updateArray("locationScope", selected)}
                  />
                </fieldset>
                <fieldset>
                  <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Exclude metropolitan areas
                  </legend>
                  <CheckboxList
                    values={METRO_VALUES}
                    selected={filters.excludeMetro ?? []}
                    labels={METRO_LABELS}
                    onChange={(selected) => updateArray("excludeMetro", selected)}
                  />
                </fieldset>
              </div>
            </FilterSection>
          )}

          {supportedFilters.includes("archetype") && (
            <FilterSection label="Archetype">
              <CheckboxList
                values={archetypes}
                selected={filters.archetype ?? []}
                onChange={(selected) => updateArray("archetype", selected)}
              />
            </FilterSection>
          )}

          {supportedFilters.includes("filterStatus") && (
            <FilterSection label="Filter status">
              <RadioList
                name="filterStatus"
                value={filters.filterStatus}
                options={[
                  { value: "show_filtered", label: "Include all jobs" },
                  { value: "entry_level", label: "Only entry-level filtered jobs" },
                ]}
                emptyLabel="Exclude filtered jobs"
                onChange={(value) => updateScalar("filterStatus", value)}
              />
            </FilterSection>
          )}

          {supportedFilters.includes("hasSalary") && (
            <FilterSection label="Salary">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-800">
                <input
                  type="checkbox"
                  checked={filters.hasSalary === true}
                  onChange={(event) =>
                    updateDraft((next) => {
                      if (event.target.checked) next.set("hasSalary", "true");
                      else {
                        next.delete("hasSalary");
                        next.delete("salaryMin");
                        next.delete("salaryMax");
                      }
                    })
                  }
                  className="rounded border-gray-300 text-blue-700 focus:ring-blue-500"
                />
                Has salary listed
              </label>
              {supportedFilters.includes("salaryRange") && filters.hasSalary && (
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <NumericDraft
                    label="Minimum salary"
                    value={filters.salaryMin}
                    minimum={0}
                    onCommit={(value) => updateScalar("salaryMin", value)}
                  />
                  <NumericDraft
                    label="Maximum salary"
                    value={filters.salaryMax}
                    minimum={0}
                    onCommit={(value) => updateScalar("salaryMax", value)}
                  />
                </div>
              )}
            </FilterSection>
          )}

          {supportedFilters.includes("repostCount") && (
            <FilterSection label="Repost count">
              <NumericDraft
                label="Minimum repost count"
                value={filters.minRepostCount}
                minimum={0}
                onCommit={(value) => updateScalar("minRepostCount", value)}
              />
            </FilterSection>
          )}

          {supportedFilters.includes("applicationStatus") && (
            <FilterSection label="Application status">
              <RadioList
                name="applicationStatus"
                value={filters.applicationStatus}
                options={APPLICATION_STATUS_VALUES.map((value) => ({
                  value,
                  label: APPLICATION_STATUS_LABELS[value],
                }))}
                onChange={(value) => updateScalar("applicationStatus", value)}
              />
            </FilterSection>
          )}

          {supportedFilters.includes("company") && (
            <FilterSection label="Company">
              <SearchableMultiSelect
                label="Companies"
                endpoint="/api/jobs/companies"
                selected={filters.company ?? []}
                onChange={(selected) => updateArray("company", selected)}
                placeholder="Search companies"
              />
            </FilterSection>
          )}

          {supportedFilters.includes("jobTitle") && (
            <FilterSection label="Job title">
              <SearchableMultiSelect
                label="Job titles"
                endpoint="/api/jobs/titles"
                selected={filters.jobTitle ?? []}
                onChange={(selected) => updateArray("jobTitle", selected)}
                placeholder="Search job titles"
              />
            </FilterSection>
          )}
        </div>
        <footer className="flex items-center justify-between gap-3 border-t border-gray-200 px-5 py-4">
          <p className="text-xs text-gray-500">
            {isApplying
              ? "Applying…"
              : hasUnappliedChanges
                ? "Unapplied changes"
                : "Changes apply together"}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Close
            </button>
            <button
              type="button"
              onClick={applyFilters}
              disabled={isApplying || !hasUnappliedChanges}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-70"
            >
              {isApplying ? "Applying…" : "Apply filters"}
            </button>
          </div>
        </footer>
      </aside>
    </>
  );
}

function FilterSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);
  return (
    <details
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
      className="group border-b border-gray-200 py-4"
    >
      <summary className="cursor-pointer select-none text-sm font-semibold text-gray-950 marker:text-gray-400">
        {label}
      </summary>
      <div className="mt-3 space-y-2">{children}</div>
    </details>
  );
}

function RadioList<T extends string>({
  name,
  value,
  options,
  emptyLabel = "Any",
  onChange,
}: {
  name: string;
  value: T | undefined;
  options: readonly { value: T; label: string }[];
  emptyLabel?: string;
  onChange: (value: T | undefined) => void;
}) {
  return (
    <div className="space-y-2">
      <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
        <input
          type="radio"
          name={name}
          checked={value === undefined}
          onChange={() => onChange(undefined)}
          className="border-gray-300 text-blue-700 focus:ring-blue-500"
        />
        {emptyLabel}
      </label>
      {options.map((option) => (
        <label
          key={option.value}
          className="flex cursor-pointer items-center gap-2 text-sm text-gray-700"
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            className="border-gray-300 text-blue-700 focus:ring-blue-500"
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}

function CheckboxList<T extends string>({
  values,
  selected,
  labels,
  onChange,
}: {
  values: readonly T[];
  selected: readonly T[];
  labels?: Readonly<Record<string, string>>;
  onChange: (values: T[]) => void;
}) {
  return (
    <div className="space-y-2">
      {values.map((value) => (
        <label
          key={value}
          className="flex cursor-pointer items-center gap-2 text-sm text-gray-700"
        >
          <input
            type="checkbox"
            value={value}
            checked={selected.includes(value)}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? [...selected, value]
                  : selected.filter((item) => item !== value)
              )
            }
            className="rounded border-gray-300 text-blue-700 focus:ring-blue-500"
          />
          {labels?.[value] ?? value}
        </label>
      ))}
    </div>
  );
}

function NumericDraft({
  label,
  value,
  minimum,
  maximum,
  onCommit,
}: {
  label: string;
  value: number | undefined;
  minimum: number;
  maximum?: number;
  onCommit: (value: string | undefined) => void;
}) {
  const [draft, setDraft] = useState(value?.toString() ?? "");

  useEffect(() => setDraft(value?.toString() ?? ""), [value]);

  const commit = () => {
    const parsed = Number(draft);
    if (
      draft === "" ||
      !Number.isSafeInteger(parsed) ||
      parsed < minimum ||
      (maximum !== undefined && parsed > maximum)
    ) {
      setDraft(value?.toString() ?? "");
      if (draft === "") onCommit(undefined);
      return;
    }
    onCommit(parsed.toString());
  };

  return (
    <label className="block text-xs font-medium text-gray-600">
      {label}
      <input
        type="number"
        inputMode="numeric"
        min={minimum}
        max={maximum}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
        className={`${inputClass} mt-1`}
      />
    </label>
  );
}
