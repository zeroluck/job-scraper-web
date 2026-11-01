# Minimal database connection candidate

Base: `9af79fcf11559dd25a6cd72ced8df24b5ee52800`.
Reviewed published alternative: `981a5fa` (including adapter `a030917`).
This candidate is not deployed.

## Exact runtime scope

1. `src/utils/supabase/server.ts`: replace only the database URL/token environment references and missing-configuration message. Retain `@supabase/ssr`, `await cookies()`, `getAll`, `setAll`, and the original read-only Server Component catch unchanged.
2. `src/utils/supabase/service.ts`: replace only the database URL/token environment references and error. Retain the original Supabase SDK and auth options; cached insights/configuration inherit this factory.
3. `src/utils/supabase/storage.ts`: copy the original cookie-bound server factory verbatim, changing only its exported function name to `createSupabaseStorageClient`. This preserves the original hosted Storage authentication/cookie semantics rather than substituting a new stateless service client.
4. `src/lib/supabase/storage.ts`: select that retained Storage factory for signing.
5. `src/lib/supabase/queries.ts`: select that retained Storage factory only inside `uploadPersonalizedResume`. Keep a lazy import so existing query tests do not eagerly import Next request helpers.

Verification-only addition: `scripts/minimal-cutover.test.mjs`. Documentation: this file.
No package/lock changes, direct PostgREST client, transport dependency, page `force-dynamic` additions, runtime descriptors, supervisor code, launchd definitions or helper redesign. The original `cookies()` call already maintains request-time rendering, so the published adapter's page changes are unnecessary here. The unused original browser helper remains unchanged; no application consumer imports it.

## Configuration contract

- `JOB_DATA_API_URL=https://data.example.test`: **origin only**, without `/rest/v1`, query, fragment or credentials. The original Supabase SDK appends `/rest/v1` itself. Unlike the broader published adapter, this candidate does not accept a PostgREST path as configuration and does not implement `JOB_DATA_API_CONNECT_IP`.
- `JOB_DATA_API_TOKEN`: approved server-only web runtime bearer. No fallback to old database credentials.
- Keep actual hosted `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` unchanged for Storage and the unused browser helper.
- Export `NODE_EXTRA_CA_CERTS` in the launching process environment **before Node starts**; loading it only through Next's `.env.local` is too late. Preserve certificate verification, SNI and Host identity.
- Ordinary DNS must resolve the data hostname correctly from the application host. Do not replace its HTTPS hostname with an IP or change global DNS without review. If DNS cannot be legitimately repaired, a separately reviewed, data-origin-scoped connection override is a connection prerequisite, not justification for adopting the broader adapter or disabling TLS verification.
- Original SSR cookie behavior is deliberately retained, not qualified against all possible authenticated browser sessions. An applicable Supabase session cookie can affect SDK authentication; qualify actual browser sessions/empty-cookie requests against the approved web role before activation. Do not silently disable cookies to avoid this gate.

## Isolated verification

Use a separate clean source copy, never any active server's `.next`:

```sh
npm ci --ignore-scripts --no-audit --no-fund
node --test scripts/minimal-cutover.test.mjs
npm run typecheck
npm test
JOB_DATA_API_URL=https://data.invalid \
JOB_DATA_API_TOKEN=inert-data-token \
NEXT_PUBLIC_SUPABASE_URL=https://storage.invalid \
NEXT_PUBLIC_SUPABASE_ANON_KEY=inert-anon-key \
SUPABASE_SERVICE_ROLE_KEY=inert-storage-key \
NEXT_TELEMETRY_DISABLED=1 npm run build
```

The focused tests use the actual installed original SDK with an inert fetch transport for table/RPC paths, bearer isolation, retained Storage signing/upload, and a request-cookie boundary double for callbacks. No external requests or database writes are authorized by these tests. Compare full-suite failures with the unchanged base; do not claim a green suite when baseline failures persist. Inspect the build's route report and prerender manifest: data-backed pages must remain dynamic without adding page declarations.

An inert build is **not deployable as-is**: `NEXT_PUBLIC_*` Storage values are compiled into chunks. Build the eventual separate release with real retained public Storage configuration and inert privileged data/Storage credentials; then qualify the actual built signing route and signed download with runtime credentials.

## Startup and rollback gates (no activation here)

Before replacing the existing listener, identify its real supervisor/start mechanism, original Node executable, release cwd, built artifact, original launch environment/CA and a reproducible rollback command without disclosing secrets. A build ID and checkout HEAD do not attest which source produced an existing artifact. Preserve the actual old artifact and protected configuration outside any build output that might be overwritten; do not assume rebuilding current HEAD recreates it. PPID 1 alone does not prove launchd management.

Start only an authorized separately built canary, with the proper CA present before process startup, approved runtime role and corrected DNS or reviewed scoped transport. Qualify target database identity, real SDK reads/RPCs, denied invalid tokens, actual browser cookie behavior, representative built UI routes, and retained Storage signing/download. Only the migration authority may authorize target write activation; an inert build/fake transport is not target acceptance.

Before target writes, restoring the attested original release/configuration is application rollback. Once writes occur, reconcile target database mutations before a data-authority reversal; a process restart is not data rollback. Keep hosted Storage unchanged throughout and account separately for object writes. Existing source writer fences must not be removed by this candidate.

Respect any gateway prohibition on `launchctl bootstrap`/`submit`; do not bypass it with another launch verb. Deployment, restart, login/crash recovery and rollback execution remain unverified here. Missing original startup/rollback provenance and host connectivity are actual cutover blockers, not reasons to redesign the application.
