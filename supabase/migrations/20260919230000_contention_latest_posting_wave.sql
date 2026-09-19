-- Keep exact applicant observations within the newest posting wave so reposts
-- are not mistaken for one continuous applicant-growth interval.

CREATE OR REPLACE FUNCTION public.listing_first_applicant_count(raw jsonb)
RETURNS integer LANGUAGE sql STABLE SET search_path = '' AS $$
  WITH entries AS MATERIALIZED (
    SELECT entry.value, entry.ordinal
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(raw) = 'array' THEN raw ELSE '[]'::jsonb END)
      WITH ORDINALITY AS entry(value, ordinal)
    WHERE public.applicant_observation_is_exact(entry.value)
  ), latest_wave AS (
    SELECT max(value ->> 'posted_at') AS posted_at FROM entries
  )
  SELECT (entry.value ->> 'applicant_count')::integer
  FROM entries entry CROSS JOIN latest_wave wave
  WHERE entry.value ->> 'posted_at' IS NOT DISTINCT FROM wave.posted_at
  ORDER BY (entry.value ->> 'scraped_at')::timestamptz, entry.ordinal
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.listing_first_applicant_observed_at(raw jsonb)
RETURNS timestamptz LANGUAGE sql STABLE SET search_path = '' AS $$
  WITH entries AS MATERIALIZED (
    SELECT entry.value, entry.ordinal
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(raw) = 'array' THEN raw ELSE '[]'::jsonb END)
      WITH ORDINALITY AS entry(value, ordinal)
    WHERE public.applicant_observation_is_exact(entry.value)
  ), latest_wave AS (
    SELECT max(value ->> 'posted_at') AS posted_at FROM entries
  )
  SELECT (entry.value ->> 'scraped_at')::timestamptz
  FROM entries entry CROSS JOIN latest_wave wave
  WHERE entry.value ->> 'posted_at' IS NOT DISTINCT FROM wave.posted_at
  ORDER BY (entry.value ->> 'scraped_at')::timestamptz, entry.ordinal
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.listing_latest_applicant_count(raw jsonb)
RETURNS integer LANGUAGE sql STABLE SET search_path = '' AS $$
  WITH entries AS MATERIALIZED (
    SELECT entry.value, entry.ordinal
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(raw) = 'array' THEN raw ELSE '[]'::jsonb END)
      WITH ORDINALITY AS entry(value, ordinal)
    WHERE public.applicant_observation_is_exact(entry.value)
  ), latest_wave AS (
    SELECT max(value ->> 'posted_at') AS posted_at FROM entries
  )
  SELECT (entry.value ->> 'applicant_count')::integer
  FROM entries entry CROSS JOIN latest_wave wave
  WHERE entry.value ->> 'posted_at' IS NOT DISTINCT FROM wave.posted_at
  ORDER BY (entry.value ->> 'scraped_at')::timestamptz DESC, entry.ordinal DESC
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.listing_latest_applicant_observed_at(raw jsonb)
RETURNS timestamptz LANGUAGE sql STABLE SET search_path = '' AS $$
  WITH entries AS MATERIALIZED (
    SELECT entry.value, entry.ordinal
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(raw) = 'array' THEN raw ELSE '[]'::jsonb END)
      WITH ORDINALITY AS entry(value, ordinal)
    WHERE public.applicant_observation_is_exact(entry.value)
  ), latest_wave AS (
    SELECT max(value ->> 'posted_at') AS posted_at FROM entries
  )
  SELECT (entry.value ->> 'scraped_at')::timestamptz
  FROM entries entry CROSS JOIN latest_wave wave
  WHERE entry.value ->> 'posted_at' IS NOT DISTINCT FROM wave.posted_at
  ORDER BY (entry.value ->> 'scraped_at')::timestamptz DESC, entry.ordinal DESC
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.listing_first_applicant_count(jsonb) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.listing_first_applicant_observed_at(jsonb) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.listing_latest_applicant_count(jsonb) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.listing_latest_applicant_observed_at(jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.listing_first_applicant_count(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.listing_first_applicant_observed_at(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.listing_latest_applicant_count(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.listing_latest_applicant_observed_at(jsonb) TO service_role;

SELECT public.refresh_job_location_buckets();
