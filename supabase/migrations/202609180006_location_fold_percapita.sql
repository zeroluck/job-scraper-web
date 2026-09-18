-- Location buckets, revision 2: unfold suburbs by default, fix province
-- Unspecified leak, and expose census populations for per-capita rates.
--
-- 1. Province view no longer strands metro-only rows ("Greater Calgary
--    Metropolitan Area", "Greater Ottawa Metropolitan Area", ...) under
--    Unspecified. Those rows carry a stored metro code but no province
--    code and no parseable province text, so the old bucket fell through
--    to 'u'. The province branch now consults metro_province(metro)
--    before giving up. Stored prov still wins; Ottawa-Gatineau falls back
--    to ON (the Ontario part holds ~3x the Quebec part's population).
--
-- 2. Suburb folding is now opt-in. location_bucket takes fold_suburbs
--    (default false): unfolded, suburbs and satellites resolve to their own
--    city bucket -- including places the classifier stamped with a metro
--    code (Mississauga, Laval, Burnaby, ...) unless the segment names the
--    metro core itself (public.metro_is_core). Folded, they merge into the
--    parent metro bucket, which then renders as "Greater <Metro>" to
--    distinguish it from the core city ("Toronto" vs "Greater Toronto").
--    The cloud and drill-down both thread the same flag, so they can never
--    disagree. location_label_bucket accepts both plain and Greater labels
--    in either mode, so bookmarked labels keep resolving.
--
-- 3. get_location_insights returns population_2021 (from the pruned
--    census_population_2021 table, seeded in 0007) and per_100k
--    (jobs per 100k residents, 1 decimal) for every bucket. Buckets with
--    no denominator (Unspecified, Province-wide, unmatched hamlets) yield
--    NULL and the UI falls back to raw counts.

CREATE OR REPLACE FUNCTION public.metro_province(code text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE lower(coalesce(code, ''))
    WHEN 'toronto' THEN 'on' WHEN 'montreal' THEN 'qc'
    WHEN 'vancouver' THEN 'bc' WHEN 'calgary' THEN 'ab'
    WHEN 'edmonton' THEN 'ab' WHEN 'ottawa_gatineau' THEN 'on'
    WHEN 'winnipeg' THEN 'mb' WHEN 'quebec_city' THEN 'qc'
    WHEN 'hamilton' THEN 'on' WHEN 'kitchener_waterloo' THEN 'on'
    WHEN 'london' THEN 'on' WHEN 'halifax' THEN 'ns'
    WHEN 'victoria' THEN 'bc' WHEN 'regina' THEN 'sk'
    WHEN 'saskatoon' THEN 'sk'
  END
$$;

CREATE OR REPLACE FUNCTION public.metro_folded_display(code text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE lower(coalesce(code, ''))
    WHEN 'toronto' THEN 'Greater Toronto' WHEN 'montreal' THEN 'Greater Montreal'
    WHEN 'vancouver' THEN 'Greater Vancouver' WHEN 'calgary' THEN 'Greater Calgary'
    WHEN 'edmonton' THEN 'Greater Edmonton' WHEN 'ottawa_gatineau' THEN 'Greater Ottawa-Gatineau'
    WHEN 'winnipeg' THEN 'Greater Winnipeg' WHEN 'quebec_city' THEN 'Greater Quebec City'
    WHEN 'hamilton' THEN 'Greater Hamilton' WHEN 'kitchener_waterloo' THEN 'Greater Kitchener-Waterloo'
    WHEN 'london' THEN 'Greater London' WHEN 'halifax' THEN 'Greater Halifax'
    WHEN 'victoria' THEN 'Greater Victoria' WHEN 'regina' THEN 'Greater Regina'
    WHEN 'saskatoon' THEN 'Greater Saskatoon'
  END
$$;

CREATE OR REPLACE FUNCTION public.metro_folded_code_for_label(label text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE btrim(coalesce(label, ''))
    WHEN 'Greater Toronto' THEN 'toronto' WHEN 'Greater Montreal' THEN 'montreal'
    WHEN 'Greater Vancouver' THEN 'vancouver' WHEN 'Greater Calgary' THEN 'calgary'
    WHEN 'Greater Edmonton' THEN 'edmonton' WHEN 'Greater Ottawa-Gatineau' THEN 'ottawa_gatineau'
    WHEN 'Greater Winnipeg' THEN 'winnipeg' WHEN 'Greater Quebec City' THEN 'quebec_city'
    WHEN 'Greater Hamilton' THEN 'hamilton' WHEN 'Greater Kitchener-Waterloo' THEN 'kitchener_waterloo'
    WHEN 'Greater London' THEN 'london' WHEN 'Greater Halifax' THEN 'halifax'
    WHEN 'Greater Victoria' THEN 'victoria' WHEN 'Greater Regina' THEN 'regina'
    WHEN 'Greater Saskatoon' THEN 'saskatoon'
  END
$$;

DROP FUNCTION IF EXISTS public.location_bucket(text, text, text, text, text);

-- True when a normalized city segment names the core of its stored metro
-- (or names a metro area outright). Unfolded city view keeps core rows on
-- the metro bucket and breaks every other named place out to its own
-- city, even when the classifier stamped it with a metro code
-- (Mississauga -> Toronto, Laval -> Montreal, ...).
CREATE OR REPLACE FUNCTION public.metro_is_core(metro text, seg_norm text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE lower(coalesce(metro, ''))
    WHEN 'toronto' THEN seg_norm IN ('toronto')
    WHEN 'montreal' THEN seg_norm IN ('montreal')
    WHEN 'vancouver' THEN seg_norm IN ('vancouver')
    WHEN 'calgary' THEN seg_norm IN ('calgary')
    WHEN 'edmonton' THEN seg_norm IN ('edmonton')
    WHEN 'ottawa_gatineau' THEN seg_norm IN ('ottawa', 'gatineau')
    WHEN 'winnipeg' THEN seg_norm IN ('winnipeg')
    WHEN 'quebec_city' THEN seg_norm IN ('quebec', 'quebeccity')
    WHEN 'hamilton' THEN seg_norm IN ('hamilton')
    WHEN 'kitchener_waterloo' THEN seg_norm IN ('kitchener', 'waterloo', 'cambridge', 'kitchenercambridgewaterloo')
    WHEN 'london' THEN seg_norm IN ('london')
    WHEN 'halifax' THEN seg_norm IN ('halifax')
    WHEN 'victoria' THEN seg_norm IN ('victoria')
    WHEN 'regina' THEN seg_norm IN ('regina')
    WHEN 'saskatoon' THEN seg_norm IN ('saskatoon')
  END
  OR seg_norm LIKE '%area%' OR seg_norm LIKE '%metro%' OR seg_norm LIKE '%greater%'
$$;

-- Gatineau is the Quebec half of the Ottawa-Gatineau metro but the
-- classifier leaves its metro code null; without an alias it would stand
-- alone even in folded mode.
INSERT INTO public.metro_aliases (place_norm, prov, metro) VALUES
  ('gatineau', 'QC', 'ottawa_gatineau')
ON CONFLICT (place_norm, prov) DO UPDATE SET metro = EXCLUDED.metro;

-- Stable identity for one job row. fold_suburbs=false (default) keeps
-- every suburb/satellite as its own city; true folds alias suburbs into
-- the parent metro bucket (rendered "Greater <Metro>").
CREATE FUNCTION public.location_bucket(
  location text, metro text, scope text, prov text, granularity text,
  fold_suburbs boolean default false
) RETURNS text
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN granularity = 'province' THEN
      CASE WHEN prov IS NOT NULL AND btrim(prov) <> '' THEN 'p:' || lower(btrim(prov))
        WHEN public.metro_province(metro) IS NOT NULL THEN 'p:' || public.metro_province(metro)
        WHEN scope = 'country' THEN 's:country'
        WHEN scope = 'province' THEN COALESCE('s:prov:' || lower(public.parse_province_code(location)), 's:province')
        ELSE COALESCE('p:' || lower(public.parse_province_code(location)),
          (SELECT 'p:' || lower(a.prov) FROM public.metro_aliases a
            WHERE a.place_norm = public.normalize_place_name(public.place_city_segment(location))
              AND a.prov <> ''
            LIMIT 1),
          (SELECT 'p:' || lower(h.prov) FROM public.place_province_hints h
            WHERE h.place_norm = public.normalize_place_name(public.place_city_segment(location))),
          'u') END
    ELSE
      CASE WHEN scope = 'country' THEN 's:country'
        WHEN scope = 'province' THEN COALESCE('s:prov:' || lower(public.parse_province_code(location)), 's:province')
        ELSE (
          SELECT CASE WHEN n IS NULL THEN 'u'
            WHEN public.parse_province_code(seg0 || ', Canada') IS NOT NULL
              THEN 's:prov:' || lower(public.parse_province_code(seg0 || ', Canada'))
            WHEN metro IS NOT NULL AND btrim(metro) <> ''
              AND (fold_suburbs OR public.metro_is_core(metro, n)) THEN 'm:' || lower(btrim(metro))
            WHEN fold_suburbs THEN COALESCE(
              (SELECT 'm:' || a.metro FROM public.metro_aliases a
                WHERE a.place_norm = n AND (a.prov = pe OR a.prov = '')
                ORDER BY (a.prov = pe) DESC LIMIT 1),
              'c:' || n || '|' || COALESCE(lower(pe), ''))
            ELSE 'c:' || n || '|' || COALESCE(lower(pe), '') END
          FROM (SELECT public.normalize_place_name(public.place_city_segment(location)) AS n,
            public.place_city_segment(location) AS seg0,
            COALESCE(NULLIF(btrim(prov), ''),
              public.parse_province_code(location),
              (SELECT h.prov FROM public.place_province_hints h
                WHERE h.place_norm = public.normalize_place_name(public.place_city_segment(location)))) AS pe) s)
      END
  END
$$;

DROP FUNCTION IF EXISTS public.location_label_bucket(text, text);

-- Inverse: a clicked/displayed label back to a bucket. Plain ("Toronto")
-- and folded ("Greater Toronto") metro labels both resolve to the metro
-- bucket in either mode, so bookmarks survive the toggle. Bare city
-- labels carry no province ('c:<norm>|') and match as prefixes.
CREATE FUNCTION public.location_label_bucket(label text, granularity text, fold_suburbs boolean default false) RETURNS text
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN btrim(coalesce(label, '')) = 'Canada-wide' THEN 's:country'
    WHEN btrim(coalesce(label, '')) = 'Unspecified' THEN 'u'
    WHEN btrim(coalesce(label, '')) ~ '^.+ \([A-Z]{2}\)$' THEN
      'c:' || COALESCE(public.normalize_place_name(regexp_replace(btrim(label), ' \([A-Z]{2}\)$', '')), '')
        || '|' || lower(substring(btrim(label) from '\(([A-Z]{2})\)$'))
    WHEN granularity = 'province' AND public.province_code_for_name(btrim(label)) IS NOT NULL
      THEN 'p:' || lower(public.province_code_for_name(btrim(label)))
    WHEN granularity <> 'province' AND public.metro_code_for_label(btrim(label)) IS NOT NULL
      THEN 'm:' || public.metro_code_for_label(btrim(label))
    WHEN granularity <> 'province' AND public.metro_folded_code_for_label(btrim(label)) IS NOT NULL
      THEN 'm:' || public.metro_folded_code_for_label(btrim(label))
    WHEN btrim(coalesce(label, '')) ~* '^(.+)-wide$' THEN
      COALESCE('s:prov:' || lower(public.province_code_for_name(regexp_replace(btrim(label), '-wide$', '', 'i'))), 's:province')
    ELSE 'c:' || COALESCE(public.normalize_place_name(btrim(label)), '') || '|'
  END
$$;

-- Pruned 2021 Census population denominators, one row per location
-- bucket that can occur (seeded in 0007 from tables 98-10-0005-01 for
-- CMAs/provinces and 98-10-0002-01 for municipalities). Buckets with no
-- row (Unspecified, Province-wide, unmatched fragments) yield NULL
-- population and the UI falls back to raw counts.
CREATE TABLE IF NOT EXISTS public.census_population_2021 (
  bucket text PRIMARY KEY,
  level text NOT NULL,
  display_name text NOT NULL,
  population_2021 integer NOT NULL,
  dguid text,
  source_table text NOT NULL,
  note text
);
ALTER TABLE public.census_population_2021 ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.census_population_2021 TO service_role;

DROP FUNCTION IF EXISTS public.get_location_insights(text[],text[],text[],text,text[],text[],text[],text[],text[],text);
DROP FUNCTION IF EXISTS public.get_location_job_ids(text[],text[],text[],text,text[],text[],text[],text[],text[],text,text,text,integer,integer);

create function public.get_location_insights(
  p_providers text[] default null, p_archetypes text[] default null, p_levels text[] default null,
  p_filter_status text default null, p_companies text[] default null, p_job_titles text[] default null,
  p_provinces text[] default null, p_location_scopes text[] default null, p_exclude_metros text[] default null,
  p_granularity text default 'city', p_fold_suburbs boolean default false
) returns table(label text, count bigint, total_count bigint, last_updated timestamp with time zone, population_2021 bigint, per_100k numeric)
language sql stable security invoker set search_path = '' as $$
  with scoped as (
    select j.job_id, j.last_seen_at,
      public.location_bucket(j.location, j.location_metro, j.location_scope, j.location_province_code, p_granularity, p_fold_suburbs) as bucket,
      public.place_city_segment(j.location) as seg
    from public.jobs j
    where j.is_active is true
      and (p_providers is null or j.provider = any(p_providers))
      and (p_archetypes is null or exists (
        select 1 from public.job_archetype_memberships m
        where m.job_id = j.job_id
          and m.archetype = any(p_archetypes)
          and (p_filter_status = 'all'
            or (p_filter_status = 'filtered' and m.is_filtered is true)
            or (p_filter_status = 'unfiltered' and m.is_filtered is false)
            or (p_filter_status = 'entry_level' and m.is_filtered is true
              and m.filter_reason like 'title_entry_level:%'))))
      and (p_archetypes is not null or p_filter_status is null or p_filter_status = 'all'
        or (p_filter_status = 'filtered' and j.is_filtered is true)
        or (p_filter_status = 'unfiltered' and coalesce(j.is_filtered,false) is false)
        or (p_filter_status = 'entry_level' and j.is_entry_level_filtered is true))
      and (p_levels is null or j.level = any(p_levels)) and (p_companies is null or j.company = any(p_companies))
      and (p_job_titles is null or j.job_title = any(p_job_titles))
      and (p_provinces is null or p_location_scopes is null or ('country' = any(p_location_scopes) and ('country' = j.location_scope or array['country'] && j.listing_location_scopes)) or (j.location_province_code = any(p_provinces) and j.location_scope = any(p_location_scopes)) or (p_provinces && j.listing_location_province_codes and p_location_scopes && j.listing_location_scopes))
      and (p_provinces is null or p_location_scopes is not null or j.location_province_code = any(p_provinces) or p_provinces && j.listing_location_province_codes)
      and (p_location_scopes is null or p_provinces is not null or j.location_scope = any(p_location_scopes) or p_location_scopes && j.listing_location_scopes)
      and (p_exclude_metros is null or j.location_metro is null or not (j.location_metro = any(p_exclude_metros)))
  ), aggregated as (
    select s.bucket, max(s.seg) as seg, count(*)::bigint as bucket_count, max(s.last_seen_at) as last_updated
    from scoped s
    group by s.bucket
  ), collisions as (
    -- Only non-empty provinces collide; a province-less twin never forces
    -- a suffix on its own.
    select distinct split_part(split_part(a.bucket, '|', 1), ':', 2) as norm
    from aggregated a
    where a.bucket like 'c:%'
    group by 1
    having count(distinct nullif(split_part(a.bucket, '|', 2), '')) > 1
  )
  select
    case when a.bucket like 'm:%' then (case when p_fold_suburbs then public.metro_folded_display(split_part(a.bucket, ':', 2)) else public.metro_display(split_part(a.bucket, ':', 2)) end)
      when a.bucket like 'p:%' then public.province_display(split_part(a.bucket, ':', 2))
      when a.bucket = 's:country' then 'Canada-wide'
      when a.bucket like 's:prov:%' then public.province_display(split_part(a.bucket, ':', 3)) || '-wide'
      when a.bucket = 's:province' then 'Province-wide'
      when a.bucket = 'u' then 'Unspecified'
      else a.seg || case when c.norm is not null then ' (' || upper(split_part(a.bucket, '|', 2)) || ')' else '' end
    end as label,
    a.bucket_count as count, (select count(*)::bigint from aggregated) as total_count, a.last_updated,
    pop.population_2021,
    case when pop.population_2021 is not null and pop.population_2021 > 0
      then round(a.bucket_count::numeric * 100000 / pop.population_2021, 1) end as per_100k
  from aggregated a
  left join collisions c on c.norm = split_part(split_part(a.bucket, '|', 1), ':', 2) and a.bucket like 'c:%'
  left join public.census_population_2021 pop on pop.bucket = a.bucket
  order by a.bucket_count desc, label asc;
$$;

revoke all on function public.get_location_insights(text[],text[],text[],text,text[],text[],text[],text[],text[],text,boolean) from public, anon, authenticated;
grant execute on function public.get_location_insights(text[],text[],text[],text,text[],text[],text[],text[],text[],text,boolean) to service_role;

create function public.get_location_job_ids(
  p_providers text[] default null, p_archetypes text[] default null, p_levels text[] default null,
  p_filter_status text default null, p_companies text[] default null, p_job_titles text[] default null,
  p_provinces text[] default null, p_location_scopes text[] default null, p_exclude_metros text[] default null,
  p_granularity text default 'city', p_fold_suburbs boolean default false, p_label text default '',
  p_limit integer default 25, p_offset integer default 0
) returns table(job_id text, total_count bigint)
language sql stable security invoker set search_path = '' as $$
  with matching as (
    select distinct j.job_id, j.effective_posted_at
    from public.jobs j
    where j.is_active is true
      and (select lb from (select public.location_label_bucket(p_label, p_granularity, p_fold_suburbs) as lb) s) is not null
      and (public.location_bucket(j.location, j.location_metro, j.location_scope, j.location_province_code, p_granularity, p_fold_suburbs)
        = public.location_label_bucket(p_label, p_granularity, p_fold_suburbs)
        or (public.location_label_bucket(p_label, p_granularity, p_fold_suburbs) like '%|'
          and public.location_bucket(j.location, j.location_metro, j.location_scope, j.location_province_code, p_granularity, p_fold_suburbs)
            like public.location_label_bucket(p_label, p_granularity, p_fold_suburbs) || '%'))
      and (p_providers is null or j.provider = any(p_providers))
      and (p_archetypes is null or exists (
        select 1 from public.job_archetype_memberships m
        where m.job_id = j.job_id
          and m.archetype = any(p_archetypes)
          and (p_filter_status = 'all'
            or (p_filter_status = 'filtered' and m.is_filtered is true)
            or (p_filter_status = 'unfiltered' and m.is_filtered is false)
            or (p_filter_status = 'entry_level' and m.is_filtered is true
              and m.filter_reason like 'title_entry_level:%'))))
      and (p_archetypes is not null or p_filter_status is null or p_filter_status = 'all'
        or (p_filter_status = 'filtered' and j.is_filtered is true)
        or (p_filter_status = 'unfiltered' and coalesce(j.is_filtered,false) is false)
        or (p_filter_status = 'entry_level' and j.is_entry_level_filtered is true))
      and (p_levels is null or j.level = any(p_levels)) and (p_companies is null or j.company = any(p_companies))
      and (p_job_titles is null or j.job_title = any(p_job_titles))
      and (p_provinces is null or p_location_scopes is null or ('country' = any(p_location_scopes) and ('country' = j.location_scope or array['country'] && j.listing_location_scopes)) or (j.location_province_code = any(p_provinces) and j.location_scope = any(p_location_scopes)) or (p_provinces && j.listing_location_province_codes and p_location_scopes && j.listing_location_scopes))
      and (p_provinces is null or p_location_scopes is not null or j.location_province_code = any(p_provinces) or p_provinces && j.listing_location_province_codes)
      and (p_location_scopes is null or p_provinces is not null or j.location_scope = any(p_location_scopes) or p_location_scopes && j.listing_location_scopes)
      and (p_exclude_metros is null or j.location_metro is null or not (j.location_metro = any(p_exclude_metros)))
  ), ranked as (
    select m.*, count(*) over()::bigint total_count,
      row_number() over (order by m.effective_posted_at desc nulls last, m.job_id asc) ordinal
    from matching m
  ), page as (
    select r.job_id, r.total_count, r.ordinal from ranked r
    where r.ordinal > greatest(p_offset,0)
      and r.ordinal <= greatest(p_offset,0) + least(greatest(p_limit,0),100)
  ), metadata as (
    select count(*)::bigint total_count from matching
  )
  select result.job_id, result.total_count from (
    select p.job_id, p.total_count, p.ordinal from page p
    union all
    select null::text, m.total_count, null::bigint from metadata m
    where not exists (select 1 from page)
  ) result
  order by result.ordinal nulls last;
$$;

revoke all on function public.get_location_job_ids(text[],text[],text[],text,text[],text[],text[],text[],text[],text,boolean,text,integer,integer) from public, anon, authenticated;
grant execute on function public.get_location_job_ids(text[],text[],text[],text,text[],text[],text[],text[],text[],text,boolean,text,integer,integer) to service_role;
