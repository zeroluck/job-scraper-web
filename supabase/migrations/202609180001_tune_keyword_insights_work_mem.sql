-- The default-shape keyword-insights aggregate sorts ~200k+ rows for
-- count(DISTINCT job_id). With default work_mem it spills to disk
-- (measured 6.3s with temp files, at risk of the 2min statement timeout
-- under load) versus 1.4s with zero spill at 256MB. Function-level only:
-- no result, plan-shape, or schema change. Idempotent re-apply is safe.
ALTER FUNCTION public.get_filtered_keyword_insights(text[], text[], text[], text, text[], text[], text[], text[], text[], text, integer, integer, integer) SET work_mem = '256MB';
