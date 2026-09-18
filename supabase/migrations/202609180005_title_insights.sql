-- Job-title aggregate and drill-down for the segregated Titles tab.
--
-- Groups active jobs by normalized title (lower + trim), displaying the
-- most frequent original spelling. Reads only public.jobs plus the
-- lane-membership overlay, so titles never leak into the keyword or
-- location tabs and vice versa. Drill-down matches on the same
-- normalization, so cloud and list can never disagree.

create or replace function public.get_title_insights(
  p_providers text[] default null, p_archetypes text[] default null, p_levels text[] default null,
  p_filter_status text default null, p_companies text[] default null, p_job_titles text[] default null,
  p_provinces text[] default null, p_location_scopes text[] default null, p_exclude_metros text[] default null,
  p_min_count integer default 2, p_limit integer default 250, p_offset integer default 0
) returns table(label text, count bigint, total_count bigint, last_updated timestamp with time zone)
language sql stable security invoker set search_path = '' as $$
  with scoped as (
    select j.job_id, j.job_title, j.last_seen_at,
      lower(btrim(j.job_title)) as norm
    from public.jobs j
    where j.is_active is true
      and j.job_title is not null and btrim(j.job_title) <> ''
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
  ), grouped as (
    select s.norm, s.job_title as display, count(*)::bigint as c,
      max(s.last_seen_at) as lu
    from scoped s
    group by s.norm, s.job_title
  ), ranked as (
    -- One pass over the spellings: most frequent original wins the label.
    -- A self-join here planned pathologically (50s) under generic params;
    -- window functions keep every plan shape in the hundreds of ms.
    select g.norm, g.display,
      sum(g.c) over (partition by g.norm)::bigint as total,
      row_number() over (partition by g.norm order by g.c desc, g.display asc) as rn,
      max(g.lu) over (partition by g.norm) as norm_lu
    from grouped g
  ), aggregated as (
    select r.display as label, r.total as title_count, r.norm_lu as last_updated
    from ranked r
    where r.rn = 1 and r.total >= greatest(p_min_count, 0)
  ), totals as (
    select a.*, count(*) over()::bigint total_count from aggregated a
  )
  select t.label, t.count, t.total_count, t.last_updated from totals t
  order by t.count desc, t.label asc
  limit greatest(p_limit,0) offset greatest(p_offset,0);
$$;

revoke all on function public.get_title_insights(text[],text[],text[],text,text[],text[],text[],text[],text[],integer,integer,integer) from public, anon, authenticated;
grant execute on function public.get_title_insights(text[],text[],text[],text,text[],text[],text[],text[],text[],integer,integer,integer) to service_role;

-- Planner-proofing: the lane-membership semi-join planned pathologically
-- (50s nested rescans) under generic params with multi-lane arrays.
-- Custom plans see real values (planning cost is ms; calls are hour-cached)
-- and nested loops never win on 11k-row analytics scans.
alter function public.get_title_insights(text[],text[],text[],text,text[],text[],text[],text[],text[],integer,integer,integer) set plan_cache_mode = force_custom_plan;
alter function public.get_title_insights(text[],text[],text[],text,text[],text[],text[],text[],text[],integer,integer,integer) set enable_nestloop = off;

create or replace function public.get_title_job_ids(
  p_providers text[] default null, p_archetypes text[] default null, p_levels text[] default null,
  p_filter_status text default null, p_companies text[] default null, p_job_titles text[] default null,
  p_provinces text[] default null, p_location_scopes text[] default null, p_exclude_metros text[] default null,
  p_title text default '',
  p_limit integer default 25, p_offset integer default 0
) returns table(job_id text, total_count bigint)
language sql stable security invoker set search_path = '' as $$
  with matching as (
    select distinct j.job_id, j.effective_posted_at
    from public.jobs j
    where j.is_active is true
      and j.job_title is not null
      and lower(btrim(j.job_title)) = lower(btrim(p_title))
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

revoke all on function public.get_title_job_ids(text[],text[],text[],text,text[],text[],text[],text[],text[],text,integer,integer) from public, anon, authenticated;
grant execute on function public.get_title_job_ids(text[],text[],text[],text,text[],text[],text[],text[],text[],text,integer,integer) to service_role;
