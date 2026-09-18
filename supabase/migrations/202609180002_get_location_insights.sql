-- Location aggregate for the segregated Locations insights tab.
--
-- Groups active jobs by metro code (p_granularity = 'city') or province
-- code (p_granularity = 'province'). Reads only public.jobs plus the
-- lane-membership overlay, so location buckets can never leak into the
-- keyword tabs (which read public.job_keyword_insights) and vice versa.
-- Filter predicates mirror get_filtered_keyword_insights; membership rows
-- are canonical, so a plain ANY match on the client-canonicalized
-- archetype array is complete (no legacy-alias CASE needed).

create or replace function public.get_location_insights(
  p_providers text[] default null, p_archetypes text[] default null, p_levels text[] default null,
  p_filter_status text default null, p_companies text[] default null, p_job_titles text[] default null,
  p_provinces text[] default null, p_location_scopes text[] default null, p_exclude_metros text[] default null,
  p_granularity text default 'city'
) returns table(code text, count bigint, total_count bigint, last_updated timestamp with time zone)
language sql stable security invoker set search_path = '' as $$
  with scoped as (
    select j.job_id,
      case when p_granularity = 'province'
        then j.location_province_code else j.location_metro end as loc_code,
      j.last_seen_at
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
    select s.loc_code, count(*)::bigint as loc_count, max(s.last_seen_at) as last_updated
    from scoped s
    group by s.loc_code
  ), ranked as (
    select a.*, count(*) over()::bigint total_count from aggregated a
  )
  select r.loc_code as code, r.loc_count as count, r.total_count, r.last_updated from ranked r
  order by r.loc_count desc, r.loc_code asc nulls last;
$$;

revoke all on function public.get_location_insights(text[],text[],text[],text,text[],text[],text[],text[],text[],text) from public, anon, authenticated;
grant execute on function public.get_location_insights(text[],text[],text[],text,text[],text[],text[],text[],text[],text) to service_role;
