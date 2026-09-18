# Location Rate Stabilization, Small-Town View, and Timeout Remediation Plan

**Goal:** Make location per-capita insights statistically useful, add a direct old-vs-new rate comparison toggle, add a Canada-aware small-town view that excludes communities nested in large metros, and eliminate intermittent `57014 | canceling statement due to statement timeout` failures on location drill-downs.

**Success:** Raw per-capita results remain available and numerically unchanged; stabilized results no longer let one-job/tiny-denominator buckets dominate; Small town excludes CMA-nested communities such as Dorval and Mississauga while retaining legitimate standalone communities; Moosonee/Invermay drill-downs complete reliably; bucket and drill-down counts stay equal; focused tests, typecheck, lint, and build pass.

## Starting Point

- Base commit: `b202e0d` (`feat: unfold suburbs by default, metro/province per-capita locations`).
- Current location modes:
  - City vs State / Province via `loc=city|province`.
  - Optional city folding via `fold=greater`.
  - Raw per-capita display via `percap=true`, using `count / population_2021 * 100000`.
- Current census table: `public.census_population_2021`, seeded from Statistics Canada 2021 tables `98-10-0002-01` and `98-10-0005-01`.
- Current RPCs: `public.get_location_insights(...)` and `public.get_location_job_ids(...)` repeatedly evaluate `public.location_bucket(...)` over `public.jobs`; small-bucket drill-downs intermittently hit Postgres statement timeout.
- Current verification baseline: 153/157 tests pass; four unrelated failures predate this work (`repost count helper`, two RELQ/markdown tests, and `job keyword insights select...`). `npm run typecheck`, `npm run lint`, and `npm run build` pass.
- Preserve unrelated dirty work in `src/app/api/config/route.ts`, `src/lib/config/lanAccess.test.ts`, `.superpowers/`, `docs/superpowers/screenshots/`, and `supabase/.temp/`. Do not stage, revert, or clean it.
- Remote migration history contains the already-applied 0006/0007 work plus MCP-applied delta/split migrations. Inspect `supabase_list_migrations` before choosing new migration names. Do not reapply 0006/0007.

## Decisions Already Made

### Rate controls and backward compatibility

- Keep the existing `Per 100k residents` toggle.
- When per-capita is active, show a two-state comparison control:
  - **Observed (old):** current unadjusted `count / population * 100000`.
  - **Stabilized (new):** empirical-Bayes/credibility-adjusted rate.
- URL contract:
  - Counts: no `percap` parameter.
  - Legacy observed rate: `percap=true&rate=raw`.
  - New stabilized rate: `percap=true&rate=stabilized`.
  - Existing links with `percap=true` and no `rate` must continue to mean **Observed (old)**.
  - Clicking Per 100k from the off state should select **Stabilized (new)** by writing both `percap=true` and `rate=stabilized`.
- The old/new rate switch is display-only. The RPC returns raw count, observed rate, and stabilized rate together, so switching must not refetch or clear drill-down selection.
- Word size, ordering, and Top 20 values follow the selected rate. Tooltips/list rows show raw job count, population, observed rate, stabilized rate, and a low-evidence/reliability cue.

### Stabilization model

- Use a Gamma-Poisson empirical-Bayes model expressed as credibility weighting:

  ```text
  observed_rate = jobs / population
  stabilized_rate = (jobs + pooled_rate * prior_population)
                    / (population + prior_population)
  reliability = population / (population + prior_population)
  ```

- Fit `prior_population` from actual bucket data; do not hardcode the research agent's speculative `alpha=0.5, beta=200` values.
- Derive `pooled_rate` from the current filtered aggregate for each exchangeable geography level, with a stored training mean as fallback when the current result has too few eligible buckets. This prevents a technology/company filter from being shrunk toward the all-jobs rate.
- Fit/store separate models for `city`, `metro`, and `province`; country/scope buckets use observed rate as stabilized rate because they are not exchangeable with cities. Small town uses the city model.
- Keep one-job remote communities. Do **not** impose a default `count >= 3` exclusion: the user's requirement is that one job in a remote town remains signal but does not dominate. Heavy shrinkage plus a visible low-evidence label handles it. Reconsider a count floor only after inspecting the fitted output and documenting the tradeoff.
- Do not winsorize, cap rates, or use a population floor as the primary correction. Those hide information rather than model uncertainty.

