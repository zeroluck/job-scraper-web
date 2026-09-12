import { unstable_cache } from "next/cache";
import { createSupabaseServiceClient } from "@/utils/supabase/service";
import {
  deserializeKeywordInsightsKey,
  normalizeKeywordInsightsKey,
} from "./keywordInsightsCacheKey.ts";
import {
  executeKeywordInsightsQuery,
  type KeywordInsightsQueryOptions,
  type KeywordInsightsResult,
} from "./queries";

export { normalizeKeywordInsightsKey };

const cachedFetch = unstable_cache(
  async (key: string): Promise<KeywordInsightsResult> => {
    const options = deserializeKeywordInsightsKey(key);
    const supabase = createSupabaseServiceClient();
    return executeKeywordInsightsQuery(supabase, options);
  },
  ["keyword-insights-v1"],
  { revalidate: 3600, tags: ["keyword-insights"] },
);

export function getCachedKeywordInsights(
  options: KeywordInsightsQueryOptions = {},
): Promise<KeywordInsightsResult> {
  return cachedFetch(normalizeKeywordInsightsKey(options));
}
