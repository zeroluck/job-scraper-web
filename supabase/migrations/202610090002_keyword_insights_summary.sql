-- Web-owned serving cache; no pipeline code reads this table.
-- Keep future refresh changes in this web migration chain.
-- Pre-aggregated serving table for the hot keyword-insights shapes.
--
-- The default /insights aggregate (all six lanes + software_tpm alias,
-- unfiltered, min_count 2) scans 400k+ fact rows per cold request and lives
-- right at the 8s PostgREST statement timeout (authenticator role), so tail
-- latency 57014s under write contention. This table materializes that exact
-- aggregate in the background; the app serves default shapes from it and
-- keeps the live RPC as fallback for exotic filter combos.
--
-- Only the default filter set is materialized (shape 'v1:default'); per-tab
-- category slices are derived at read time from the same rows, so counts
-- match the live RPC by construction. min_count and limit are applied at
-- read time identically to the RPC (min_count 2 is baked into the refresh;
-- any other min_count falls back to the live RPC).

CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE TABLE IF NOT EXISTS public.keyword_insights_summary (
  shape_key text NOT NULL,
  keyword text NOT NULL,
  category text NOT NULL,
  count bigint NOT NULL,
  last_updated timestamptz,
  refreshed_at timestamptz NOT NULL,
  PRIMARY KEY (shape_key, category, keyword)
);

CREATE INDEX IF NOT EXISTS idx_keyword_insights_summary_read
  ON public.keyword_insights_summary (shape_key, category, count DESC, keyword ASC);

ALTER TABLE public.keyword_insights_summary ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.keyword_insights_summary FROM public, anon, authenticated;
GRANT SELECT ON TABLE public.keyword_insights_summary TO service_role;

-- One pass per hash chunk: every statement stays well under any
-- statement timeout, while the union of chunks is exactly the unfiltered
-- all-category aggregate. Chunking by keyword_key keeps each
-- (keyword, category) group atomic, so DISTINCT counts, min_count, and
-- display-label resolution match the live RPC group-for-group. The four
-- slices union to the all-category aggregate (these are the only
-- categories), so per-tab reads and the all-tab read share the same rows.
-- Skipped quietly when another refresh holds the advisory lock.
CREATE OR REPLACE FUNCTION public.refresh_keyword_insights_summary()
RETURNS TABLE(shape_key text, groups_refreshed bigint, refreshed_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET statement_timeout = '10min' AS $$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_rows bigint := 0;
  v_n bigint;
  v_chunk integer;
BEGIN
  IF NOT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('refresh-kis-v1', 0)) THEN
    RETURN QUERY SELECT 'v1:default'::text, 0::bigint, v_now;
    RETURN;
  END IF;
  DELETE FROM public.keyword_insights_summary WHERE keyword_insights_summary.shape_key = 'v1:default';
  FOR v_chunk IN 0..7 LOOP
    INSERT INTO public.keyword_insights_summary (shape_key, keyword, category, count, last_updated, refreshed_at)
    WITH qualified_jobs AS MATERIALIZED (
      SELECT j.job_id
      FROM public.jobs j
      WHERE j.is_active IS TRUE
        AND EXISTS (
          SELECT 1 FROM public.job_archetype_memberships m
          WHERE m.job_id = j.job_id
            AND (m.archetype = ANY (ARRAY['technology_delivery','software_tpm','systems_platform_ops','network_infrastructure','datacenter_operations','ai_workflow_automation','building_controls'])
              OR ('software_tpm' = ANY (ARRAY['technology_delivery','software_tpm','systems_platform_ops','network_infrastructure','datacenter_operations','ai_workflow_automation','building_controls']) AND m.archetype = 'technology_delivery'))
            AND m.is_filtered IS FALSE)
    ), chunked AS (
      SELECT lower(btrim(jki.keyword)) AS keyword_key,
        min(btrim(jki.keyword)) AS fallback_keyword, jki.category,
        count(DISTINCT jki.job_id)::bigint AS insight_count,
        max(jki.analyzed_at) AS last_updated
      FROM public.job_keyword_insights jki
      JOIN qualified_jobs q ON q.job_id = jki.job_id
      WHERE btrim(jki.keyword) <> ''
        AND (jki.archetype = ANY (ARRAY['technology_delivery','software_tpm','systems_platform_ops','network_infrastructure','datacenter_operations','ai_workflow_automation','building_controls']) AND EXISTS (
          SELECT 1 FROM public.job_archetype_memberships m
          WHERE m.job_id = jki.job_id
            AND m.archetype = CASE WHEN jki.archetype = 'software_tpm' THEN 'technology_delivery' ELSE jki.archetype END
            AND m.is_filtered IS FALSE))
        AND ((pg_catalog.hashtextextended(lower(btrim(jki.keyword)), 0) % 8) + 8) % 8 = v_chunk
      GROUP BY lower(btrim(jki.keyword)), jki.category
      HAVING count(DISTINCT jki.job_id) >= 2
    ), label_counts AS (
      SELECT c.keyword_key, ki.category, btrim(ki.keyword) AS keyword,
        sum(ki.count)::bigint AS label_count
      FROM public.keyword_insights ki
      JOIN chunked c
        ON lower(btrim(ki.keyword)) = c.keyword_key
        AND ki.category = c.category
      GROUP BY c.keyword_key, ki.category, btrim(ki.keyword)
    ), display_labels AS (
      SELECT DISTINCT ON (lc.keyword_key, lc.category)
        lc.keyword_key, lc.category, lc.keyword
      FROM label_counts lc
      ORDER BY lc.keyword_key, lc.category, lc.label_count DESC, lc.keyword ASC
    )
    SELECT 'v1:default', COALESCE(dl.keyword, c.fallback_keyword),
      c.category, c.insight_count, c.last_updated, v_now
    FROM chunked c
    LEFT JOIN display_labels dl
      ON dl.keyword_key = c.keyword_key AND dl.category = c.category;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_rows := v_rows + v_n;
  END LOOP;
  RETURN QUERY SELECT 'v1:default'::text, v_rows, v_now;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_keyword_insights_summary() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_keyword_insights_summary() TO service_role;

DO $cron$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-keyword-insights-summary') THEN
    PERFORM cron.schedule(
      'refresh-keyword-insights-summary',
      '*/15 * * * *',
      'SELECT public.refresh_keyword_insights_summary()'
    );
  END IF;
END $cron$;
