# Database / Storage separation (cutover337)

## Runtime configuration

- `JOB_DATA_API_URL=https://data.example.test` is the approved HTTP(S) origin; the data client appends `/rest/v1`. An explicit `https://data.example.test/rest/v1` endpoint is also accepted, with an optional single trailing slash. Other paths, credentials, query strings and fragments are rejected without echoing the URL.
- Optional `JOB_DATA_API_CONNECT_IP` accepts only a numeric IPv4 or IPv6 address (no brackets, zone, port or whitespace). With it enabled, the data API URL must use HTTPS and a DNS hostname; the original URL remains unchanged, preserving HTTP Host, TLS SNI and certificate hostname verification. A data-only undici Agent supplies the connection lookup; redirects are rejected. No global DNS/fetch/dispatcher or Storage client is changed. Leave it unset/empty for ordinary DNS. This is a per-process configuration, not browser configuration; keep the reviewed CA configured at Node startup even when using the IP override.
- `JOB_DATA_API_TOKEN` is the server-only, least-privileged `job_web` bearer credential. Never prefix it or the Storage service key with `NEXT_PUBLIC_`. Database configuration fails closed; there is no source fallback.
- Keep `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` pointing at the original Supabase project for Storage. Do not replace these with the data endpoint/token.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` belongs only to the pre-existing unused browser helper; no database consumer imports it.
- Configure the Node process environment **before Node starts**, not merely `.env.local` (Next loads that after Node's trust initialization):

  ```sh
  export NODE_EXTRA_CA_CERTS=/path/to/reviewed-data-api-ca.crt
  npm run build
  npm start
  ```

  On another host install the same reviewed public CA certificate at a readable host-local path and set that path in the process supervisor. Do not disable certificate or hostname verification. No certificate or token is bundled into the browser.

## Consumer inventory

| Consumer | Routing |
| --- | --- |
| `src/lib/supabase/queries.ts`: lists, counts, membership/search/insight RPCs, details, job/application updates, resume metadata, profile reads/writes | Existing default server factory -> `createJobDataClient()` |
| `src/lib/config/repository.ts`: configuration reads, replacement CAS, discovery status | Existing service factory -> `createJobDataClient()` |
| `src/lib/supabase/cached{Keyword,Location,Title}Insights.ts` | Existing service factory -> `createJobDataClient()`; existing outer cache remains |
| `queries.ts::uploadPersonalizedResume` | New Storage-only factory; original `personalized_resumes` bucket, unchanged path and upsert |
| `src/lib/supabase/storage.ts::getSignedUrl` | New Storage-only factory; unchanged bucket/path/expiry/signing semantics |
| Pages / API routes | Inherit the query/repository routing above |

`src/utils/supabase/data.ts` uses the stateless Supabase PostgREST SDK directly, not Supabase Auth/SSR. No cookie/session, Auth, realtime or Storage capability is exposed. `server.ts` / `service.ts` retain compatibility names but no longer use a Supabase service-role DB connection. `storage.ts` exposes only `.storage`, not `.from` / `.rpc`.

Data-backed pages explicitly use `force-dynamic`: removing the old `cookies()` call otherwise accidentally makes `/` and `/profile` execute database queries during prerendering and can bake stale data into static output.

## Safe verification and activation boundary

```sh
node --experimental-strip-types --test src/utils/supabase/*.test.ts
npm run typecheck
npm run lint
npm test
npm run build
```

Focused tests exercise real SDK request construction with a fake fetch transport (no external writes), source/target bearer isolation, uploads/signing, configuration reads/replacement, fail-closed configuration, server-only protection and page/legacy-credential routing guards. Build with inert `.example.test` endpoints and placeholder tokens to prove no build-time DB dependency or secret values are required. Existing baseline test failures must be reported separately; do not call the full suite green.

This change does not enable target writes or change server transaction policy. Parent cutover must fence source database writers, synchronize, verify target grants without broadening `job_web`, switch target policy only at the approved gate, configure the real web supervisor, then exercise reads/writes and retained Storage from that host. Mandatory rollback-only target mode cannot qualify persistence. Before target writes, rollback can restore the old code/configuration; after writes, reconcile target database mutations before reverting. Storage remains on Supabase throughout.

## Release qualification and deployment boundary

Run the commands above in an isolated checkout. Do not rebuild `.next` in any checkout used by an active server, including a canary. Use only reserved example URLs and placeholder credentials for build qualification. Keep actual deployment hostnames, private addresses, credentials, machine-specific paths and runtime receipts outside Git.

The connection-override test uses a temporary loopback HTTPS server and ephemeral SAN certificate. It checks trusted TLS, untrusted-CA and wrong-hostname rejection before HTTP, original Host/SNI, actual connection-address selection, rejected redirects, unchanged global DNS/fetch and retained Storage transport. Temporary keys are removed in a finally block.

Before an authorized deployment, discover the production listener, its complete parent chain and cwd, and verify its supervisor read-only. PPID 1 alone does not prove launchd ownership. If no supervisor is identified, define and review a dedicated launchd LaunchAgent for the current macOS host (or a systemd unit if deployment moves to Linux); do not guess a service label or kill all Node processes. Use a fixed immutable release cwd, protected runtime configuration, Node CA settings applied before startup, bounded health checks, captured logs and a preserved rollback release. Leave development listeners untouched.

Start a separately built loopback canary only after authorization. Verify target-backed reads, least-privileged authorization and retained Storage; qualify writes only after the migration owner's source fence, final synchronization, grants and rollback gates pass. This adapter review alone does not establish authenticated target connectivity, target durability, successful cutover or unattended supervision.

Dependency audit findings and baseline failures must be reported with the actual release test output. Do not run an automatic dependency fix as part of this migration-specific change.
