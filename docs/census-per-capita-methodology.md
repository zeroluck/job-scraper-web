# Census per-capita methodology (2021; redo for 2026)

The Locations tab offers jobs-per-100k-residents normalization. Denominators
live in `public.census_population_2021`, keyed by location bucket
(`m:toronto`, `p:on`, `c:mississauga|on`, `s:country`, `s:prov:qc`, ...).
`get_location_insights` LEFT JOINs it and returns `population_2021` plus
`per_100k` (jobs × 100000 / population, 1 decimal). Buckets with no row get
NULL and the UI falls back to raw counts. This doc records exactly how the
seed was built so it can be redone when 2026 Census data is released.

## 1. Download

StatCan table downloads (CSV zips). For 2026, find the successor tables on
the Census Profile download portal / open.canada.ca dataset pages:

- CMAs + provinces: **98-10-0005-01** "Population and dwelling counts:
  Canada, provinces and territories, census metropolitan areas and census
  agglomerations"
  `https://www150.statcan.gc.ca/n1/tbl/csv/98100005-eng.zip`
- Municipalities: **98-10-0002-01** "Population and dwelling counts: Canada
  and census subdivisions (municipalities)"
  `https://www150.statcan.gc.ca/n1/tbl/csv/98100002-eng.zip`

Both zips contain `<table>.csv` (data) + `<table>_MetaData.csv` (ignore).

## 2. Prune

From each CSV keep only: `GEO`, `DGUID`, and the **2021 population** column
(`Population and dwelling counts (13): Population, 2021 [1]`). Discard all
dwelling counts, land area, density, ranks, and % change columns, and every
geography that is not needed below. The 2021 seed kept 490 of ~5,600 rows.

## 3. Buckets that need a denominator

Dump distinct buckets over active jobs (both fold modes; folded adds no new
city buckets, it only merges into metros):

```sql
-- city buckets (unfolded; this is the list to match)
select distinct public.location_bucket(
    location, location_metro, location_scope, location_province_code,
    'city', false) as bucket,
  max(public.place_city_segment(location)) as seg
from public.jobs where is_active
group by location, location_metro, location_scope, location_province_code;
-- province buckets: p:<code> for every province with jobs (derive from
-- metro_province() for metro-only rows), plus s:country and s:prov:<code>.
```

## 4. Match rules (in priority order)

1. `m:<metro>` → the CMA row with that name (city proper is WRONG here;
   folded suburbs + core share the CMA denominator).
2. `p:<xx>` / `s:prov:<xx>` → the province row; `s:country` → Canada.
3. `c:<norm>|<prov>` → the CSD (municipality) row whose normalized name
   matches `<norm>` **in that province**. DGUID decodes the province:
   after the `2021A0005` (CSD) / `2021A0003` (CD) prefix the next two
   digits are the PR code (10 NL … 35 ON … 59 BC … 62 NU). Prefer
   CSD-level rows, then the longest DGUID, then the largest population.
4. Amalgamated boroughs / constituent communities map to the parent
   municipality and carry a `note`: East York/North York/Etobicoke/
   Scarborough → Toronto; Kanata/Nepean → Ottawa; Dartmouth/Cole
   Harbour/Lower Sackville/Bedford(NS) → Halifax; Saint-Laurent →
   Montréal; Saint-Hubert → Longueuil; Ancaster/Dundas/Stoney Creek/
   Waterdown → Hamilton; Fort McMurray → Wood Buffalo; Chicoutimi →
   Saguenay; Lively → Greater Sudbury; Alliston → New Tecumseth; Bolton →
   Caledon; Bowmanville → Clarington; Georgetown → Halton Hills; Chatham
   → Chatham-Kent; Lindsay → Kawartha Lakes; Napanee → Greater Napanee;
   Sydney → Cape Breton; Nisku → Leduc County; Sherwood Park → Strathcona
   County; Concord/Maple/Woodbridge → Vaughan; Elmira/Breslau → Woolwich.
5. `St-` job spellings map to StatCan `Saint-` names (St-Hyacinthe →
   Saint-Hyacinthe, etc.); Mont-St-Hilaire → Mont-Saint-Hilaire;
   Valleyfield → Salaberry-de-Valleyfield; Strathroy → Strathroy-Caradoc.
6. Cross-province artifacts (`c:brampton|bc`, `c:montreal|on`, ...) map to
   the largest CSD sharing the normalized name, with a note.
7. Leave seedless (NULL → raw counts): foreign scopes, reserves/RCMs/
   regions with no usable CSD, and buckets whose only namesake is a tiny
   place in another province (Bath ON, Gladstone MB, Trenton ON,
   Waterville NS, Windsor NS, St. Paul NB, ...). A wrong small denominator
   is worse than none.

Watch for traps found in 2021: `Sudbury` alone is the surrounding district
(22k) — the city is `Greater Sudbury / Grand Sudbury` (166k); `Québec`
province vs city; `St-Georges QC` vs `St. George's NL`; York Region vs the
former City of York; `Niagara` = the Region; Langley Township vs City;
North Vancouver District vs City.

## 5. Load and verify

Write the seed as `supabase/migrations/<date>_census_population_seed.sql`
(one `INSERT`, columns `bucket, level, display_name, population_2021,
dguid, source_table, note`; see `202609180007` for the exact shape) and
apply it. Then verify:

```sql
-- every matchable bucket has a denominator; orphans show typos
with b as (select distinct public.location_bucket(
    location, location_metro, location_scope, location_province_code,
    'city', false) as bucket from public.jobs where is_active)
select b.bucket from b left join public.census_population_2021 p
  on p.bucket = b.bucket where p.bucket is null order by 1;
-- spot-check known values, e.g. Toronto CMA 6202225, Mississauga 717961
select * from public.census_population_2021 where bucket in
  ('m:toronto','c:mississauga|on','p:on','s:country');
-- per-100k sanity on the live RPC
select label, count, population_2021, per_100k
from public.get_location_insights(
  null,null,null,null,null,null,null,null,null,'city',false)
order by count desc limit 15;
```

Aggregate checksums (city level) for the 2021 seed: 448 rows,
SUM(population_2021) = 62702732, SUM(length(bucket)) = 6618.
