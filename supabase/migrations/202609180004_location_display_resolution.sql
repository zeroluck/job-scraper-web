-- Resolve every job location to a display-ready bucket.
--
-- Problem: the stored metro codes cover only 15 metros, so suburbs
-- (Brossard, Kanata, ...), standalone cities (Lévis, Sherbrooke, ...),
-- metro-area names ("Greater Sudbury") and scope-wide listings
-- ("Canada", "Ontario, Canada") all collapsed into "Unspecified".
--
-- Resolution (per job row, deterministic, filter-independent):
--   city view:     country scope -> "Canada-wide"
--                  province scope -> "<Province>-wide" (or "Province-wide")
--                  stored metro -> metro label
--                  suburb alias -> parent metro label (folds into larger city)
--                  otherwise -> own city name ("any city name" works)
--                  unparseable -> "Unspecified"
--   province view: stored/province-text code -> province name
--                  country scope -> "Canada-wide", province scope ->
--                  "<Province>-wide"/"Province-wide", else "Unspecified"
-- Same-province collisions ("Windsor" in ON/QC/NS) all get "(PR)" suffixes
-- so buckets never merge across provinces. Drill-down matches on the same
-- display text, so cloud and list can never disagree. Replaces the
-- code-based 0002/0003 functions (dropped below).

CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.normalize_place_name(raw text) RETURNS text
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT nullif(regexp_replace(regexp_replace(lower(extensions.unaccent(coalesce(raw, ''))), '[.''’‘`]', '', 'g'), '[^a-z0-9]+', '', 'g'), '')
$$;

