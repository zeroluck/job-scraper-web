-- History mirror. Authoritative SQL: job-scraper/supabase_setup/ (five sections).
-- Apply after the existing adaptive discovery chain; native authority is CT337.

-- Authoritative copy; mirror into the companion web migration chain.
-- Reconcile the native 2026-11-03 fix without replaying consolidated SQL.
BEGIN;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='60s';
DO $$
DECLARE
    definition text;
    owner_name text;
    marker text := 'AND cycle.canonical_status = ''pending''';
BEGIN
    SELECT pg_get_functiondef(oid),pg_get_userbyid(proowner) INTO definition,owner_name FROM pg_proc
    WHERE oid='public.get_resumable_linkedin_discovery_cycle(boolean,text[])'::regprocedure;
    IF position('task.attempt_count < task.max_attempts' IN definition)=0 THEN
        IF position(marker IN definition)=0 THEN RAISE EXCEPTION 'selector contract changed'; END IF;
        EXECUTE replace(definition,marker,marker || $predicate$
               AND EXISTS (
                   SELECT 1 FROM public.linkedin_discovery_tasks task
                   WHERE task.status = 'leased'
                      OR (task.status IN ('pending','failed_retryable') AND task.attempt_count < task.max_attempts)
               )$predicate$);
    END IF;
    IF owner_name LIKE 'jobs_o_%' THEN
        EXECUTE format('GRANT SELECT ON public.linkedin_discovery_tasks TO %I',owner_name);
        IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='linkedin_discovery_tasks'
                      AND policyname='selector_resume_tasks_select') THEN
            EXECUTE format('CREATE POLICY selector_resume_tasks_select ON public.linkedin_discovery_tasks FOR SELECT TO %I USING(true)',owner_name);
        END IF;
    END IF;
END;
$$;
COMMIT;

-- Authoritative copy; mirror into the companion web migration chain.
-- Preserve execution timestamps and derive continuation from exact page proof.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.prepare_linkedin_discovery_scope_state(
    p_scope_keys text[], p_recovery_floor timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    scope_key_value text;
    states jsonb;
    debt_rows jsonb;
BEGIN
    IF p_scope_keys IS NULL OR array_length(p_scope_keys, 1) IS NULL OR p_recovery_floor IS NULL THEN
        RAISE EXCEPTION 'scope keys and recovery floor are required' USING ERRCODE = '22023';
    END IF;
    FOREACH scope_key_value IN ARRAY p_scope_keys LOOP
        PERFORM public.expire_linkedin_coverage_debt(scope_key_value, p_recovery_floor);
    END LOOP;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'scope_key', state.scope_key,
        'last_operational_success_at', state.last_operational_success_at,
        'last_covered_through_at', proof.covered_through,
        'last_operational_discovery_sequence', state.last_operational_discovery_sequence,
        'recommended_pages', state.recommended_pages,
        'coverage_debt', state.coverage_debt,
        'last_deep_sweep_at', state.last_deep_sweep_at
    ) ORDER BY state.scope_key), '[]'::jsonb) INTO states
    FROM public.linkedin_scope_coverage_state state
    LEFT JOIN LATERAL (
        SELECT LEAST(scope.source_window_latest_at, page.latest) AS covered_through
        FROM public.linkedin_discovery_cycles cycle
        JOIN public.linkedin_discovery_cycle_scopes scope ON scope.discovery_cycle_id = cycle.id
        JOIN public.ingestion_runs run ON run.id = scope.ingestion_run_id
        CROSS JOIN LATERAL (
            SELECT count(*) AS pages, min(p.page_number) AS first_page,
                   max(p.page_number) AS last_page,
                   max(p.source_window_earliest_at) AS earliest,
                   min(p.source_window_latest_at) AS latest,
                   (array_agg(p.result ORDER BY p.page_number DESC))[1] AS last_result
            FROM public.linkedin_ingestion_pages p WHERE p.ingestion_run_id = scope.ingestion_run_id
        ) page
        WHERE cycle.discovery_sequence = state.last_operational_discovery_sequence
          AND scope.scope_key = state.scope_key AND cycle.search_status = 'sealed'
          AND scope.status = 'complete' AND run.status = 'complete'
          AND run.coverage_status = 'exhausted'
          AND page.first_page = 1 AND page.pages = page.last_page
          AND page.last_result = 'no_results'
          AND page.earliest <= scope.source_window_earliest_at
          AND page.latest >= scope.source_window_latest_at
    ) proof ON true
    WHERE state.scope_key = ANY(p_scope_keys);
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'scope_key', selected.scope_key,
        'source_window_earliest_at', selected.source_window_earliest_at,
        'source_window_latest_at', selected.source_window_latest_at,
        'created_at', selected.created_at
    ) ORDER BY selected.scope_key), '[]'::jsonb) INTO debt_rows
    FROM (
        SELECT DISTINCT ON (debt.scope_key) debt.scope_key, debt.source_window_earliest_at,
               debt.source_window_latest_at, debt.created_at
        FROM public.linkedin_coverage_debt debt
        WHERE debt.scope_key = ANY(p_scope_keys) AND debt.status = 'pending'
        ORDER BY debt.scope_key, debt.source_window_earliest_at, debt.id
    ) selected;
    RETURN jsonb_build_object('states', states, 'debt', debt_rows);
