-- Trigger execution does not require callers to execute the trigger function.
REVOKE ALL ON FUNCTION public.sync_job_location_buckets()
  FROM public, anon, authenticated, service_role;