### Canadian nested-vs-standalone rule

- Use Statistics Canada CMA/CA membership, not `location_metro` or `metro_aliases`, as the analytical nesting definition.
- Source: `98-10-0003-01`, download:

  ```text
  https://www150.statcan.gc.ca/n1/tbl/csv/98100003-eng.zip
  ```

- Verified file shape: the CSV is hierarchical. A parent row has DGUID `2021S0503...` (CMA) or `2021S0504...` (CA); following `2021A0005...` rows are member CSDs until the next parent row. The file does not contain an explicit parent column, so the importer must track the latest parent row.
- Classification:
  - Member of a `2021S0503...` parent: `cma`, nested in a large metro, excluded from Small town.
  - Member of a `2021S0504...` parent: `ca`, retained in Small town.
  - CSD absent from table 0003: `outside_cma_ca`, retained in Small town.
- Small-town semantics:
  - `level = 'city'` only.
  - Has a valid population denominator.
  - Not a CMA component.
  - Population below 100,000 (keeps the view aligned with the “small town” label; document and test this threshold).
  - Geography match quality is `exact` or `parent`; exclude `cross_province`, `region`, `foreign`, and `unknown` matches.
  - No minimum job-count floor; stabilized ranking controls one-job extremes.
  - Exclude metro, province, country, province-wide, and Unspecified buckets.
- The existing Greater metro toggle remains a display/bucketing choice. Small town is an analytical geography filter. They must not reuse each other's heuristic.
- Expected examples:
  - Excluded: Dorval, Mississauga, Markham, Burnaby, Laval, North York, Kanata, and other CSDs/boroughs whose denominator belongs to a CMA.
  - Included when population/quality conditions pass: Moosonee, Invermay, and valid CA/outside-CMA communities.
  - Own CMA cores such as Barrie/Oshawa are excluded because they are CMA components; CA cores remain eligible.

### Small-town control

- Add a city-only **Small town** toggle, URL parameter `town=small`.
- Clicking it must set `loc=city`, `percap=true`, and `rate=stabilized`; it clears `keyword` because the bucket set changes.
- While Small town is active, the user can switch **Stabilized (new)** ↔ **Observed (old)** to compare the same standalone-place set.
- Switching to province view removes `town` and `fold`. The per-capita/rate choice may remain.
- Do not show Small town on keyword/title tabs or province view.

## Phase 0: Baseline and Diagnosis

### Task 0.1: Capture the timeout before changing SQL

**Tools:** Supabase MCP logs/advisors first, then read-only SQL/`EXPLAIN (ANALYZE, BUFFERS, VERBOSE)`.

- [ ] Read Postgres logs around recent `57014` events and identify the exact function/query fingerprints and timeout setting.
- [ ] Read Supabase performance and security advisors. Report existing unrelated RLS advisories; do not silently remediate unrelated tables.
- [ ] Reproduce Moosonee and Invermay drill-down RPCs with the same archetype/filter arguments emitted by `/insights`, not all-null synthetic arguments.
- [ ] Record cold/warm timings and plans for:
  - `get_location_insights(..., 'city', false)`.
  - `get_location_job_ids(..., 'city', false, 'Moosonee', ...)`.
  - `get_location_job_ids(..., 'city', false, 'Invermay', ...)`.
  - A high-count control (`Toronto`) and a folded control (`Greater Toronto`).
- [ ] Confirm whether repeated `location_bucket(...)` evaluation, membership filtering, DISTINCT/sort, or RLS dominates. Do not assume the diagnosis.

