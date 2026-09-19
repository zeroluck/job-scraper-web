import { unstable_cache } from "next/cache";
import { createSupabaseServiceClient } from "@/utils/supabase/service";
import {
  deserializeLocationInsightsKey,
  normalizeLocationInsightsKey,
} from "./locationInsightsCacheKey.ts";
import {
  executeLocationInsightsQuery,
  type LocationInsightsQueryOptions,
  type LocationInsightsResult,
} from "./queries";

export { normalizeLocationInsightsKey };

const cachedFetch = unstable_cache(
  async (key: string): Promise<LocationInsightsResult> => {
    const options = deserializeLocationInsightsKey(key);
    const supabase = createSupabaseServiceClient();
    return executeLocationInsightsQuery(supabase, options);
  },
  ["location-insights-v6-contention"],
  { revalidate: 3600, tags: ["location-insights"] },
);

export function getCachedLocationInsights(
  options: LocationInsightsQueryOptions = {},
): Promise<LocationInsightsResult> {
  return cachedFetch(normalizeLocationInsightsKey(options));
}