END;
$$;

-- One predicate for the manual preflight and its execution guard. The selector
-- intentionally also retains future retries and leases until they settle.
CREATE OR REPLACE FUNCTION public.linkedin_actionable_task_count()
RETURNS bigint LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog AS $$
    SELECT count(*) FROM public.linkedin_discovery_tasks
    WHERE status IN ('pending', 'failed_retryable') AND attempt_count < max_attempts
      AND available_at <= statement_timestamp();
$$;
REVOKE ALL ON FUNCTION public.linkedin_actionable_task_count() FROM PUBLIC;

-- Native functions have separate least-privilege owners. Hosted installations
-- retain their existing owners. Do not replace either authorization model.
DO $$
DECLARE
    owner_name text;
    table_name text;
BEGIN
    SELECT pg_get_userbyid(proowner) INTO owner_name FROM pg_proc
    WHERE oid = 'public.prepare_linkedin_discovery_scope_state(text[],timestamptz)'::regprocedure;
    IF owner_name LIKE 'jobs_o_%' THEN
        FOREACH table_name IN ARRAY ARRAY['linkedin_discovery_cycles', 'linkedin_discovery_cycle_scopes',
                                         'linkedin_ingestion_pages', 'ingestion_runs'] LOOP
            EXECUTE format('GRANT SELECT ON public.%I TO %I', table_name, owner_name);
            IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                           AND tablename = table_name AND policyname = 'continuation_proof_select') THEN
                EXECUTE format('CREATE POLICY continuation_proof_select ON public.%I FOR SELECT TO %I USING (true)', table_name, owner_name);
            END IF;
        END LOOP;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'job_runner') THEN
        GRANT EXECUTE ON FUNCTION public.linkedin_actionable_task_count() TO job_runner;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        GRANT EXECUTE ON FUNCTION public.linkedin_actionable_task_count() TO service_role;
    END IF;
END;
$$;
COMMIT;

-- Authoritative copy; mirror into the companion web migration chain.
-- Charge a durable task attempt on its first source grant, not on local claim.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.claim_linkedin_discovery_tasks(p_worker_id text, p_limit integer, p_order_mode text)
RETURNS SETOF public.linkedin_discovery_tasks
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
    IF p_worker_id IS NULL OR btrim(p_worker_id) = '' OR p_limit IS NULL OR p_limit < 1 OR p_limit > 100
       OR p_order_mode IS NULL OR p_order_mode NOT IN ('oldest', 'newest') THEN
        RAISE EXCEPTION 'invalid task claim parameters' USING ERRCODE = '22023';
    END IF;
    UPDATE public.linkedin_discovery_tasks
    SET status = 'failed_terminal', completed_at = clock_timestamp(),
        last_error_code = COALESCE(last_error_code, 'lease_expired_attempts_exhausted'),
        leased_by = NULL, leased_at = NULL, lease_expires_at = NULL, lease_token = NULL
    WHERE status = 'leased' AND lease_expires_at <= clock_timestamp() AND attempt_count >= max_attempts;
    UPDATE public.linkedin_discovery_tasks SET status = 'failed_retryable', leased_by = NULL, leased_at = NULL,
        lease_expires_at = NULL, lease_token = NULL, available_at = clock_timestamp()
    WHERE status = 'leased' AND lease_expires_at <= clock_timestamp() AND attempt_count < max_attempts;
    RETURN QUERY WITH picked AS (
        SELECT task.id FROM public.linkedin_discovery_tasks task
        WHERE task.status IN ('pending', 'failed_retryable')
          AND task.attempt_count < task.max_attempts AND task.available_at <= clock_timestamp()
          AND (p_order_mode <> 'newest' OR (task.task_kind = 'initial_detail' AND task.requirement_key = 'first'))
        ORDER BY
          CASE WHEN p_order_mode = 'oldest' THEN COALESCE((
              SELECT min(cycle.discovery_sequence) FROM public.linkedin_discovery_requirements requirement
              JOIN public.linkedin_discovery_cycles cycle ON cycle.id = requirement.discovery_cycle_id
              WHERE requirement.task_id = task.id AND requirement.required
          ), 9223372036854775807) END,
          task.priority DESC,
          CASE WHEN p_order_mode = 'newest' THEN task.first_observed_at END DESC,
          task.first_observed_at, task.id
        FOR UPDATE OF task SKIP LOCKED LIMIT p_limit
    ) UPDATE public.linkedin_discovery_tasks task SET status = 'leased', leased_by = p_worker_id,
        leased_at = clock_timestamp(), lease_expires_at = clock_timestamp() + interval '10 minutes',
        lease_token = extensions.gen_random_uuid()
    FROM picked WHERE task.id = picked.id RETURNING task.*;