**Acceptance:** The plan/timing output identifies a measurable bottleneck and provides a before-change baseline. If the bottleneck is not bucket evaluation, revise Phase 1 before implementing it.

## Phase 1: Eliminate Location RPC Timeouts

### Task 1.1: Materialize reusable job location buckets

**Likely files:**

- Add a new migration after 0007, name chosen after inspecting remote history.
- Update `src/lib/supabase/getLocationJobsMigration.test.ts` or add a focused migration test.

- [ ] Create `public.job_location_buckets` keyed by `job_id` with:
  - `city_bucket` (unfolded).
  - `folded_city_bucket`.
  - `province_bucket`.
  - `resolved_at`.
- [ ] Add foreign key/cascade only after verifying `jobs.job_id` constraints and update behavior.
- [ ] Enable RLS on the new table and grant only the access required by `service_role` RPC calls.
- [ ] Backfill all jobs by calling `location_bucket` once per mode.
- [ ] Add indexes on each bucket column, plus any composite/index needed by the measured query plan.
- [ ] Add a trigger on inserts and updates of `location`, `location_metro`, `location_scope`, and `location_province_code` to upsert the three buckets.
- [ ] Add a documented refresh function for the rare case that `metro_aliases`, `place_province_hints`, or bucket logic changes; call it in migrations that alter those mappings.
- [ ] Keep bucket logic in one canonical function; the cache table is derived state, not an independent classification implementation.

### Task 1.2: Rewrite both location RPCs around the bucket cache

- [ ] Join `jobs` to `job_location_buckets` and select exactly one cached bucket using `p_granularity`/`p_fold_suburbs`.
- [ ] In `get_location_job_ids`, start from the indexed matching bucket where the plan benefits, then apply the existing provider/archetype/level/company/title/location filters.
- [ ] Evaluate `location_label_bucket(...)` once in a one-row CTE, not repeatedly per job.
- [ ] Preserve all current filter predicates and exact cloud/drill-down parity.
- [ ] Do not “fix” this by globally raising `statement_timeout`; a bounded function-local timeout change is allowed only as a documented fallback after the query is optimized.
- [ ] Bump `location-insights-v1` cache namespace if the RPC response or result semantics require invalidating old cached rows.

**Acceptance:**

- [ ] Active-job totals reconcile in city unfolded, city folded, and province modes.
- [ ] Cloud count equals drill-down total for at least Moosonee, Invermay, Mississauga, Greater Toronto, Toronto, and one province.
- [ ] Twenty consecutive cold/warm drill-down calls for Moosonee and Invermay produce no 57014; target p95 RPC execution below 1 second and hard acceptance below the configured statement timeout with at least 5× headroom.
- [ ] The post-change `EXPLAIN` no longer evaluates `location_bucket` across the full candidate set.

## Phase 2: Add StatCan CMA/CA Membership and Structured Match Quality

### Task 2.1: Build a reproducible geography enrichment script

**Files:**

- Create `scripts/census/enrich_location_geographies.py` (Python standard library only unless a dependency is explicitly justified).
- Create `scripts/census/location_geography_overrides.json` for reviewed, auditable exceptions.
- Add/update `docs/census-per-capita-methodology.md`.
- Add a migration after the bucket-cache migration.

- [ ] Download/extract `98100003-eng.zip` in a temporary directory; do not commit the source zip/CSV.
- [ ] Parse parent/member hierarchy by DGUID, not display-name adjacency alone:
  - `2021S0503...` starts a CMA group.
  - `2021S0504...` starts a CA group.
  - Subsequent `2021A0005...` rows inherit that parent until the next S0503/S0504 row.
- [ ] Match existing `census_population_2021.dguid` values to the membership map.
- [ ] Add structured columns to `census_population_2021`:
  - `parent_area_dguid text`.
  - `parent_area_name text`.
  - `parent_area_type text` constrained to `cma|ca` or null.
  - `is_cma_component boolean not null default false`.
  - `geo_match_quality text` constrained to `exact|parent|cross_province|region|foreign|unknown`.
