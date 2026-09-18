-- Canonical location aggregate and drill-down implementation.
-- Keep the hot path on narrow cached rows; location parsing runs only when a
-- job's source fields change or an explicit cache refresh is requested.

CREATE TABLE IF NOT EXISTS public.job_location_buckets (
  job_id text PRIMARY KEY REFERENCES public.jobs(job_id) ON DELETE CASCADE,
  city_bucket text NOT NULL,
  folded_city_bucket text NOT NULL,
  province_bucket text NOT NULL,
  city_label text NOT NULL,
  is_active boolean NOT NULL,
  provider text,
  level text,
  company text,
  job_title text,
  location_province_code text,
  location_scope text,
  listing_location_province_codes text[],
  listing_location_scopes text[],
  location_metro text,
  is_filtered boolean,
  is_entry_level_filtered boolean,
  last_seen_at timestamptz,
  effective_posted_at timestamptz,
  resolved_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.job_location_buckets
  ADD COLUMN IF NOT EXISTS city_label text,
  ADD COLUMN IF NOT EXISTS is_active boolean,
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS level text,
  ADD COLUMN IF NOT EXISTS company text,
  ADD COLUMN IF NOT EXISTS job_title text,
  ADD COLUMN IF NOT EXISTS location_province_code text,
  ADD COLUMN IF NOT EXISTS location_scope text,
  ADD COLUMN IF NOT EXISTS listing_location_province_codes text[],
  ADD COLUMN IF NOT EXISTS listing_location_scopes text[],
  ADD COLUMN IF NOT EXISTS location_metro text,
  ADD COLUMN IF NOT EXISTS is_filtered boolean,
  ADD COLUMN IF NOT EXISTS is_entry_level_filtered boolean,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS effective_posted_at timestamptz;

ALTER TABLE public.job_location_buckets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.job_location_buckets FROM public, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.job_location_buckets TO service_role;

CREATE INDEX IF NOT EXISTS job_location_buckets_city_idx
  ON public.job_location_buckets (city_bucket);
CREATE INDEX IF NOT EXISTS job_location_buckets_folded_idx
  ON public.job_location_buckets (folded_city_bucket);
CREATE INDEX IF NOT EXISTS job_location_buckets_province_idx
  ON public.job_location_buckets (province_bucket);
CREATE INDEX IF NOT EXISTS job_archetype_memberships_location_cover_idx
  ON public.job_archetype_memberships (archetype, is_filtered, job_id)
  INCLUDE (filter_reason);

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
    effective_posted_at, resolved_at
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
    j.last_seen_at, j.effective_posted_at, now()
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
    effective_posted_at, resolved_at
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
    NEW.last_seen_at, NEW.effective_posted_at, now()
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
    resolved_at = EXCLUDED.resolved_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS jobs_location_bucket_cache ON public.jobs;
CREATE TRIGGER jobs_location_bucket_cache
AFTER INSERT OR UPDATE OF
  location, is_active, provider, level, company, job_title, listing_instances,
  is_filtered, is_entry_level_filtered, last_seen_at, posted_at,
  last_seen_posted_at
ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.sync_job_location_buckets();

SELECT public.refresh_job_location_buckets();
DELETE FROM public.job_location_buckets b
WHERE NOT EXISTS (SELECT 1 FROM public.jobs j WHERE j.job_id = b.job_id);
ALTER TABLE public.job_location_buckets
  ALTER COLUMN city_label SET NOT NULL,
  ALTER COLUMN is_active SET NOT NULL;

REVOKE ALL ON FUNCTION public.refresh_job_location_buckets() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_job_location_buckets() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_job_location_buckets() FROM service_role;
GRANT EXECUTE ON FUNCTION public.refresh_job_location_buckets() TO service_role;

DROP FUNCTION IF EXISTS public.get_location_insights(text[],text[],text[],text,text[],text[],text[],text[],text[],text,boolean);
DROP FUNCTION IF EXISTS public.get_location_insights(text[],text[],text[],text,text[],text[],text[],text[],text[],text,boolean,text);

CREATE FUNCTION public.get_location_insights(
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
  p_place_view text DEFAULT 'all'
) RETURNS TABLE(
  label text,
  count bigint,
  total_count bigint,
  last_updated timestamptz,
  population_2021 bigint,
  per_100k numeric,
  stabilized_per_100k numeric,
  rate_reliability numeric,
  geo_match_quality text,
  is_cma_component boolean
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
SET plan_cache_mode = 'force_custom_plan'
AS $$
  WITH membership_ids AS MATERIALIZED (
    SELECT DISTINCT m.job_id
    FROM public.job_archetype_memberships m
    WHERE p_archetypes IS NOT NULL
      AND m.archetype = ANY(p_archetypes)
      AND (
        p_filter_status = 'all'
        OR (p_filter_status = 'filtered' AND m.is_filtered)
        OR (p_filter_status = 'unfiltered' AND NOT m.is_filtered)
        OR (p_filter_status = 'entry_level' AND m.is_filtered AND m.filter_reason LIKE 'title_entry_level:%')
      )
  ), scoped AS (
    SELECT
      b.job_id,
      b.last_seen_at,
      b.city_label,
      CASE
        WHEN p_granularity = 'province' THEN b.province_bucket
        WHEN p_fold_suburbs THEN b.folded_city_bucket
        ELSE b.city_bucket
      END AS bucket
    FROM public.job_location_buckets b
    LEFT JOIN membership_ids m ON m.job_id = b.job_id
    WHERE b.is_active
      AND (p_archetypes IS NULL OR m.job_id IS NOT NULL)
      AND (
        p_archetypes IS NOT NULL
        OR p_filter_status IS NULL
        OR p_filter_status = 'all'
        OR (p_filter_status = 'filtered' AND b.is_filtered)
        OR (p_filter_status = 'unfiltered' AND NOT coalesce(b.is_filtered, false))
        OR (p_filter_status = 'entry_level' AND b.is_entry_level_filtered)
      )
      AND (p_providers IS NULL OR b.provider = ANY(p_providers))
      AND (p_levels IS NULL OR b.level = ANY(p_levels))
      AND (p_companies IS NULL OR b.company = ANY(p_companies))
      AND (p_job_titles IS NULL OR b.job_title = ANY(p_job_titles))
      AND (
        p_provinces IS NULL OR p_location_scopes IS NULL
        OR ('country' = ANY(p_location_scopes) AND ('country' = b.location_scope OR ARRAY['country'] && b.listing_location_scopes))
        OR (b.location_province_code = ANY(p_provinces) AND b.location_scope = ANY(p_location_scopes))
        OR (p_provinces && b.listing_location_province_codes AND p_location_scopes && b.listing_location_scopes)
      )
      AND (p_provinces IS NULL OR p_location_scopes IS NOT NULL OR b.location_province_code = ANY(p_provinces) OR p_provinces && b.listing_location_province_codes)
      AND (p_location_scopes IS NULL OR p_provinces IS NOT NULL OR b.location_scope = ANY(p_location_scopes) OR p_location_scopes && b.listing_location_scopes)
      AND (p_exclude_metros IS NULL OR b.location_metro IS NULL OR NOT (b.location_metro = ANY(p_exclude_metros)))
  ), aggregated AS (
    SELECT bucket, max(city_label) AS city_label, count(*)::bigint AS bucket_count,
      max(last_seen_at) AS last_updated
    FROM scoped
    GROUP BY bucket
  ), eligible AS (
    SELECT a.*, p.population_2021, p.geo_match_quality, p.is_cma_component
    FROM aggregated a
    LEFT JOIN public.census_population_2021 p ON p.bucket = a.bucket
    WHERE p_place_view <> 'small_town'
      OR (
        a.bucket LIKE 'c:%'
        AND p.population_2021 BETWEEN 1 AND 99999
        AND NOT p.is_cma_component
        AND p.geo_match_quality IN ('exact', 'parent')
      )
  ), collisions AS (
    SELECT split_part(split_part(e.bucket, '|', 1), ':', 2) AS norm
    FROM eligible e
    WHERE e.bucket LIKE 'c:%'
    GROUP BY 1
    HAVING count(DISTINCT nullif(split_part(e.bucket, '|', 2), '')) > 1
  ), pooled AS (
    SELECT
      CASE
        WHEN e.bucket LIKE 'm:%' THEN 'metro'
        WHEN e.bucket LIKE 'p:%' THEN 'province'
        WHEN e.bucket LIKE 'c:%' THEN 'city'
        ELSE 'scope'
      END AS rate_level,
      coalesce(sum(e.bucket_count)::numeric / nullif(sum(e.population_2021), 0), 0) AS pooled_rate
    FROM eligible e
    WHERE e.population_2021 > 0
      AND e.geo_match_quality IN ('exact', 'parent', 'region')
    GROUP BY 1
  )
  SELECT
    CASE
      WHEN e.bucket LIKE 'm:%' THEN CASE WHEN p_fold_suburbs
        THEN public.metro_folded_display(split_part(e.bucket, ':', 2))
        ELSE public.metro_display(split_part(e.bucket, ':', 2)) END
      WHEN e.bucket LIKE 'p:%' THEN public.province_display(split_part(e.bucket, ':', 2))
      WHEN e.bucket = 's:country' THEN 'Canada-wide'
      WHEN e.bucket LIKE 's:prov:%' THEN public.province_display(split_part(e.bucket, ':', 3)) || '-wide'
      WHEN e.bucket = 's:province' THEN 'Province-wide'
      WHEN e.bucket = 'u' THEN 'Unspecified'
      ELSE e.city_label || CASE WHEN c.norm IS NOT NULL
        THEN ' (' || upper(split_part(e.bucket, '|', 2)) || ')' ELSE '' END
    END AS label,
    e.bucket_count,
    count(*) OVER ()::bigint,
    e.last_updated,
    e.population_2021::bigint,
    CASE WHEN e.population_2021 > 0
      THEN round(e.bucket_count::numeric * 100000 / e.population_2021, 1) END,
    CASE
      WHEN e.population_2021 <= 0 THEN NULL
      WHEN e.bucket NOT LIKE 'c:%' AND e.bucket NOT LIKE 'm:%' AND e.bucket NOT LIKE 'p:%'
        THEN round(e.bucket_count::numeric * 100000 / e.population_2021, 1)
      ELSE round(((e.bucket_count + coalesce(pr.pooled_rate, 0) * 50000) /
        (e.population_2021 + 50000)) * 100000, 1)
    END,
    CASE
      WHEN e.population_2021 <= 0 THEN NULL
      WHEN e.bucket NOT LIKE 'c:%' AND e.bucket NOT LIKE 'm:%' AND e.bucket NOT LIKE 'p:%' THEN 1
      ELSE round(e.population_2021::numeric / (e.population_2021 + 50000), 3)
    END,
    e.geo_match_quality,
    e.is_cma_component
  FROM eligible e
  LEFT JOIN collisions c
    ON c.norm = split_part(split_part(e.bucket, '|', 1), ':', 2)
    AND e.bucket LIKE 'c:%'
  LEFT JOIN pooled pr ON pr.rate_level = CASE
    WHEN e.bucket LIKE 'm:%' THEN 'metro'
    WHEN e.bucket LIKE 'p:%' THEN 'province'
    WHEN e.bucket LIKE 'c:%' THEN 'city'
    ELSE 'scope' END
  ORDER BY e.bucket_count DESC, label ASC;
$$;

REVOKE ALL ON FUNCTION public.get_location_insights(text[],text[],text[],text,text[],text[],text[],text[],text[],text,boolean,text)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_location_insights(text[],text[],text[],text,text[],text[],text[],text[],text[],text,boolean,text)
  TO service_role;

DROP FUNCTION IF EXISTS public.get_location_job_ids(text[],text[],text[],text,text[],text[],text[],text[],text[],text,text,integer,integer);
DROP FUNCTION IF EXISTS public.get_location_job_ids(text[],text[],text[],text,text[],text[],text[],text[],text[],text,boolean,text,integer,integer);
DROP FUNCTION IF EXISTS public.get_location_job_ids(text[],text[],text[],text,text[],text[],text[],text[],text[],text,boolean,text,text,integer,integer);

CREATE FUNCTION public.get_location_job_ids(
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
  p_label text DEFAULT '',
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0
) RETURNS TABLE(job_id text, total_count bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
SET plan_cache_mode = 'force_custom_plan'
AS $$
  WITH target AS MATERIALIZED (
    SELECT public.location_label_bucket(p_label, p_granularity, p_fold_suburbs) AS bucket
  ), bucket_matches AS MATERIALIZED (
    SELECT b.job_id
    FROM target t
    JOIN public.job_location_buckets b
      ON b.province_bucket = t.bucket
      OR (t.bucket LIKE '%|' AND b.province_bucket LIKE t.bucket || '%')
    WHERE p_granularity = 'province'
    UNION ALL
    SELECT b.job_id
    FROM target t
    JOIN public.job_location_buckets b
      ON b.folded_city_bucket = t.bucket
      OR (t.bucket LIKE '%|' AND b.folded_city_bucket LIKE t.bucket || '%')
    WHERE p_granularity <> 'province' AND p_fold_suburbs
    UNION ALL
    SELECT b.job_id
    FROM target t
    JOIN public.job_location_buckets b
      ON b.city_bucket = t.bucket
      OR (t.bucket LIKE '%|' AND b.city_bucket LIKE t.bucket || '%')
    WHERE p_granularity <> 'province' AND NOT p_fold_suburbs
  ), membership_ids AS MATERIALIZED (
    SELECT DISTINCT m.job_id
    FROM public.job_archetype_memberships m
    WHERE p_archetypes IS NOT NULL
      AND m.archetype = ANY(p_archetypes)
      AND (
        p_filter_status = 'all'
        OR (p_filter_status = 'filtered' AND m.is_filtered)
        OR (p_filter_status = 'unfiltered' AND NOT m.is_filtered)
        OR (p_filter_status = 'entry_level' AND m.is_filtered AND m.filter_reason LIKE 'title_entry_level:%')
      )
  ), matching AS (
    SELECT b.job_id, b.effective_posted_at
    FROM bucket_matches bm
    JOIN public.job_location_buckets b ON b.job_id = bm.job_id
    LEFT JOIN membership_ids m ON m.job_id = b.job_id
    WHERE b.is_active
      AND (p_archetypes IS NULL OR m.job_id IS NOT NULL)
      AND (
        p_archetypes IS NOT NULL
        OR p_filter_status IS NULL
        OR p_filter_status = 'all'
        OR (p_filter_status = 'filtered' AND b.is_filtered)
        OR (p_filter_status = 'unfiltered' AND NOT coalesce(b.is_filtered, false))
        OR (p_filter_status = 'entry_level' AND b.is_entry_level_filtered)
      )
      AND (p_providers IS NULL OR b.provider = ANY(p_providers))
      AND (p_levels IS NULL OR b.level = ANY(p_levels))
      AND (p_companies IS NULL OR b.company = ANY(p_companies))
      AND (p_job_titles IS NULL OR b.job_title = ANY(p_job_titles))
      AND (
        p_provinces IS NULL OR p_location_scopes IS NULL
        OR ('country' = ANY(p_location_scopes) AND ('country' = b.location_scope OR ARRAY['country'] && b.listing_location_scopes))
        OR (b.location_province_code = ANY(p_provinces) AND b.location_scope = ANY(p_location_scopes))
        OR (p_provinces && b.listing_location_province_codes AND p_location_scopes && b.listing_location_scopes)
      )
      AND (p_provinces IS NULL OR p_location_scopes IS NOT NULL OR b.location_province_code = ANY(p_provinces) OR p_provinces && b.listing_location_province_codes)
      AND (p_location_scopes IS NULL OR p_provinces IS NOT NULL OR b.location_scope = ANY(p_location_scopes) OR p_location_scopes && b.listing_location_scopes)
      AND (p_exclude_metros IS NULL OR b.location_metro IS NULL OR NOT (b.location_metro = ANY(p_exclude_metros)))
  ), ranked AS (
    SELECT m.*, count(*) OVER ()::bigint AS total_count,
      row_number() OVER (ORDER BY m.effective_posted_at DESC NULLS LAST, m.job_id) AS ordinal
    FROM matching m
  ), page AS (
    SELECT * FROM ranked
    WHERE ordinal > greatest(p_offset, 0)
      AND ordinal <= greatest(p_offset, 0) + least(greatest(p_limit, 0), 100)
  ), meta AS (
    SELECT count(*)::bigint AS total_count FROM matching
  )
  SELECT result.job_id, result.total_count
  FROM (
    SELECT p.job_id, p.total_count, p.ordinal FROM page p
    UNION ALL
    SELECT NULL::text, m.total_count, NULL::bigint FROM meta m
    WHERE NOT EXISTS (SELECT 1 FROM page)
  ) result
  ORDER BY result.ordinal NULLS LAST;
$$;

REVOKE ALL ON FUNCTION public.get_location_job_ids(text[],text[],text[],text,text[],text[],text[],text[],text[],text,boolean,text,text,integer,integer)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_location_job_ids(text[],text[],text[],text,text[],text[],text[],text[],text[],text,boolean,text,text,integer,integer)
  TO service_role;

ANALYZE public.job_location_buckets;
ANALYZE public.job_archetype_memberships;