END;
$$;

-- The grant function is also changed by durable feedback. This narrow guarded
-- edit preserves its live body, ownership, ACL, and all native lease checks.
DO $$
DECLARE
    definition text;
    marker text := '    INSERT INTO public.linkedin_source_request_grants (';
    owner_name text;
    charge text := $charge$
    IF p_producer = 'adaptive-detail' THEN
        -- Policy lock serializes grants. Count once per lease, including retries.
        IF NOT EXISTS (
            SELECT 1 FROM public.linkedin_discovery_task_attempts
            WHERE task_id = split_part(p_request_key, ':', 2)::bigint
              AND lease_token = split_part(p_request_key, ':', 3)::uuid
        ) THEN
            UPDATE public.linkedin_discovery_tasks SET attempt_count = attempt_count + 1
            WHERE id = split_part(p_request_key, ':', 2)::bigint
              AND lease_token = split_part(p_request_key, ':', 3)::uuid
              AND status = 'leased' AND lease_expires_at > clock_timestamp()
              AND attempt_count < max_attempts;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'source attempt requires an eligible live lease' USING ERRCODE = '55000';
            END IF;
        END IF;
    END IF;
$charge$;
BEGIN
    SELECT pg_get_functiondef(oid), pg_get_userbyid(proowner) INTO definition, owner_name
    FROM pg_proc WHERE oid = 'public.acquire_linkedin_request_grant(text,text,text)'::regprocedure;
    IF position('source attempt requires an eligible live lease' IN definition) = 0 THEN
        IF (length(definition) - length(replace(definition, marker, ''))) / length(marker) <> 1
           OR position('adaptive detail request requires an active task lease' IN definition) = 0 THEN
            RAISE EXCEPTION 'request grant contract changed; retry-accounting migration rejected';
        END IF;
        EXECUTE replace(definition, marker, charge || marker);
    END IF;
    IF owner_name LIKE 'jobs_o_%' THEN
        EXECUTE format('GRANT UPDATE (attempt_count) ON public.linkedin_discovery_tasks TO %I', owner_name);
        EXECUTE format('GRANT SELECT ON public.linkedin_discovery_task_attempts TO %I', owner_name);
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='linkedin_discovery_tasks'
                       AND policyname='source_attempt_charge') THEN
            EXECUTE format('CREATE POLICY source_attempt_charge ON public.linkedin_discovery_tasks FOR UPDATE TO %I USING (status = ''leased'') WITH CHECK (status = ''leased'')', owner_name);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='linkedin_discovery_task_attempts'
                       AND policyname='source_attempt_charge_select') THEN
            EXECUTE format('CREATE POLICY source_attempt_charge_select ON public.linkedin_discovery_task_attempts FOR SELECT TO %I USING (true)', owner_name);
        END IF;
    END IF;
END;
$$;
COMMIT;