- [ ] Convert existing free-text notes/known overrides into `geo_match_quality`; retain notes for explanation.
- [ ] Mark CD/region denominators (`2021A0003...`) as `region`; cross-province fallback notes as `cross_province`; reviewed borough/community→parent CSD mappings as `parent`; direct same-province CSD matches as `exact`.
- [ ] Emit an audit report listing every city bucket, denominator DGUID, parent CMA/CA, quality, population, and Small-town eligibility. The script should fail on duplicate DGUID membership, unrecognized parent DGUID types, or unexpected row-order breaks.
- [ ] Seed only pruned attributes used by the app; do not import the entire StatCan table.

**Acceptance:**

- [ ] Dorval/Mississauga/Markham/Burnaby/Laval resolve as CMA components.
- [ ] Moosonee/Invermay classifications are explicitly verified against the source.
- [ ] Every one of the 448 seeded city rows has a reviewed `geo_match_quality`; every CSD-level exact/parent row has deterministic CMA/CA/outside classification.
- [ ] Existing 2021 population checksums stay unchanged unless a documented denominator correction is made.

## Phase 3: Fit and Serve Stabilized Per-Capita Rates

### Task 3.1: Fit model parameters from production-shaped data

**Files:**

- Create `scripts/census/fit_location_rate_prior.py` or a TypeScript equivalent.
- Add a checked-in fixture/output summary, not credentials or raw production exports.
- Add a migration for `public.location_rate_models`.

- [ ] Export one unfiltered active-job aggregate row per eligible bucket: level, count, population, match quality, CMA status.
- [ ] Fit Gamma-Poisson prior dispersion/effective `prior_population` by marginal likelihood (negative-binomial likelihood with population exposure) for `city`, `metro`, and `province` separately. A method-of-moments initializer is fine; final values must be reproducible and accompanied by convergence/audit output.
- [ ] Exclude scope/country/Unspecified, missing denominators, and `cross_province|foreign|unknown` rows from fitting. Document whether parent/region rows are included and why.
- [ ] Store model version, level, prior population, training pooled rate, training date, training bucket/job count, fit method, and diagnostics in `public.location_rate_models`.
- [ ] Enable RLS and service-role-only access on the model table.
- [ ] Produce an audit CSV/table with observed rate, stabilized rate, reliability, rank-old, rank-new, and rank delta. Review the top/bottom 30 before accepting parameters.
- [ ] Explicitly inspect one-job towns, Dorval, Moosonee, Invermay, Toronto, Montreal, and at least one province. Large buckets should move minimally; one-job/tiny-population buckets should move strongly toward the pooled rate but remain present.

### Task 3.2: Extend the insights RPC response

- [ ] Preserve `per_100k` as the observed/old rate for compatibility.
- [ ] Add `stabilized_per_100k`, `rate_reliability`, and structured geography fields needed by the client.
- [ ] Compute the current-filter pooled rate per level from eligible aggregated buckets; use stored training mean only if fewer than three eligible buckets remain.
- [ ] Apply the stored level-specific prior population in the credibility formula.
- [ ] Return raw counts unchanged; drill-down continues to select jobs by bucket and is independent of rate mode.
- [ ] Add numeric/null parsing in `executeLocationInsightsQuery`; never allow `Number(null) -> 0`.
- [ ] Extend `KeywordInsight` or introduce a location-specific type rather than overloading fields ambiguously.

### Task 3.3: Add the observed-vs-stabilized UI toggle

**Files:**

- Modify `src/lib/filters/types.ts`, `searchParams.ts`, `routeConfig.ts`, and tests.
- Modify `src/lib/supabase/locationInsightsCacheKey.ts` and tests only if rate mode changes the server result. Prefer returning both rates so it does not enter the aggregate cache key.
- Modify `src/app/insights/page.tsx` and `src/components/insights/InsightsClient.tsx`.
- Add/update focused query and component tests.

