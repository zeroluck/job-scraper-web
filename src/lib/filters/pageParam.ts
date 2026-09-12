import type { NextSearchParams } from "./searchParams.ts";

export function parsePageParam(input: NextSearchParams): number | undefined {
  const value = Array.isArray(input.page) ? input.page[0] : input.page;
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  const page = Number(value);
  return Number.isSafeInteger(page) && page >= 1 ? page : undefined;
}
