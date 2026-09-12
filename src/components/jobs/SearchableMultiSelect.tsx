"use client";

import { useEffect, useId, useMemo, useState } from "react";

interface SearchableMultiSelectProps {
  label: string;
  endpoint?: string;
  fetchOptions?: (query: string, signal?: AbortSignal) => Promise<string[]>;
  selected: readonly string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
}

const OPTIONS_LIMIT = 100;

function validOptions(payload: unknown): string[] {
  const candidate =
    Array.isArray(payload)
      ? payload
      : payload && typeof payload === "object" && "data" in payload
        ? (payload as { data: unknown }).data
        : undefined;
  return Array.isArray(candidate)
    ? candidate.filter((value): value is string => typeof value === "string")
    : [];
}

export default function SearchableMultiSelect({
  label,
  endpoint,
  fetchOptions,
  selected,
  onChange,
  placeholder = `Search ${label.toLowerCase()}`,
}: SearchableMultiSelectProps) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(false);
      try {
        let result: string[];
        if (fetchOptions) {
          result = await fetchOptions(query, controller.signal);
        } else if (endpoint) {
          const response = await fetch(
            `${endpoint}?q=${encodeURIComponent(query)}&limit=${OPTIONS_LIMIT}`,
            { signal: controller.signal }
          );
          if (!response.ok) {
            throw new Error(`Options request failed: ${response.status}`);
          }
          result = validOptions(await response.json());
        } else {
          result = [];
        }
        if (!controller.signal.aborted) setOptions(result);
      } catch {
        if (!controller.signal.aborted) {
          setOptions([]);
          setError(true);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 200);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [endpoint, fetchOptions, query]);

  const visible = useMemo(
    () => Array.from(new Set([...selected, ...options])),
    [options, selected]
  );

  const toggle = (option: string, checked: boolean) => {
    onChange(
      checked
        ? Array.from(new Set([...selected, option]))
        : selected.filter((value) => value !== option)
    );
  };

  return (
    <fieldset className="space-y-2">
      <legend className="sr-only">{label}</legend>
      <label htmlFor={`${id}-search`} className="sr-only">
        Search {label.toLowerCase()}
      </label>
      <input
        id={`${id}-search`}
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={placeholder}
        aria-controls={`${id}-options`}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
      />
      <div
        id={`${id}-options`}
        className="max-h-96 space-y-1 overflow-y-auto rounded-lg border border-gray-200 p-2"
        aria-busy={loading}
      >
        {visible.map((option) => (
          <label
            key={option}
            className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            <input
              type="checkbox"
              checked={selected.includes(option)}
              onChange={(event) => toggle(option, event.target.checked)}
              className="mt-0.5 rounded border-gray-300 text-blue-700 focus:ring-blue-500"
            />
            <span>{option}</span>
          </label>
        ))}
        {loading && <p className="px-2 py-1 text-sm text-gray-500">Loading...</p>}
        {!loading && error && (
          <p role="status" className="px-2 py-1 text-sm text-red-700">
            Options could not be loaded.
          </p>
        )}
        {!loading && !error && visible.length === 0 && (
          <p className="px-2 py-1 text-sm text-gray-500">No options found.</p>
        )}
      </div>
    </fieldset>
  );
}
