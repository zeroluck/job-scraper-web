import { unstable_cache } from "next/cache";
import { createSupabaseServiceClient } from "@/utils/supabase/service";
import {
  deserializeTitleInsightsKey,
  normalizeTitleInsightsKey,
} from "./titleInsightsCacheKey.ts";
import {
  executeTitleInsightsQuery,
  type TitleInsightsQueryOptions,
  type TitleInsightsResult,
} from "./queries";

export { normalizeTitleInsightsKey };

const cachedFetch = unstable_cache(
  async (key: string): Promise<TitleInsightsResult> => {
    const options = deserializeTitleInsightsKey(key);
    const supabase = createSupabaseServiceClient();
    return executeTitleInsightsQuery(supabase, options);
  },
  ["title-insights-v1"],
  { revalidate: 3600, tags: ["title-insights"] },
);

export function getCachedTitleInsights(
  options: TitleInsightsQueryOptions = {},
): Promise<TitleInsightsResult> {
  return cachedFetch(normalizeTitleInsightsKey(options));
}
