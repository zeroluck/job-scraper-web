-- Treat keyword casing as presentation, not identity. Historical and future
-- rows are folded at read time, while the most common stored spelling remains
-- the display label. Aggregate and drill-down use the same identity rule.

create index if not exists idx_job_keyword_insights_keyword_key_category_job
  on public.job_keyword_insights (lower(btrim(keyword)), category, job_id);

create index if not exists idx_keyword_insights_keyword_key_category_label
  on public.keyword_insights (lower(btrim(keyword)), category, keyword)
  include (count);

create or replace function public.get_filtered_keyword_insights(
  p_providers text[] default null, p_archetypes text[] default null, p_levels text[] default null,
  p_filter_status text default null, p_companies text[] default null, p_job_titles text[] default null,
  p_provinces text[] default null, p_location_scopes text[] default null, p_exclude_metros text[] default null,
  p_category text default null, p_min_count integer default 2, p_limit integer default 1000, p_offset integer default 0
) returns table(keyword text, category text, count bigint, total_count bigint, last_updated timestamptz)
language sql stable security invoker set search_path = '' as $$
  with aggregated as (
    select lower(btrim(jki.keyword)) as keyword_key,
      min(btrim(jki.keyword)) as fallback_keyword, jki.category,
      count(distinct jki.job_id)::bigint as insight_count,
      max(jki.analyzed_at) as last_updated
    from public.job_keyword_insights jki join public.jobs j on j.job_id = jki.job_id
    where j.is_active is true
      and btrim(jki.keyword) <> ''
      and (p_providers is null or j.provider = any(p_providers))
      and (p_archetypes is null or (jki.archetype = any(p_archetypes) and exists (
        select 1 from public.job_archetype_memberships m
        where m.job_id = j.job_id
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
    group by lower(btrim(jki.keyword)), jki.category
    having count(distinct jki.job_id) >= greatest(p_min_count,0)
  ), ranked as (
    select a.*, count(*) over()::bigint total_count from aggregated a
  ), page as (
    select r.* from ranked r
    order by r.insight_count desc, r.keyword_key asc
    limit greatest(p_limit,0) offset greatest(p_offset,0)
  ), label_counts as (
    select p.keyword_key, ki.category, btrim(ki.keyword) as keyword,
      sum(ki.count)::bigint as label_count
    from public.keyword_insights ki
    join page p
      on p.keyword_key = lower(btrim(ki.keyword))
      and p.category = ki.category
    group by p.keyword_key, ki.category, btrim(ki.keyword)
  ), display_labels as (
    select distinct on (lc.keyword_key, lc.category)
      lc.keyword_key, lc.category, lc.keyword
    from label_counts lc
    order by lc.keyword_key, lc.category, lc.label_count desc, lc.keyword asc
  )
  select coalesce(dl.keyword, p.fallback_keyword) as keyword,
    p.category, p.insight_count as count, p.total_count, p.last_updated
  from page p
    left join display_labels dl
      on dl.keyword_key = p.keyword_key and dl.category = p.category
  order by p.insight_count desc, keyword asc;
$$;

revoke all on function public.get_filtered_keyword_insights(text[],text[],text[],text,text[],text[],text[],text[],text[],text,integer,integer,integer) from public, anon, authenticated;
grant execute on function public.get_filtered_keyword_insights(text[],text[],text[],text,text[],text[],text[],text[],text[],text,integer,integer,integer) to service_role;
alter function public.get_filtered_keyword_insights(text[],text[],text[],text,text[],text[],text[],text[],text[],text,integer,integer,integer) set work_mem = '256MB';
alter function public.get_filtered_keyword_insights(text[],text[],text[],text,text[],text[],text[],text[],text[],text,integer,integer,integer) set plan_cache_mode = force_custom_plan;

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
      and p_keyword is not null
      and lower(btrim(jki.keyword)) = lower(btrim(p_keyword))
      and (p_category is null or jki.category = p_category)
      and (p_providers is null or j.provider = any(p_providers))
      and (p_archetypes is null or (jki.archetype = any(p_archetypes) and exists (
        select 1 from public.job_archetype_memberships m
        where m.job_id = j.job_id
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

revoke all on function public.get_keyword_job_ids(text[],text[],text[],text,text[],text[],text[],text[],text[],text,text,integer,integer) from public, anon, authenticated;
grant execute on function public.get_keyword_job_ids(text[],text[],text[],text,text[],text[],text[],text[],text[],text,text,integer,integer) to service_role;
