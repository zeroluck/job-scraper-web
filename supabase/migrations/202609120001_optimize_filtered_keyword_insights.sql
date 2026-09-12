-- Normalize the keyword-insight membership correlation to a sargable equality.
--
-- Membership rows use canonical archetypes only (the sole alias is
-- software_tpm -> technology_delivery), so matching
--   m.archetype = CASE WHEN jki.archetype = 'software_tpm'
--                  THEN 'technology_delivery' ELSE jki.archetype END
-- is semantically identical to the previous three-branch OR, but lets
-- PostgreSQL hash on (job_id, archetype) instead of filtering 43k+ rows
-- after a job_id-only semi-join. Measured 3450ms -> ~585ms on the
-- default all-lanes/unfiltered shape (limit 250).
--
-- No signature, grant, filter-status, geography, or min-count change.

create or replace function public.get_filtered_keyword_insights(
  p_providers text[] default null, p_archetypes text[] default null, p_levels text[] default null,
  p_filter_status text default null, p_companies text[] default null, p_job_titles text[] default null,
  p_provinces text[] default null, p_location_scopes text[] default null, p_exclude_metros text[] default null,
  p_category text default null, p_min_count integer default 2, p_limit integer default 1000, p_offset integer default 0
) returns table(keyword text, category text, count bigint, total_count bigint, last_updated timestamptz)
language sql stable security invoker set search_path = '' as $$
  with aggregated as (
    select jki.keyword, jki.category, count(distinct jki.job_id)::bigint as insight_count, max(jki.analyzed_at) last_updated
    from public.job_keyword_insights jki join public.jobs j on j.job_id = jki.job_id
    where j.is_active is true
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
      and (p_job_titles is null or j.job_title = any(p_job_titles)) and (p_category is null or jki.category = p_category)
      and (p_provinces is null or p_location_scopes is null or ('country' = any(p_location_scopes) and ('country' = j.location_scope or array['country'] && j.listing_location_scopes)) or (j.location_province_code = any(p_provinces) and j.location_scope = any(p_location_scopes)) or (p_provinces && j.listing_location_province_codes and p_location_scopes && j.listing_location_scopes))
      and (p_provinces is null or p_location_scopes is not null or j.location_province_code = any(p_provinces) or p_provinces && j.listing_location_province_codes)
      and (p_location_scopes is null or p_provinces is not null or j.location_scope = any(p_location_scopes) or p_location_scopes && j.listing_location_scopes)
      and (p_exclude_metros is null or j.location_metro is null or not (j.location_metro = any(p_exclude_metros)))
    group by jki.keyword, jki.category having count(distinct jki.job_id) >= greatest(p_min_count,0)
  ), ranked as (
    select a.*, count(*) over()::bigint total_count from aggregated a
  )
  select r.keyword, r.category, r.insight_count as count, r.total_count, r.last_updated from ranked r
  order by r.insight_count desc, r.keyword asc limit greatest(p_limit,0) offset greatest(p_offset,0);
$$;

revoke all on function public.get_filtered_keyword_insights(text[],text[],text[],text,text[],text[],text[],text[],text[],text,integer,integer,integer) from public, anon, authenticated;
grant execute on function public.get_filtered_keyword_insights(text[],text[],text[],text,text[],text[],text[],text[],text[],text,integer,integer,integer) to service_role;
