-- Map-ready location aggregates. Coordinates are maintained independently of
-- jobs so every country can supply its own authoritative place gazetteer.

CREATE TABLE IF NOT EXISTS public.insight_place_coordinates (
  bucket text PRIMARY KEY,
  country_code text NOT NULL,
  admin1_code text,
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  coordinate_source text NOT NULL,
  coordinate_quality text NOT NULL DEFAULT 'place_centroid',
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.insight_place_coordinates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.insight_place_coordinates FROM public, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.insight_place_coordinates TO service_role;

CREATE OR REPLACE FUNCTION public.listing_first_applicant_count(raw jsonb)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT (entry.value ->> 'applicant_count')::integer
  FROM jsonb_array_elements(
    CASE WHEN jsonb_typeof(raw) = 'array' THEN raw ELSE '[]'::jsonb END
  ) WITH ORDINALITY AS entry(value, ordinal)
  WHERE entry.value ->> 'applicant_count' ~ '^\d+$'
  ORDER BY
    CASE WHEN entry.value ->> 'scraped_at' ~ '^\d{4}-\d{2}-\d{2}'
      THEN (entry.value ->> 'scraped_at')::timestamptz END NULLS LAST,
    entry.ordinal
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.listing_first_applicant_observed_at(raw jsonb)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT (entry.value ->> 'scraped_at')::timestamptz
  FROM jsonb_array_elements(
    CASE WHEN jsonb_typeof(raw) = 'array' THEN raw ELSE '[]'::jsonb END
  ) WITH ORDINALITY AS entry(value, ordinal)
  WHERE entry.value ->> 'applicant_count' ~ '^\d+$'
    AND entry.value ->> 'scraped_at' ~ '^\d{4}-\d{2}-\d{2}'
  ORDER BY (entry.value ->> 'scraped_at')::timestamptz, entry.ordinal
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.listing_first_applicant_count(jsonb) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.listing_first_applicant_observed_at(jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.listing_first_applicant_count(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.listing_first_applicant_observed_at(jsonb) TO service_role;

ALTER TABLE public.job_location_buckets
  ADD COLUMN IF NOT EXISTS first_applicant_count integer,
  ADD COLUMN IF NOT EXISTS first_applicant_observed_at timestamptz,
  ADD COLUMN IF NOT EXISTS latest_applicant_count integer,
  ADD COLUMN IF NOT EXISTS latest_applicant_observed_at timestamptz;

CREATE OR REPLACE FUNCTION public.refresh_job_location_buckets()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  INSERT INTO public.job_location_buckets (
    job_id, city_bucket, folded_city_bucket, province_bucket, city_label,
    is_active, provider, level, company, job_title, location_province_code,
    location_scope, listing_location_province_codes, listing_location_scopes,
    location_metro, is_filtered, is_entry_level_filtered, last_seen_at,
    effective_posted_at, first_applicant_count, first_applicant_observed_at,
    latest_applicant_count, latest_applicant_observed_at, resolved_at
  )
  SELECT
    j.job_id,
    public.location_bucket(j.location, j.location_metro, j.location_scope, j.location_province_code, 'city', false),
    public.location_bucket(j.location, j.location_metro, j.location_scope, j.location_province_code, 'city', true),
    public.location_bucket(j.location, j.location_metro, j.location_scope, j.location_province_code, 'province', false),
    public.place_city_segment(j.location),
    j.is_active, j.provider, j.level, j.company, j.job_title,
    j.location_province_code, j.location_scope,
    j.listing_location_province_codes, j.listing_location_scopes,
    j.location_metro, j.is_filtered, j.is_entry_level_filtered,
    j.last_seen_at, j.effective_posted_at,
    public.listing_first_applicant_count(to_jsonb(j.listing_instances)),
    public.listing_first_applicant_observed_at(to_jsonb(j.listing_instances)),
    j.applicant_count,
    coalesce(j.last_checked, j.last_seen_at, j.scraped_at),
    now()
  FROM public.jobs j
  ON CONFLICT (job_id) DO UPDATE SET
    city_bucket = EXCLUDED.city_bucket,
    folded_city_bucket = EXCLUDED.folded_city_bucket,
    province_bucket = EXCLUDED.province_bucket,
    city_label = EXCLUDED.city_label,
    is_active = EXCLUDED.is_active,
    provider = EXCLUDED.provider,
    level = EXCLUDED.level,
    company = EXCLUDED.company,
    job_title = EXCLUDED.job_title,
    location_province_code = EXCLUDED.location_province_code,
    location_scope = EXCLUDED.location_scope,
    listing_location_province_codes = EXCLUDED.listing_location_province_codes,
    listing_location_scopes = EXCLUDED.listing_location_scopes,
    location_metro = EXCLUDED.location_metro,
    is_filtered = EXCLUDED.is_filtered,
    is_entry_level_filtered = EXCLUDED.is_entry_level_filtered,
    last_seen_at = EXCLUDED.last_seen_at,
    effective_posted_at = EXCLUDED.effective_posted_at,
    first_applicant_count = EXCLUDED.first_applicant_count,
    first_applicant_observed_at = EXCLUDED.first_applicant_observed_at,
    latest_applicant_count = EXCLUDED.latest_applicant_count,
    latest_applicant_observed_at = EXCLUDED.latest_applicant_observed_at,
    resolved_at = EXCLUDED.resolved_at;
$$;

CREATE OR REPLACE FUNCTION public.sync_job_location_buckets()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.job_location_buckets (
    job_id, city_bucket, folded_city_bucket, province_bucket, city_label,
    is_active, provider, level, company, job_title, location_province_code,
    location_scope, listing_location_province_codes, listing_location_scopes,
    location_metro, is_filtered, is_entry_level_filtered, last_seen_at,
    effective_posted_at, first_applicant_count, first_applicant_observed_at,
    latest_applicant_count, latest_applicant_observed_at, resolved_at
  ) VALUES (
    NEW.job_id,
    public.location_bucket(NEW.location, NEW.location_metro, NEW.location_scope, NEW.location_province_code, 'city', false),
    public.location_bucket(NEW.location, NEW.location_metro, NEW.location_scope, NEW.location_province_code, 'city', true),
    public.location_bucket(NEW.location, NEW.location_metro, NEW.location_scope, NEW.location_province_code, 'province', false),
    public.place_city_segment(NEW.location),
    NEW.is_active, NEW.provider, NEW.level, NEW.company, NEW.job_title,
    NEW.location_province_code, NEW.location_scope,
    NEW.listing_location_province_codes, NEW.listing_location_scopes,
    NEW.location_metro, NEW.is_filtered, NEW.is_entry_level_filtered,
    NEW.last_seen_at, NEW.effective_posted_at,
    public.listing_first_applicant_count(to_jsonb(NEW.listing_instances)),
    public.listing_first_applicant_observed_at(to_jsonb(NEW.listing_instances)),
    NEW.applicant_count,
    coalesce(NEW.last_checked, NEW.last_seen_at, NEW.scraped_at),
    now()
  )
  ON CONFLICT (job_id) DO UPDATE SET
    city_bucket = EXCLUDED.city_bucket,
    folded_city_bucket = EXCLUDED.folded_city_bucket,
    province_bucket = EXCLUDED.province_bucket,
    city_label = EXCLUDED.city_label,
    is_active = EXCLUDED.is_active,
    provider = EXCLUDED.provider,
    level = EXCLUDED.level,
    company = EXCLUDED.company,
    job_title = EXCLUDED.job_title,
    location_province_code = EXCLUDED.location_province_code,
    location_scope = EXCLUDED.location_scope,
    listing_location_province_codes = EXCLUDED.listing_location_province_codes,
    listing_location_scopes = EXCLUDED.listing_location_scopes,
    location_metro = EXCLUDED.location_metro,
    is_filtered = EXCLUDED.is_filtered,
    is_entry_level_filtered = EXCLUDED.is_entry_level_filtered,
    last_seen_at = EXCLUDED.last_seen_at,
    effective_posted_at = EXCLUDED.effective_posted_at,
    first_applicant_count = EXCLUDED.first_applicant_count,
    first_applicant_observed_at = EXCLUDED.first_applicant_observed_at,
    latest_applicant_count = EXCLUDED.latest_applicant_count,
    latest_applicant_observed_at = EXCLUDED.latest_applicant_observed_at,
    resolved_at = EXCLUDED.resolved_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS jobs_location_bucket_cache ON public.jobs;
CREATE TRIGGER jobs_location_bucket_cache
AFTER INSERT OR UPDATE OF
  location, is_active, provider, level, company, job_title, listing_instances,
  is_filtered, is_entry_level_filtered, last_seen_at, posted_at,
  last_seen_posted_at, applicant_count, last_checked, scraped_at
ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.sync_job_location_buckets();

SELECT public.refresh_job_location_buckets();

DROP FUNCTION IF EXISTS public.get_location_insights_date_bounds(
  text[], text[], text[], text, text[], text[], text[], text[], text[],
  text, boolean, text, timestamptz, timestamptz
);

CREATE FUNCTION public.get_location_insights_date_bounds(
  p_providers text[] DEFAULT NULL,
  p_archetypes text[] DEFAULT NULL,
  p_levels text[] DEFAULT NULL,
  p_filter_status text DEFAULT NULL,
  p_companies text[] DEFAULT NULL,
  p_job_titles text[] DEFAULT NULL,
  p_provinces text[] DEFAULT NULL,
  p_location_scopes text[] DEFAULT NULL,
  p_exclude_metros text[] DEFAULT NULL,
  p_granularity text DEFAULT 'city',
  p_fold_suburbs boolean DEFAULT false,
  p_place_view text DEFAULT 'all',
  p_posted_after timestamptz DEFAULT NULL,
  p_posted_before timestamptz DEFAULT NULL
) RETURNS TABLE(
  bucket text,
  label text,
  count bigint,
  total_count bigint,
  last_updated timestamptz,
  population_2021 bigint,
  per_100k numeric,
  stabilized_per_100k numeric,
  rate_reliability numeric,
  geo_match_quality text,
  is_cma_component boolean,
  latitude double precision,
  longitude double precision,
  contention_jobs bigint,
  observed_contention_jobs bigint,
  applicants_per_hour numeric,
  initial_applicants_median numeric,
  first_observation_lag_hours numeric
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY EXECUTE $query$
    WITH membership_ids AS MATERIALIZED (
      SELECT DISTINCT m.job_id
      FROM public.job_archetype_memberships m
      WHERE $2 IS NOT NULL
        AND m.archetype = ANY($2)
        AND ($4 = 'all'
          OR ($4 = 'filtered' AND m.is_filtered)
          OR ($4 = 'unfiltered' AND NOT m.is_filtered)
          OR ($4 = 'entry_level' AND m.is_filtered AND m.filter_reason LIKE 'title_entry_level:%'))
    ), scoped_base AS MATERIALIZED (
      SELECT b.job_id, b.last_seen_at, b.city_label, b.effective_posted_at,
        b.first_applicant_count, b.first_applicant_observed_at,
        b.latest_applicant_count, b.latest_applicant_observed_at,
        CASE WHEN $10 = 'province' THEN b.province_bucket
          WHEN $11 THEN b.folded_city_bucket ELSE b.city_bucket END AS bucket
      FROM public.job_location_buckets b
      LEFT JOIN membership_ids m ON m.job_id = b.job_id
      WHERE b.is_active
        AND ($2 IS NULL OR m.job_id IS NOT NULL)
        AND ($2 IS NOT NULL OR $4 IS NULL OR $4 = 'all'
          OR ($4 = 'filtered' AND b.is_filtered)
          OR ($4 = 'unfiltered' AND NOT coalesce(b.is_filtered, false))
          OR ($4 = 'entry_level' AND b.is_entry_level_filtered))
        AND ($1 IS NULL OR b.provider = ANY($1))
        AND ($3 IS NULL OR b.level = ANY($3))
        AND ($5 IS NULL OR b.company = ANY($5))
        AND ($6 IS NULL OR b.job_title = ANY($6))
        AND ($7 IS NULL OR $8 IS NULL
          OR ('country' = ANY($8) AND ('country' = b.location_scope OR ARRAY['country'] && b.listing_location_scopes))
          OR (b.location_province_code = ANY($7) AND b.location_scope = ANY($8))
          OR ($7 && b.listing_location_province_codes AND $8 && b.listing_location_scopes))
        AND ($7 IS NULL OR $8 IS NOT NULL OR b.location_province_code = ANY($7) OR $7 && b.listing_location_province_codes)
        AND ($8 IS NULL OR $7 IS NOT NULL OR b.location_scope = ANY($8) OR $8 && b.listing_location_scopes)
        AND ($9 IS NULL OR b.location_metro IS NULL OR NOT (b.location_metro = ANY($9)))
        AND ($13 IS NULL OR b.effective_posted_at >= $13)
        AND ($14 IS NULL OR b.effective_posted_at < $14)
    ), scoped AS (
      SELECT s.*,
        CASE WHEN s.latest_applicant_count IS NOT NULL
            AND s.first_applicant_count IS NOT NULL
            AND s.latest_applicant_count >= s.first_applicant_count
            AND s.latest_applicant_observed_at > s.first_applicant_observed_at + interval '1 hour'
          THEN (s.latest_applicant_count - s.first_applicant_count)::numeric /
            (extract(epoch FROM (s.latest_applicant_observed_at - s.first_applicant_observed_at)) / 3600)
        END AS observed_rate,
        CASE WHEN s.first_applicant_count IS NOT NULL
            AND s.first_applicant_observed_at > s.effective_posted_at
          THEN s.first_applicant_count::numeric /
            greatest(extract(epoch FROM (s.first_applicant_observed_at - s.effective_posted_at)) / 3600, 1)
        END AS initial_rate,
        CASE WHEN s.first_applicant_observed_at > s.effective_posted_at
          THEN extract(epoch FROM (s.first_applicant_observed_at - s.effective_posted_at)) / 3600
        END AS observation_lag
      FROM scoped_base s
    ), aggregated AS (
      SELECT s.bucket, max(s.city_label) AS city_label,
        count(*)::bigint AS bucket_count, max(s.last_seen_at) AS last_updated,
        count(coalesce(s.observed_rate, s.initial_rate))::bigint AS contention_jobs,
        count(s.observed_rate)::bigint AS observed_contention_jobs,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY coalesce(s.observed_rate, s.initial_rate))
          FILTER (WHERE coalesce(s.observed_rate, s.initial_rate) IS NOT NULL) AS applicants_per_hour,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY s.first_applicant_count)
          FILTER (WHERE s.first_applicant_count IS NOT NULL) AS initial_applicants_median,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY s.observation_lag)
          FILTER (WHERE s.observation_lag IS NOT NULL) AS first_observation_lag_hours
      FROM scoped s
      GROUP BY s.bucket
    ), eligible AS (
      SELECT a.*, p.population_2021, p.geo_match_quality, p.is_cma_component,
        pc.latitude, pc.longitude
      FROM aggregated a
      LEFT JOIN public.census_population_2021 p ON p.bucket = a.bucket
      LEFT JOIN public.insight_place_coordinates pc ON pc.bucket = a.bucket
      WHERE $12 <> 'small_town'
        OR (a.bucket LIKE 'c:%' AND p.population_2021 BETWEEN 1 AND 99999
          AND NOT p.is_cma_component AND p.geo_match_quality IN ('exact', 'parent'))
    ), collisions AS (
      SELECT split_part(split_part(e.bucket, '|', 1), ':', 2) AS norm
      FROM eligible e
      WHERE e.bucket LIKE 'c:%'
      GROUP BY 1
      HAVING count(DISTINCT nullif(split_part(e.bucket, '|', 2), '')) > 1
    ), pooled AS (
      SELECT CASE WHEN e.bucket LIKE 'm:%' THEN 'metro'
          WHEN e.bucket LIKE 'p:%' THEN 'province'
          WHEN e.bucket LIKE 'c:%' THEN 'city' ELSE 'scope' END AS rate_level,
        coalesce(sum(e.bucket_count)::numeric / nullif(sum(e.population_2021), 0), 0) AS pooled_rate
      FROM eligible e
      WHERE e.population_2021 > 0 AND e.geo_match_quality IN ('exact', 'parent', 'region')
      GROUP BY 1
    )
    SELECT e.bucket,
      CASE WHEN e.bucket LIKE 'm:%' THEN CASE WHEN $11
            THEN public.metro_folded_display(split_part(e.bucket, ':', 2))
            ELSE public.metro_display(split_part(e.bucket, ':', 2)) END
        WHEN e.bucket LIKE 'p:%' THEN public.province_display(split_part(e.bucket, ':', 2))
        WHEN e.bucket = 's:country' THEN 'Canada-wide'
        WHEN e.bucket LIKE 's:prov:%' THEN public.province_display(split_part(e.bucket, ':', 3)) || '-wide'
        WHEN e.bucket = 's:province' THEN 'Province-wide'
        WHEN e.bucket = 'u' THEN 'Unspecified'
        ELSE e.city_label || CASE WHEN c.norm IS NOT NULL
          THEN ' (' || upper(split_part(e.bucket, '|', 2)) || ')' ELSE '' END END AS display_label,
      e.bucket_count, count(*) OVER ()::bigint, e.last_updated,
      e.population_2021::bigint,
      CASE WHEN e.population_2021 > 0 THEN round(e.bucket_count::numeric * 100000 / e.population_2021, 1) END,
      CASE WHEN e.population_2021 <= 0 THEN NULL
        WHEN e.bucket NOT LIKE 'c:%' AND e.bucket NOT LIKE 'm:%' AND e.bucket NOT LIKE 'p:%'
          THEN round(e.bucket_count::numeric * 100000 / e.population_2021, 1)
        ELSE round(((e.bucket_count + coalesce(pr.pooled_rate, 0) * 50000) /
          (e.population_2021 + 50000)) * 100000, 1) END,
      CASE WHEN e.population_2021 <= 0 THEN NULL
        WHEN e.bucket NOT LIKE 'c:%' AND e.bucket NOT LIKE 'm:%' AND e.bucket NOT LIKE 'p:%' THEN 1
        ELSE round(e.population_2021::numeric / (e.population_2021 + 50000), 3) END,
      e.geo_match_quality, e.is_cma_component, e.latitude, e.longitude,
      e.contention_jobs, e.observed_contention_jobs,
      round(e.applicants_per_hour::numeric, 2),
      round(e.initial_applicants_median::numeric, 1),
      round(e.first_observation_lag_hours::numeric, 1)
    FROM eligible e
    LEFT JOIN collisions c ON c.norm = split_part(split_part(e.bucket, '|', 1), ':', 2)
      AND e.bucket LIKE 'c:%'
    LEFT JOIN pooled pr ON pr.rate_level = CASE WHEN e.bucket LIKE 'm:%' THEN 'metro'
      WHEN e.bucket LIKE 'p:%' THEN 'province'
      WHEN e.bucket LIKE 'c:%' THEN 'city' ELSE 'scope' END
    ORDER BY e.bucket_count DESC, display_label ASC
  $query$ USING
    p_providers, p_archetypes, p_levels, p_filter_status, p_companies,
    p_job_titles, p_provinces, p_location_scopes, p_exclude_metros,
    p_granularity, p_fold_suburbs, p_place_view, p_posted_after, p_posted_before;
END;
$$;

REVOKE ALL ON FUNCTION public.get_location_insights_date_bounds(
  text[], text[], text[], text, text[], text[], text[], text[], text[],
  text, boolean, text, timestamptz, timestamptz
) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_location_insights_date_bounds(
  text[], text[], text[], text, text[], text[], text[], text[], text[],
  text, boolean, text, timestamptz, timestamptz
) TO service_role;