-- Authoritative copy; mirror into the companion web migration chain.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.linkedin_source_request_policy
    ADD COLUMN IF NOT EXISTS cooldown_until timestamptz NOT NULL DEFAULT '-infinity',
    ADD COLUMN IF NOT EXISTS effective_interval_ms integer NOT NULL DEFAULT 5000 CHECK (effective_interval_ms BETWEEN 2500 AND 60000),
    ADD COLUMN IF NOT EXISTS consecutive_429 integer NOT NULL DEFAULT 0 CHECK (consecutive_429 >= 0),
    ADD COLUMN IF NOT EXISTS successful_since_throttle integer NOT NULL DEFAULT 0 CHECK (successful_since_throttle >= 0),
    ADD COLUMN IF NOT EXISTS last_429_at timestamptz;
ALTER TABLE public.linkedin_source_request_grants
    ADD COLUMN IF NOT EXISTS retry_after_seconds integer CHECK (retry_after_seconds BETWEEN 0 AND 604800),
    ADD COLUMN IF NOT EXISTS response_headers jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(response_headers) = 'object'),
    ADD COLUMN IF NOT EXISTS execution_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(execution_metadata) = 'object');

CREATE OR REPLACE FUNCTION public.finish_linkedin_request_feedback(
    p_grant_id uuid, p_producer text, p_response_class text, p_http_status integer,
    p_retry_after_seconds integer, p_response_headers jsonb, p_execution_metadata jsonb
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    finished_grant public.linkedin_source_request_grants%ROWTYPE;
    policy public.linkedin_source_request_policy%ROWTYPE;
    finished timestamptz := clock_timestamp();
BEGIN
    IF p_retry_after_seconds < 0 OR p_retry_after_seconds > 604800
       OR jsonb_typeof(p_response_headers) IS DISTINCT FROM 'object'
       OR jsonb_typeof(p_execution_metadata) IS DISTINCT FROM 'object'
       OR octet_length(p_response_headers::text) > 4096 OR octet_length(p_execution_metadata::text) > 4096 THEN
        RAISE EXCEPTION 'invalid request feedback' USING ERRCODE = '22023';
    END IF;
    -- Same lock order as acquire/open-circuit: policy before grant/task rows.
    SELECT * INTO STRICT policy FROM public.linkedin_source_request_policy WHERE source = 'linkedin' FOR UPDATE;
    UPDATE public.linkedin_source_request_grants
    SET status = 'finished', finished_at = finished, response_class = p_response_class, http_status = p_http_status,
        retry_after_seconds = p_retry_after_seconds, response_headers = p_response_headers,
        execution_metadata = p_execution_metadata
    WHERE id = p_grant_id AND producer = p_producer AND status = 'consumed'
    RETURNING * INTO finished_grant;
    IF finished_grant.id IS NULL THEN RETURN false; END IF;
    IF p_producer = 'adaptive-detail' AND finished_grant.request_key ~ '^task:[0-9]+:[0-9a-f-]{36}:[^:]+:[0-9]+$' THEN
        INSERT INTO public.linkedin_discovery_task_attempts (
            task_id, lease_token, request_attempt, request_grant_id, response_class,
            http_status, parser_version, started_at, finished_at
        ) VALUES (
            split_part(finished_grant.request_key, ':', 2)::bigint,
            split_part(finished_grant.request_key, ':', 3)::uuid,
            split_part(finished_grant.request_key, ':', 5)::integer,
            finished_grant.id, p_response_class, p_http_status, 'linkedin-detail-v1', finished_grant.started_at, finished
        ) ON CONFLICT (request_grant_id) DO UPDATE SET response_class = EXCLUDED.response_class,
            http_status = EXCLUDED.http_status, parser_version = EXCLUDED.parser_version, finished_at = EXCLUDED.finished_at;
    END IF;
    IF p_http_status = 429 THEN
        UPDATE public.linkedin_source_request_policy
        SET effective_interval_ms = LEAST(60000, GREATEST(minimum_interval_ms, effective_interval_ms) * 2),
            consecutive_429 = LEAST(1000, consecutive_429 + 1), successful_since_throttle = 0,
            cooldown_until = GREATEST(cooldown_until, finished + make_interval(secs => GREATEST(
                COALESCE(p_retry_after_seconds, 0), LEAST(3600, 60 * power(2, LEAST(consecutive_429, 6)))
            ))), last_429_at = finished, updated_at = finished
        WHERE source = 'linkedin';
    ELSIF p_http_status BETWEEN 200 AND 299 THEN
        UPDATE public.linkedin_source_request_policy
        SET successful_since_throttle = CASE WHEN successful_since_throttle >= 19 THEN 0 ELSE successful_since_throttle + 1 END,
            effective_interval_ms = CASE WHEN successful_since_throttle >= 19
                THEN GREATEST(minimum_interval_ms, 5000, ceil(effective_interval_ms * 0.9)::integer)
                ELSE effective_interval_ms END,
            consecutive_429 = CASE WHEN successful_since_throttle >= 19 THEN 0 ELSE consecutive_429 END,
            updated_at = finished WHERE source = 'linkedin';
    END IF;
    -- Retry-After on e.g. 503 is also a shared source instruction.
    IF p_retry_after_seconds > 0 THEN
        UPDATE public.linkedin_source_request_policy
        SET cooldown_until = GREATEST(cooldown_until, finished + make_interval(secs => p_retry_after_seconds)),
            updated_at = finished WHERE source = 'linkedin';
    END IF;
    RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.finish_linkedin_request_feedback(uuid,text,text,integer,integer,jsonb,jsonb) FROM PUBLIC;

-- Existing producers retain their four-argument contract and feed the same
-- policy even before upgrading their richer response telemetry.
CREATE OR REPLACE FUNCTION public.finish_linkedin_request_grant(
    p_grant_id uuid, p_producer text, p_response_class text, p_http_status integer
) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
    SELECT public.finish_linkedin_request_feedback(p_grant_id,p_producer,p_response_class,p_http_status,NULL,'{}','{}');
$$;

DO $$
DECLARE
    definition text;
    marker text := '    IF v_now < policy.next_allowed_at THEN';
    owner_name text;
    command text;
BEGIN
    SELECT pg_get_functiondef(oid) INTO definition FROM pg_proc
    WHERE oid = 'public.acquire_linkedin_request_grant(text,text,text)'::regprocedure;
    IF position('policy.cooldown_until' IN definition) = 0 THEN
        IF position(marker IN definition) = 0 OR position('minimum_interval_ms / 1000.0' IN definition) = 0 THEN
            RAISE EXCEPTION 'request grant contract changed; cooldown migration rejected';
        END IF;
        definition := replace(definition, marker,
            '    policy.next_allowed_at := GREATEST(policy.next_allowed_at, policy.cooldown_until);' || chr(10) || marker);
        definition := replace(definition, 'minimum_interval_ms / 1000.0', 'GREATEST(minimum_interval_ms, effective_interval_ms) / 1000.0');
        -- Bound the wait integer even if an operator sets a very long cooldown.
        definition := replace(definition, 'pg_catalog.ceil(EXTRACT(EPOCH FROM (policy.next_allowed_at - v_now)) * 1000)::integer',
            'LEAST(60000, pg_catalog.ceil(EXTRACT(EPOCH FROM (policy.next_allowed_at - v_now)) * 1000))::integer');
        EXECUTE definition;
    END IF;
    SELECT pg_get_functiondef(oid) INTO definition FROM pg_proc
    WHERE oid = 'public.consume_linkedin_request_grant(uuid,text)'::regprocedure;
    IF position('policy.cooldown_until' IN definition) = 0 THEN
        IF position('IF grant_row.id IS NULL OR' IN definition) = 0 THEN
            RAISE EXCEPTION 'grant consumption contract changed; cooldown migration rejected';
        END IF;
        -- Adaptive detail now charges atomically at acquire; its retired pending
        -- grant path must reacquire rather than bypass the lease/attempt check.
        definition := replace(definition, 'IF grant_row.id IS NULL OR',
            'IF started < policy.cooldown_until OR p_producer = ''adaptive-detail'' OR grant_row.id IS NULL OR');
        definition := replace(definition, 'minimum_interval_ms / 1000.0',
            'GREATEST(minimum_interval_ms, effective_interval_ms) / 1000.0');
        EXECUTE definition;
    END IF;
    SELECT pg_get_userbyid(proowner) INTO owner_name FROM pg_proc
    WHERE oid = 'public.finish_linkedin_request_grant(uuid,text,text,integer)'::regprocedure;
    EXECUTE format('ALTER FUNCTION public.finish_linkedin_request_feedback(uuid,text,text,integer,integer,jsonb,jsonb) OWNER TO %I', owner_name);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.finish_linkedin_request_feedback(uuid,text,text,integer,integer,jsonb,jsonb) TO %I', owner_name);
    IF owner_name LIKE 'jobs_o_%' THEN
        EXECUTE format('GRANT SELECT, UPDATE ON public.linkedin_source_request_policy TO %I', owner_name);
        FOREACH command IN ARRAY ARRAY['SELECT','UPDATE'] LOOP
            IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='linkedin_source_request_policy'
                           AND policyname='feedback_policy_' || lower(command)) THEN
                EXECUTE format('CREATE POLICY %I ON public.linkedin_source_request_policy FOR %s TO %I USING (true)%s',
                    'feedback_policy_' || lower(command), command, owner_name,
                    CASE WHEN command='UPDATE' THEN ' WITH CHECK (true)' ELSE '' END);
            END IF;
        END LOOP;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='job_runner') THEN
        GRANT EXECUTE ON FUNCTION public.finish_linkedin_request_feedback(uuid,text,text,integer,integer,jsonb,jsonb) TO job_runner;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
        GRANT EXECUTE ON FUNCTION public.finish_linkedin_request_feedback(uuid,text,text,integer,integer,jsonb,jsonb) TO service_role;
    END IF;
