-- SQL-language functions cache a generic plan for optional filters. Replan
-- these two bounded statements per request so null filters and selected
-- bucket modes are eliminated before execution.

CREATE OR REPLACE FUNCTION public.get_location_insights(
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
    ), scoped AS (
      SELECT b.job_id, b.last_seen_at, b.city_label,
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
    ), aggregated AS (
      SELECT s.bucket, max(s.city_label) AS city_label,
        count(*)::bigint AS bucket_count, max(s.last_seen_at) AS last_updated
      FROM scoped s
      GROUP BY s.bucket
    ), eligible AS (
      SELECT a.*, p.population_2021, p.geo_match_quality, p.is_cma_component
      FROM aggregated a
      LEFT JOIN public.census_population_2021 p ON p.bucket = a.bucket
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
    SELECT
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
      e.geo_match_quality, e.is_cma_component
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
    p_granularity, p_fold_suburbs, p_place_view;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_location_job_ids(
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
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY EXECUTE $query$
    WITH target AS MATERIALIZED (
      SELECT public.location_label_bucket($13, $10, $11) AS bucket
    ), bucket_matches AS MATERIALIZED (
      SELECT b.job_id
      FROM target t
      JOIN public.job_location_buckets b
        ON b.province_bucket = t.bucket
        OR (t.bucket LIKE '%|' AND b.province_bucket LIKE t.bucket || '%')
      WHERE $10 = 'province'
      UNION ALL
      SELECT b.job_id
      FROM target t
      JOIN public.job_location_buckets b
        ON b.folded_city_bucket = t.bucket
        OR (t.bucket LIKE '%|' AND b.folded_city_bucket LIKE t.bucket || '%')
      WHERE $10 <> 'province' AND $11
      UNION ALL
      SELECT b.job_id
      FROM target t
      JOIN public.job_location_buckets b
        ON b.city_bucket = t.bucket
        OR (t.bucket LIKE '%|' AND b.city_bucket LIKE t.bucket || '%')
      WHERE $10 <> 'province' AND NOT $11
    ), membership_ids AS MATERIALIZED (
      SELECT DISTINCT m.job_id
      FROM public.job_archetype_memberships m
      WHERE $2 IS NOT NULL AND m.archetype = ANY($2)
        AND ($4 = 'all'
          OR ($4 = 'filtered' AND m.is_filtered)
          OR ($4 = 'unfiltered' AND NOT m.is_filtered)
          OR ($4 = 'entry_level' AND m.is_filtered AND m.filter_reason LIKE 'title_entry_level:%'))
    ), matching AS (
      SELECT b.job_id, b.effective_posted_at
      FROM bucket_matches bm
      JOIN public.job_location_buckets b ON b.job_id = bm.job_id
      LEFT JOIN membership_ids m ON m.job_id = b.job_id
      WHERE b.is_active AND ($2 IS NULL OR m.job_id IS NOT NULL)
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
    ), ranked AS (
      SELECT m.*, count(*) OVER ()::bigint AS result_count,
        row_number() OVER (ORDER BY m.effective_posted_at DESC NULLS LAST, m.job_id) AS ordinal
      FROM matching m
    ), page AS (
      SELECT * FROM ranked
      WHERE ordinal > greatest($15, 0)
        AND ordinal <= greatest($15, 0) + least(greatest($14, 0), 100)
    ), meta AS (
      SELECT count(*)::bigint AS result_count FROM matching
    )
    SELECT result.result_job_id, result.result_count
    FROM (
      SELECT p.job_id AS result_job_id, p.result_count, p.ordinal FROM page p
      UNION ALL
      SELECT NULL::text, m.result_count, NULL::bigint FROM meta m
      WHERE NOT EXISTS (SELECT 1 FROM page)
    ) result
    ORDER BY result.ordinal NULLS LAST
  $query$ USING
    p_providers, p_archetypes, p_levels, p_filter_status, p_companies,
    p_job_titles, p_provinces, p_location_scopes, p_exclude_metros,
    p_granularity, p_fold_suburbs, p_place_view, p_label, p_limit, p_offset;
END;
$$;