- [ ] Add validated `rate=raw|stabilized`, preserving `percap=true` without `rate` as raw.
- [ ] Add the visible two-state **Observed (old)** / **Stabilized (new)** comparison control when per-capita is on.
- [ ] Switching rate mode must be instant/client-side, preserve `keyword`, and not call the RPC again.
- [ ] New per-capita activation chooses stabilized; old bookmarks remain observed.
- [ ] Sort the cloud and Top 20 by selected metric. Use selected metric as the word weight.
- [ ] Show exact values and evidence in accessible text/tooltip: `N jobs`, `2021 population`, `observed X/100k`, `stabilized Y/100k`, and reliability/“low evidence” when appropriate.
- [ ] Do not use opacity alone to communicate reliability; retain readable contrast and add text/label semantics.

**Acceptance:**

- [ ] Existing observed values are byte-for-byte/numerically unchanged (e.g. current Toronto, Dorval spot checks).
- [ ] Toggling old/new visibly changes ranking/size for tiny denominators but barely changes major metros/provinces.
- [ ] A one-job remote place remains in results in stabilized mode and no longer dominates solely because its population is tiny.
- [ ] Rate switching performs no network navigation/refetch beyond URL replacement.

## Phase 4: Add the Small-Town View

### Task 4.1: Add server semantics and cache key

- [ ] Add `p_place_view text default 'all'` (or an equivalent constrained parameter) to `get_location_insights`; accept only `all|small_town` in application parsing and normalize unknown SQL input to `all` or reject clearly.
- [ ] For `small_town`, filter aggregated buckets using the exact rule under “Decisions Already Made.”
- [ ] Exclude every non-city bucket before rate pooling so metro/province rates do not influence the small-town pooled mean.
- [ ] Decide whether drill-down RPC needs the view parameter. It should not alter bucket membership, but pass/validate it if needed to keep URL/RPC contracts symmetric.
- [ ] Add `placeView` to location cache serialization/deserialization and bump cache namespace.
- [ ] Add SQL/migration tests proving nested and quality exclusions.

### Task 4.2: Add the Small town control

- [ ] Parse/route `town=small` only on Insights.
- [ ] Add **Small town** as a city-only toggle near the per-capita controls.
- [ ] Activating it sets `loc=city&percap=true&rate=stabilized&town=small`, removes `fold`, clears `keyword`, and resets pagination.
- [ ] Deactivating it returns to the full city set while preserving selected rate.
- [ ] The old/new comparison control remains usable inside Small town.
- [ ] Explain the view in one concise line: standalone Canadian communities under 100k, excluding CMA components; rates are stabilized by default.
- [ ] Show “No census denominator” buckets only in the full raw/count view, not Small town.

**Acceptance:**

- [ ] Dorval and other CMA-nested suburbs do not appear in Small town.
- [ ] Moosonee/Invermay appear if their audited population/quality classifications pass, including at one job.
- [ ] Metro/province/country/scope labels never appear in Small town.
- [ ] Observed-vs-stabilized comparison uses the identical Small-town bucket set.
- [ ] Drill-down totals still equal the clicked cloud count.

## Phase 5: Verification and Documentation

### Database verification

- [ ] Re-run security/performance advisors after DDL/index/RLS changes and surface URLs/remediations.
- [ ] Verify trigger freshness by updating a disposable development-branch job location, checking all three cached buckets, then rolling back/resetting the branch. Prefer a Supabase development branch or local stack before production DDL.
- [ ] Verify no duplicate/missing rows in `job_location_buckets` relative to `jobs`.
- [ ] Compare old function-computed and cached bucket counts across all active jobs before removing function calls from hot paths.
- [ ] Run old/new rate audit and inspect rank deltas.
- [ ] Re-run timeout benchmark and save before/after plans in the implementation notes.

### Application verification

