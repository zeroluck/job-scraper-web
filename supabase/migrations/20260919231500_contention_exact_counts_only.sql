-- Unknown source semantics are not exact enough for applicant pace. Keep only
-- observations explicitly classified as exact by the scraper.

CREATE OR REPLACE FUNCTION public.applicant_observation_is_exact(entry jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT entry ->> 'applicant_count' ~ '^\d+$'
    AND entry ->> 'scraped_at' ~ '^\d{4}-\d{2}-\d{2}'
    AND entry ->> 'applicant_count_type' = 'exact'
$$;

REVOKE ALL ON FUNCTION public.applicant_observation_is_exact(jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.applicant_observation_is_exact(jsonb) TO service_role;

SELECT public.refresh_job_location_buckets();
