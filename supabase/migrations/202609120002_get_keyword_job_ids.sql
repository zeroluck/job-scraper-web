-- Paginated job_ids for a single keyword-insight drill-down.
--
-- Reuses the exact membership, filter-status, geography, provider, level,
-- company, and title predicates of get_filtered_keyword_insights (see
-- 202609120001_optimize_filtered_keyword_insights.sql), plus an equality
-- predicate on jki.keyword (and optionally jki.category). Jobs are ordered
-- by most recently posted first so the drill-down list is deterministic.
--
-- New function only; no change to the existing keyword-insights aggregate.

create or replace function public.get_keyword_job_ids(
  p_providers text[] default null, p_archetypes text[] default null, p_levels text[] default null,
  p_filter_status text default null, p_companies text[] default null, p_job_titles text[] default null,
  p_provinces text[] default null, p_location_scopes text[] default null, p_exclude_metros text[] default null,
  p_category text default null, p_keyword text default null,
  p_limit integer default 25, p_offset integer default 0
) returns table(job_id text, total_count bigint)
language sql stable security invoker set search_path = '' as $$
  with matching as (
    select distinct j.job_id, j.effective_posted_at
    from public.job_keyword_insights jki join public.jobs j on j.job_id = jki.job_id
    where j.is_active is true
      and (p_keyword is null or jki.keyword = p_keyword)
      and (p_category is null or jki.category = p_category)
      and (p_providers is null or j.provider = any(p_providers))
      and (p_archetypes is null or (jki.archetype = any(p_archetypes) and exists (
        select 1 from public.job_archetype_memberships m
        where m.job_id = j.job_id
          -- Memberships are canonical; jki rows may use the legacy
          -- software_tpm alias. Normalize instead of a 3-branch OR so the
          -- semi-join can hash on (job_id, archetype).
          and m.archetype = case when jki.archetype = 'software_tpm' then 'technology_delivery' else jki.archetype end
          and (p_filter_status = 'all'
            or (p_filter_status = 'filtered' and m.is_filtered is true)
            or (p_filter_status = 'unfiltered' and m.is_filtered is false)
            or (p_filter_status = 'entry_level' and m.is_filtered is true
              and m.filter_reason like 'title_entry_level:%')))))
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
    select m.*, count(*) over()::bigint total_count from matching m
  )
  select r.job_id, r.total_count from ranked r
  order by r.effective_posted_at desc nulls last, r.job_id asc
  limit greatest(p_limit,0) offset greatest(p_offset,0);
$$;

revoke all on function public.get_keyword_job_ids(text[],text[],text[],text,text[],text[],text[],text[],text[],text,text,integer,integer) from public, anon, authenticated;
grant execute on function public.get_keyword_job_ids(text[],text[],text[],text,text[],text[],text[],text[],text[],text,text,integer,integer) to service_role;