END;
$$;
COMMIT;

-- Authoritative copy; mirror into the companion web migration chain.
-- Read-only visibility; does not finalize, accept, or resolve anything.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';
CREATE OR REPLACE FUNCTION public.linkedin_publication_diagnostics(p_cycle_id bigint)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
WITH selected AS (
    SELECT id,discovery_sequence,search_status,search_completed_at
    FROM public.linkedin_discovery_cycles
    WHERE p_cycle_id IS NULL OR id=p_cycle_id ORDER BY discovery_sequence DESC LIMIT 1
), predecessors AS (
    SELECT c.id FROM public.linkedin_discovery_cycles c,selected
    WHERE c.discovery_sequence <= selected.discovery_sequence AND c.search_status <> 'sealed'
      AND NOT EXISTS (
        SELECT 1 FROM public.linkedin_discovery_cycle_resolutions r
        JOIN public.linkedin_discovery_cycles recovery ON recovery.id=r.resolving_discovery_cycle_id
        WHERE r.failed_discovery_cycle_id=c.id AND recovery.search_status='sealed'
          AND recovery.discovery_sequence <= selected.discovery_sequence
      )
), debt AS (
    SELECT d.id,d.status FROM public.linkedin_coverage_debt d
    JOIN public.linkedin_discovery_cycles c ON c.id=d.origin_discovery_cycle_id,selected
    WHERE c.discovery_sequence <= selected.discovery_sequence AND d.status IN ('pending','expired_unresolved')
), blockers AS (
    SELECT r.discovery_cycle_id,r.ingestion_run_id,r.provider,r.source_job_id,r.task_kind,r.requirement_key,
           t.id AS task_id,t.status,t.attempt_count,t.max_attempts,t.last_error_code,t.latest_observed_at
    FROM public.linkedin_discovery_requirements r
    JOIN public.linkedin_discovery_cycles c ON c.id=r.discovery_cycle_id
    JOIN public.linkedin_discovery_tasks t ON t.id=r.task_id
    LEFT JOIN public.listing_states s ON s.provider=t.provider AND s.source_job_id=t.source_job_id
    LEFT JOIN public.linkedin_discovery_requirement_acceptances a
      ON (a.discovery_cycle_id,a.ingestion_run_id,a.provider,a.source_job_id,a.task_kind,a.requirement_key)
       = (r.discovery_cycle_id,r.ingestion_run_id,r.provider,r.source_job_id,r.task_kind,r.requirement_key),selected
    WHERE c.discovery_sequence <= selected.discovery_sequence AND r.required AND a.discovery_cycle_id IS NULL
      AND (t.status='terminal_unavailable' OR (t.status='complete' AND t.canonical_job_id IS NOT NULL
           AND s.canonical_job_id=t.canonical_job_id)) IS NOT TRUE
)
SELECT jsonb_build_object(
    'requested_cycle_id',(SELECT id FROM selected),
    'discovery_sequence',(SELECT discovery_sequence FROM selected),
    'search_status',(SELECT search_status FROM selected),
    'search_completed_at',(SELECT search_completed_at FROM selected),
    'covered_through_at',(SELECT min(s.source_window_latest_at) FROM public.linkedin_discovery_cycle_scopes s
                          JOIN selected ON s.discovery_cycle_id=selected.id WHERE selected.search_status='sealed'),
    'predecessor_ids',COALESCE((SELECT jsonb_agg(id ORDER BY id) FROM predecessors),'[]'),
    'coverage_debt_count',(SELECT count(*) FROM debt),
    'expired_debt_count',(SELECT count(*) FROM debt WHERE status='expired_unresolved'),
    'requirement_count',(SELECT count(*) FROM blockers),
    'distinct_task_count',(SELECT count(DISTINCT task_id) FROM blockers),
    'task_examples',COALESCE((SELECT jsonb_agg(to_jsonb(b)) FROM
                     (SELECT * FROM blockers ORDER BY discovery_cycle_id,task_id,ingestion_run_id LIMIT 10)b),'[]'),
    'actionable_tasks',public.linkedin_actionable_task_count(),
    'leased_tasks',(SELECT count(*) FROM public.linkedin_discovery_tasks WHERE status='leased'),
    'publication',(SELECT to_jsonb(p) FROM public.freehire_publication_state p WHERE id=1),
    'source_policy',(SELECT to_jsonb(p) FROM public.linkedin_source_request_policy p WHERE source='linkedin'),
    'last_request_at',(SELECT max(started_at) FROM public.linkedin_source_request_grants),
    'classification',(SELECT jsonb_build_object(
        'pending',count(*) FILTER(WHERE freehire_compat_status='pending'),
        'processing',count(*) FILTER(WHERE freehire_compat_status='processing'),
        'failed',count(*) FILTER(WHERE freehire_compat_status='failed'),
        'oldest_pending_at',min(first_seen_at) FILTER(WHERE freehire_compat_status='pending'),
        'oldest_claim_at',min(freehire_compat_claimed_at) FILTER(WHERE freehire_compat_status='processing')
    ) FROM public.jobs WHERE provider='linkedin')
);
$$;
REVOKE ALL ON FUNCTION public.linkedin_publication_diagnostics(bigint) FROM PUBLIC;
DO $$
DECLARE table_name text;
BEGIN
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='job_runner') THEN
        IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='jobs_o_linkedin_publication_diagnostics') THEN
            CREATE ROLE jobs_o_linkedin_publication_diagnostics NOLOGIN NOSUPERUSER NOBYPASSRLS;
        END IF;
        IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='jobs_o_linkedin_publication_diagnostics'
                  AND (rolcanlogin OR rolsuper OR rolbypassrls)) THEN
            RAISE EXCEPTION 'unsafe diagnostic owner';
        END IF;
        GRANT USAGE ON SCHEMA public TO jobs_o_linkedin_publication_diagnostics;
        FOREACH table_name IN ARRAY ARRAY['linkedin_discovery_cycles','linkedin_discovery_cycle_scopes',
            'linkedin_discovery_cycle_resolutions','linkedin_coverage_debt','linkedin_discovery_requirements',
            'linkedin_discovery_tasks','listing_states','linkedin_discovery_requirement_acceptances','freehire_publication_state',
            'jobs','linkedin_source_request_policy','linkedin_source_request_grants'] LOOP
            EXECUTE format('GRANT SELECT ON public.%I TO jobs_o_linkedin_publication_diagnostics',table_name);
            IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=table_name
                          AND policyname='publication_diagnostics_select') THEN
                EXECUTE format('CREATE POLICY publication_diagnostics_select ON public.%I FOR SELECT TO jobs_o_linkedin_publication_diagnostics USING(true)',table_name);
            END IF;
        END LOOP;
        GRANT EXECUTE ON FUNCTION public.linkedin_actionable_task_count() TO jobs_o_linkedin_publication_diagnostics;
        ALTER FUNCTION public.linkedin_publication_diagnostics(bigint) OWNER TO jobs_o_linkedin_publication_diagnostics;
        GRANT EXECUTE ON FUNCTION public.linkedin_publication_diagnostics(bigint) TO job_runner;
    END IF;
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
        GRANT EXECUTE ON FUNCTION public.linkedin_publication_diagnostics(bigint) TO service_role;
    END IF;
END $$;
COMMIT;