- [ ] Unit tests: URL parsing, route isolation, cache round-trip, RPC params/result parsing, null handling, old/new metric selection, Small-town inclusion predicates.
- [ ] Migration tests: bucket cache schema/indexes/triggers, CMA/CA fields, RLS/grants, stabilized columns, service-only RPC grants.
- [ ] Browser checks on desktop and mobile:
  - Counts → Per 100k defaults to Stabilized.
  - Observed ↔ Stabilized changes cloud and Top 20 without refetch.
  - Small town excludes Dorval/Mississauga and keeps valid remote towns.
  - Moosonee/Invermay drill-downs load repeatedly without red error cards/timeouts.
  - Back/Forward preserves all URL-driven controls.
- [ ] Run `npm test`; confirm only the four documented pre-existing failures remain unless separately fixed.
- [ ] Run `npm run typecheck`, `npm run lint`, and `npm run build` to clean completion.
- [ ] Update `docs/census-per-capita-methodology.md` with table 0003 hierarchy parsing, structured match-quality rules, model-fitting method/parameters, model refresh cadence, Small-town threshold, and 2026 replacement steps.

## Files Expected to Change

- `src/app/insights/page.tsx`
- `src/components/insights/InsightsClient.tsx`
- `src/lib/filters/types.ts`
- `src/lib/filters/searchParams.ts`
- `src/lib/filters/searchParams.test.ts`
- `src/lib/filters/routeConfig.ts`
- `src/lib/filters/routeConfig.test.ts`
- `src/lib/supabase/queries.ts`
- `src/lib/supabase/locationInsightsCacheKey.ts`
- Related query/cache/migration tests under `src/lib/supabase/`
- `src/types.ts` (or a new location-specific insight type module)
- New migrations after `202609180007_census_population_seed.sql`
- `scripts/census/enrich_location_geographies.py`
- `scripts/census/fit_location_rate_prior.py`
- `scripts/census/location_geography_overrides.json`
- `docs/census-per-capita-methodology.md`

## Risks and Guardrails

- **Filtered-rate bias:** Never shrink filtered results toward an all-jobs mean; compute the current-filter pooled mean and use the stored model only for dispersion/fallback.
- **Overlapping denominators:** City rows sometimes map boroughs to parent municipalities. Fit only reviewed quality classes and document duplicate-parent handling so one parent population is not counted repeatedly in the pooled mean. Prefer grouping by denominator DGUID during prior fitting/pooling, summing job counts once per shared denominator.
- **Census hierarchy mistakes:** Table 0003 is ordered hierarchy, not a flat parent-column file. Parse DGUID types and fail closed.
- **Misleading cross-province artifacts:** Do not classify them as small towns merely because they have a borrowed population.
- **Cache staleness:** Bucket-cache triggers cover job changes; explicit refresh covers alias/classification changes. Tests must prove both paths.
- **Migration drift:** Inspect remote history before naming/applying migrations; keep local migration files sufficient for a clean database even though the existing remote 0006/0007 work was applied in MCP split steps.
- **Security:** Enable RLS on every new table and grant only service-role access. Do not read `.env` files; use Supabase MCP/CLI configured authentication.
- **Scope discipline:** Do not fix the four baseline test failures or unrelated dirty files as part of this work.

## Final Deliverable Checklist

- [ ] Cached/indexed bucket resolution removes location statement timeouts.
- [ ] StatCan 0003 CMA/CA enrichment is reproducible and audited.
- [ ] Empirical-Bayes parameters are fitted, stored, and documented.
- [ ] RPC returns observed + stabilized rates and reliability.
- [ ] Per-capita UI has a direct **Observed (old)** / **Stabilized (new)** toggle.
- [ ] **Small town** view uses authoritative CMA exclusion and stabilized rates by default.
- [ ] Old URLs and observed values remain compatible.
- [ ] Methodology is sufficient to repeat for 2026 data.
- [ ] Tests/typecheck/lint/build and database/browser checks meet the gates above.