CREATE OR REPLACE FUNCTION public.place_city_segment(location text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT btrim(regexp_replace(regexp_replace(
    split_part(split_part(coalesce(location, ''), ';', 1), ',', 1),
    '^(greater|city of)\s+', '', 'i'),
    '\s+(metropolitan area|metro area|metropolitan|metro)$', '', 'i'))
$$;

CREATE OR REPLACE FUNCTION public.parse_province_code(location text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN t ~ '\yontario\y' THEN 'ON'
    WHEN t ~ '\yquebec\y' THEN 'QC'
    WHEN t ~ '\ybritish columbia\y' THEN 'BC'
    WHEN t ~ '\yalberta\y' THEN 'AB'
    WHEN t ~ '\ymanitoba\y' THEN 'MB'
    WHEN t ~ '\ysaskatchewan\y' THEN 'SK'
    WHEN t ~ '\ynova scotia\y' THEN 'NS'
    WHEN t ~ '\ynew brunswick\y' THEN 'NB'
    WHEN t ~ '\ynewfoundland and labrador\y' OR t ~ '\ynewfoundland\y' THEN 'NL'
    WHEN t ~ '\yprince edward island\y' THEN 'PE'
    WHEN t ~ '\ynorthwest territories\y' THEN 'NT'
    WHEN t ~ '\yyukon\y' THEN 'YT'
    WHEN t ~ '\ynunavut\y' THEN 'NU'
    WHEN t ~ '\mon\M' THEN 'ON'
    WHEN t ~ '\mqc\M' THEN 'QC'
    WHEN t ~ '\mbc\M' THEN 'BC'
    WHEN t ~ '\mab\M' THEN 'AB'
    WHEN t ~ '\mmb\M' THEN 'MB'
    WHEN t ~ '\msk\M' THEN 'SK'
    WHEN t ~ '\mns\M' THEN 'NS'
    WHEN t ~ '\mnb\M' THEN 'NB'
    WHEN t ~ '\mnl\M' THEN 'NL'
    WHEN t ~ '\mpe\M' THEN 'PE'
    WHEN t ~ '\mnt\M' THEN 'NT'
    WHEN t ~ '\myt\M' THEN 'YT'
    WHEN t ~ '\mnu\M' THEN 'NU'
  END FROM (SELECT lower(extensions.unaccent(coalesce(location, ''))) AS t) s
$$;

CREATE TABLE IF NOT EXISTS public.metro_aliases (
  place_norm text NOT NULL,
  prov text NOT NULL,
  metro text NOT NULL,
  PRIMARY KEY (place_norm, prov)
);
GRANT SELECT ON public.metro_aliases TO service_role;

-- Suburb / satellite -> parent metro, province-scoped. Normalized keys must
-- match public.normalize_place_name output exactly.
INSERT INTO public.metro_aliases (place_norm, prov, metro) VALUES
  ('brossard', 'QC', 'montreal'), ('sainteannedebellevue', 'QC', 'montreal'),
  ('montroyal', 'QC', 'montreal'), ('pointeclaire', 'QC', 'montreal'),
  ('mirabel', 'QC', 'montreal'), ('boucherville', 'QC', 'montreal'),
  ('varennes', 'QC', 'montreal'), ('candiac', 'QC', 'montreal'),
  ('valleyfield', 'QC', 'montreal'), ('montsthilaire', 'QC', 'montreal'),
  ('sainthubert', 'QC', 'montreal'), ('sthubert', 'QC', 'montreal'),
  ('kirkland', 'QC', 'montreal'), ('boisbriand', 'QC', 'montreal'),
  ('saintbruno', 'QC', 'montreal'), ('stbrunodemontarville', 'QC', 'montreal'),
  ('stjeansurrichelieu', 'QC', 'montreal'),
  ('dollarddesormeaux', 'QC', 'montreal'), ('repentigny', 'QC', 'montreal'),
  ('terrebonne', 'QC', 'montreal'), ('sthyacinthe', 'QC', 'montreal'),
  ('blainville', 'QC', 'montreal'), ('chambly', 'QC', 'montreal'),
  ('saintetherese', 'QC', 'montreal'), ('vaudreuildorion', 'QC', 'montreal'),
  ('westmount', 'QC', 'montreal'), ('saintejulie', 'QC', 'montreal'),
  ('laprairie', 'QC', 'montreal'), ('baiedurfe', 'QC', 'montreal'),
  ('pickering', 'ON', 'toronto'), ('woodbridge', 'ON', 'toronto'),
  ('bolton', 'ON', 'toronto'), ('concord', 'ON', 'toronto'),
  ('newmarket', 'ON', 'toronto'), ('aurora', 'ON', 'toronto'),
  ('eastyork', 'ON', 'toronto'), ('whitby', 'ON', 'toronto'),
  ('ajax', 'ON', 'toronto'), ('milton', 'ON', 'toronto'),
  ('georgetown', 'ON', 'toronto'), ('bowmanville', 'ON', 'toronto'),
  ('oshawa', 'ON', 'toronto'), ('whitchurchstouffville', 'ON', 'toronto'),
  ('kanata', 'ON', 'ottawa_gatineau'), ('nepean', 'ON', 'ottawa_gatineau'),
  ('sainteustache', 'QC', 'montreal'),
  ('nisku', 'AB', 'edmonton'), ('sherwoodpark', 'AB', 'edmonton'),
  ('fortsaskatchewan', 'AB', 'edmonton'), ('leduc', 'AB', 'edmonton'),
  ('acheson', 'AB', 'edmonton'),
  ('airdrie', 'AB', 'calgary'), ('highriver', 'AB', 'calgary'),
  ('cochrane', 'AB', 'calgary'),
  ('dundas', 'ON', 'hamilton'), ('ancaster', 'ON', 'hamilton'),
  ('stoneycreek', 'ON', 'hamilton'), ('waterdown', 'ON', 'hamilton'),
  ('langley', 'BC', 'vancouver'), ('pittmeadows', 'BC', 'vancouver'),
  ('esquimalt', 'BC', 'victoria'),
  ('bedford', 'NS', 'halifax'),
  ('saintaugustindedesmaures', 'QC', 'quebec_city'),
  -- Province-less metro-area names fold into their obvious metro.
  ('london', '', 'london')
ON CONFLICT (place_norm, prov) DO UPDATE SET metro = EXCLUDED.metro;

-- Province hints for city names that carry no province in their location
-- text (e.g. "Greater St. John's Metropolitan Area"). Consulted only when
-- the stored code and text parsing both come up empty.
CREATE TABLE IF NOT EXISTS public.place_province_hints (
  place_norm text PRIMARY KEY,
  prov text NOT NULL
);
GRANT SELECT ON public.place_province_hints TO service_role;
INSERT INTO public.place_province_hints (place_norm, prov) VALUES
  ('stjohns', 'NL'), ('troisrivieres', 'QC'), ('windsor', 'ON'),
  ('london', 'ON'), ('kelowna', 'BC')
ON CONFLICT (place_norm) DO UPDATE SET prov = EXCLUDED.prov;

CREATE OR REPLACE FUNCTION public.metro_display(code text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE lower(coalesce(code, ''))
    WHEN 'toronto' THEN 'Toronto' WHEN 'montreal' THEN 'Montreal'
    WHEN 'vancouver' THEN 'Vancouver' WHEN 'calgary' THEN 'Calgary'
    WHEN 'edmonton' THEN 'Edmonton' WHEN 'ottawa_gatineau' THEN 'Ottawa-Gatineau'
    WHEN 'winnipeg' THEN 'Winnipeg' WHEN 'quebec_city' THEN 'Quebec City'
    WHEN 'hamilton' THEN 'Hamilton' WHEN 'kitchener_waterloo' THEN 'Kitchener-Waterloo'
    WHEN 'london' THEN 'London' WHEN 'halifax' THEN 'Halifax'
    WHEN 'victoria' THEN 'Victoria' WHEN 'regina' THEN 'Regina'
    WHEN 'saskatoon' THEN 'Saskatoon'
  END
$$;

CREATE OR REPLACE FUNCTION public.metro_code_for_label(label text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE btrim(coalesce(label, ''))
    WHEN 'Toronto' THEN 'toronto' WHEN 'Montreal' THEN 'montreal'
    WHEN 'Vancouver' THEN 'vancouver' WHEN 'Calgary' THEN 'calgary'
    WHEN 'Edmonton' THEN 'edmonton' WHEN 'Ottawa-Gatineau' THEN 'ottawa_gatineau'
    WHEN 'Winnipeg' THEN 'winnipeg' WHEN 'Quebec City' THEN 'quebec_city'
    WHEN 'Hamilton' THEN 'hamilton' WHEN 'Kitchener-Waterloo' THEN 'kitchener_waterloo'
    WHEN 'London' THEN 'london' WHEN 'Halifax' THEN 'halifax'
    WHEN 'Victoria' THEN 'victoria' WHEN 'Regina' THEN 'regina'
    WHEN 'Saskatoon' THEN 'saskatoon'
  END
$$;

CREATE OR REPLACE FUNCTION public.province_display(code text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE upper(coalesce(code, ''))
    WHEN 'ON' THEN 'Ontario' WHEN 'QC' THEN 'Quebec'
    WHEN 'BC' THEN 'British Columbia' WHEN 'AB' THEN 'Alberta'
    WHEN 'MB' THEN 'Manitoba' WHEN 'SK' THEN 'Saskatchewan'
    WHEN 'NS' THEN 'Nova Scotia' WHEN 'NB' THEN 'New Brunswick'
    WHEN 'NL' THEN 'Newfoundland and Labrador' WHEN 'PE' THEN 'Prince Edward Island'
    WHEN 'NT' THEN 'Northwest Territories' WHEN 'YT' THEN 'Yukon'
    WHEN 'NU' THEN 'Nunavut'
  END
$$;

CREATE OR REPLACE FUNCTION public.province_code_for_name(name text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE btrim(coalesce(name, ''))
    WHEN 'Ontario' THEN 'ON' WHEN 'Quebec' THEN 'QC'
    WHEN 'British Columbia' THEN 'BC' WHEN 'Alberta' THEN 'AB'
    WHEN 'Manitoba' THEN 'MB' WHEN 'Saskatchewan' THEN 'SK'
    WHEN 'Nova Scotia' THEN 'NS' WHEN 'New Brunswick' THEN 'NB'
    WHEN 'Newfoundland and Labrador' THEN 'NL' WHEN 'Prince Edward Island' THEN 'PE'
    WHEN 'Northwest Territories' THEN 'NT' WHEN 'Yukon' THEN 'YT'
    WHEN 'Nunavut' THEN 'NU'
  END
$$;

-- Stable identity for one job row. Scope buckets, metros, alias-folded
-- suburbs, standalone cities ('c:<norm>|<PROV>'), or 'u' when unresolvable.
CREATE OR REPLACE FUNCTION public.location_bucket(
  location text, metro text, scope text, prov text, granularity text
) RETURNS text
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN granularity = 'province' THEN
      CASE WHEN prov IS NOT NULL AND btrim(prov) <> '' THEN 'p:' || lower(btrim(prov))
        WHEN scope = 'country' THEN 's:country'
        WHEN scope = 'province' THEN COALESCE('s:prov:' || lower(public.parse_province_code(location)), 's:province')
        ELSE COALESCE('p:' || lower(public.parse_province_code(location)),
          (SELECT 'p:' || lower(h.prov) FROM public.place_province_hints h
            WHERE h.place_norm = public.normalize_place_name(public.place_city_segment(location))),
          'u') END
    ELSE
      CASE WHEN scope = 'country' THEN 's:country'
        WHEN scope = 'province' THEN COALESCE('s:prov:' || lower(public.parse_province_code(location)), 's:province')
        WHEN metro IS NOT NULL AND btrim(metro) <> '' THEN 'm:' || lower(btrim(metro))
        WHEN public.parse_province_code(
          public.place_city_segment(location) || ', Canada') IS NOT NULL
          THEN 's:prov:' || lower(public.parse_province_code(
            public.place_city_segment(location) || ', Canada'))
        ELSE (
          SELECT CASE WHEN n IS NULL THEN 'u'
            ELSE COALESCE(
              (SELECT 'm:' || a.metro FROM public.metro_aliases a
                WHERE a.place_norm = n AND (a.prov = pe OR a.prov = '')
                ORDER BY (a.prov = pe) DESC LIMIT 1),
              'c:' || n || '|' || COALESCE(lower(pe), '')) END
          FROM (SELECT public.normalize_place_name(public.place_city_segment(location)) AS n,
            COALESCE(NULLIF(btrim(prov), ''),
              public.parse_province_code(location),
              (SELECT h.prov FROM public.place_province_hints h
                WHERE h.place_norm = public.normalize_place_name(public.place_city_segment(location)))) AS pe) s)
      END
  END
$$;

-- Inverse: a clicked/displayed label back to a bucket. Bare city labels
-- carry no province ('c:<norm>|'); the drill-down predicate treats those
-- as prefix matches. Everything else resolves exactly.
CREATE OR REPLACE FUNCTION public.location_label_bucket(label text, granularity text) RETURNS text
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
    WHEN btrim(coalesce(label, '')) ~* '^(.+)-wide$' THEN
      COALESCE('s:prov:' || lower(public.province_code_for_name(regexp_replace(btrim(label), '-wide$', '', 'i'))), 's:province')
    ELSE 'c:' || COALESCE(public.normalize_place_name(btrim(label)), '') || '|'
  END
$$;

DROP FUNCTION IF EXISTS public.get_location_insights(text[],text[],text[],text,text[],text[],text[],text[],text[],text);
DROP FUNCTION IF EXISTS public.get_location_job_ids(text[],text[],text[],text,text[],text[],text[],text[],text[],text,text,text,integer,integer);

create function public.get_location_insights(
  p_providers text[] default null, p_archetypes text[] default null, p_levels text[] default null,
  p_filter_status text default null, p_companies text[] default null, p_job_titles text[] default null,
  p_provinces text[] default null, p_location_scopes text[] default null, p_exclude_metros text[] default null,
  p_granularity text default 'city'
) returns table(label text, count bigint, total_count bigint, last_updated timestamp with time zone)
language sql stable security invoker set search_path = '' as $$
  with scoped as (
    select j.job_id, j.last_seen_at,
      public.location_bucket(j.location, j.location_metro, j.location_scope, j.location_province_code, p_granularity) as bucket,
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
    case when a.bucket like 'm:%' then public.metro_display(split_part(a.bucket, ':', 2))
      when a.bucket like 'p:%' then public.province_display(split_part(a.bucket, ':', 2))
      when a.bucket = 's:country' then 'Canada-wide'
      when a.bucket like 's:prov:%' then public.province_display(split_part(a.bucket, ':', 3)) || '-wide'
      when a.bucket = 's:province' then 'Province-wide'
      when a.bucket = 'u' then 'Unspecified'
      else a.seg || case when c.norm is not null then ' (' || upper(split_part(a.bucket, '|', 2)) || ')' else '' end
    end as label,
    a.bucket_count as count, (select count(*)::bigint from aggregated) as total_count, a.last_updated
  from aggregated a
  left join collisions c on c.norm = split_part(split_part(a.bucket, '|', 1), ':', 2) and a.bucket like 'c:%'
  order by a.bucket_count desc, label asc;
$$;

revoke all on function public.get_location_insights(text[],text[],text[],text,text[],text[],text[],text[],text[],text) from public, anon, authenticated;
grant execute on function public.get_location_insights(text[],text[],text[],text,text[],text[],text[],text[],text[],text) to service_role;

create function public.get_location_job_ids(
  p_providers text[] default null, p_archetypes text[] default null, p_levels text[] default null,
  p_filter_status text default null, p_companies text[] default null, p_job_titles text[] default null,
  p_provinces text[] default null, p_location_scopes text[] default null, p_exclude_metros text[] default null,
  p_granularity text default 'city', p_label text default '',
  p_limit integer default 25, p_offset integer default 0
) returns table(job_id text, total_count bigint)
language sql stable security invoker set search_path = '' as $$
  with matching as (
    select distinct j.job_id, j.effective_posted_at
    from public.jobs j
    where j.is_active is true
      and (select lb from (select public.location_label_bucket(p_label, p_granularity) as lb) s) is not null
      and (public.location_bucket(j.location, j.location_metro, j.location_scope, j.location_province_code, p_granularity)
        = public.location_label_bucket(p_label, p_granularity)
        or (public.location_label_bucket(p_label, p_granularity) like '%|'
          and public.location_bucket(j.location, j.location_metro, j.location_scope, j.location_province_code, p_granularity)
            like public.location_label_bucket(p_label, p_granularity) || '%'))
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

revoke all on function public.get_location_job_ids(text[],text[],text[],text,text[],text[],text[],text[],text[],text,text,integer,integer) from public, anon, authenticated;
grant execute on function public.get_location_job_ids(text[],text[],text[],text,text[],text[],text[],text[],text,text,integer,integer) to service_role;
