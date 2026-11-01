# Private web runtime supervision

`launcher.py` reads an owned regular mode0600 runtime JSON through `O_NOFOLLOW`,
validates its environment allowlist and release, and execs a pinned Node binary.
Node receives `NODE_EXTRA_CA_CERTS` before startup. Only loopback ports3011 and3013
are supported. Restart rereads runtime, including an atomically renewed token.
Never put actual endpoints, secrets, runtime JSON, deployment receipts or plists
containing local paths in Git.

Runtime schema (outside Git):

```json
{
  "cwd": "/absolute/immutable/release",
  "port": 3011,
  "token_expires_at": "renewal-managed metadata",
  "environment": {
    "NODE_ENV": "production",
    "JOB_DATA_API_URL": "https://api.example.test",
    "JOB_DATA_API_TOKEN": "REPLACE_OUTSIDE_GIT",
    "JOB_DATA_API_CONNECT_IP": "192.0.2.10",
    "NODE_EXTRA_CA_CERTS": "/absolute/protected/trust.pem",
    "NEXT_PUBLIC_SUPABASE_URL": "https://storage.example.test",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY": "REPLACE_OUTSIDE_GIT",
    "SUPABASE_SERVICE_ROLE_KEY": "REPLACE_OUTSIDE_GIT"
  }
}
```

Use a mode0700 runtime parent and mode0600 runtime/trust/log files. Renewal must
preserve `cwd`, `port`, trust configuration and Storage credentials, write a new
mode0600 file in the same directory, fsync, then `os.replace`. Call `restart`
after replacement. No credentials belong in argv, launchd environment or logs.
Logs are private because upstream application errors may contain object paths.

`supervisor.definition(...)` produces a secret-free LaunchAgent plist with pinned
Python/helper/Node paths, `RunAtLoad`, `KeepAlive`, 30-second throttle, private log
paths and umask0077. Per-user LaunchAgents restart at user login, not at unattended
machine boot before login. Do not claim boot-time service availability.

## Release and qualification

1. Archive a reviewed commit into a new release directory; install exact locked
   dependencies there. Never build in an active dev/canary checkout.
2. Build with the **actual public Storage URL and anon key**. Next.js inlines
   `NEXT_PUBLIC_*`; an inert-only build is NOT deployable even when direct SDK
   Storage reads succeed. Keep privileged runtime tokens out of build environment;
   use inert API URL/token and inert service key. Protect local build logs.
3. Hash tracked source and built artifacts, exclude mutable `.next/cache` from
   artifact hashes, record commit and BUILD_ID outside Git. Do not rebuild a
   deployed release. A changed public Storage URL requires a new release.
4. Start launcher with `--port 3013`; never switch3011 before parent DB promotion
   and access acceptance. Qualify with:

```sh
NODE_EXTRA_CA_CERTS="$TRUST" "$NODE" --conditions=react-server --experimental-strip-types \
  "$HELPERS/qualify.mjs" "$RUNTIME" "$RECEIPT" \
  original_database_pre_promotion_not_final_candidate "$RELEASE" "$NODE" "$SIGNING_FIXTURE"
```

The qualifier requires an independently selected absolute `$RELEASE`; it must match
runtime `cwd` before any executable imports. Runtime is an owned regular mode0600
no-follow descriptor snapshot with an explicit environment allowlist. Receipts use
atomic mode0600 replacements in an owned mode0700 directory; unsafe existing files
and symlinks are refused. Before every write, canonical paths and existing file
identities must be disjoint from runtime, signing fixture and runtime-selected
`NODE_EXTRA_CA_CERTS`, including normalized paths, trust symlinks, hardlinks and
ancestor aliases. Trust is discovered from a protected runtime descriptor before
any receipt, even when later schema checks fail; unreadable/malformed runtime or
indeterminate trust fails closed **without a diagnostic receipt**. Previously
observed trust paths remain protected if runtime is renewed during qualification.
The audit also protects pinned/running Node, Python and listener inspection tools,
qualifier/listener/launcher helpers, release package/build/Next/data inputs and the
resolved Storage SDK entrypoint (including an external symlink target). Receipts
must remain outside canonical release and helper trees, including absent files.
This is an owner-trusted immutable-release guard, not a defense against concurrent
same-user filesystem mutation or arbitrary executable dependency graph changes.
Failed exclusive temporary-file creation never unlinks an existing file. All these
guards repeat before temporary creation and atomic rename, including failure and
final listener-check receipts.
Missing signing/download fixtures fail qualification.

`$NODE` is the independently selected absolute pinned executable, not a value
supplied by the HTTP server. Before imports or HTTP checks, `listener.py` uses
macOS `lsof` to identify the unique port3013 listener PID, cwd and executable,
`ps` for process start identity, and kernel `KERN_PROCARGS2` for startup argv and
environment. Before exec, the launcher adds `WEB337_STARTUP_SHA256`, binding the
exact launch argv, canonical runtime path and validated runtime byte hash. This
marker is derived by the launcher, not supplied by runtime JSON or the HTTP server.
The independent inspector recomputes it from its own protected snapshot and
requires it in the kernel startup environment, alongside the runtime values.
Original argv must match, or be a fully zero-padded Next `next-server (vX.Y.Z)`
title rewrite. Unknown titles and partial rewrites fail. The kernel Apple vector
following the environment terminator is not confused with environment entries.
Release cwd, pinned executable and unique listener PID are checked separately;
extra environment entries are refused. No runtime environment values are emitted.
The receipt binds PID/start identity, cwd, executable, expected startup argv,
startup-binding hash, argv evidence source and runtime SHA256. The qualifier
compares the runtime hash with its own descriptor snapshot, then repeats inspection
after all checks (including failures). This is owner-trusted startup evidence, not
an authenticated defense against malicious code running as the same user.
Changed or unverifiable evidence fails qualification. Existing processes must be
started through the updated launcher; no missing-marker fallback is accepted.
The macOS integration test uses a real isolated Node HTTP listener with an actual
title rewrite and real kernel/lsof/ps inspection, not a Next build or deployed app.
No launchd commands are used by qualification. API job detail must contain the
selected `job_id`, not merely return HTTP200.

`$SIGNING_FIXTURE` is a required owned regular mode0600 no-follow JSON file in a
private directory **outside Git**. Its schema is
`{"resumeId":"KNOWN_RETAINED_RESUME_ID","objectName":"KNOWN_RETAINED_OBJECT_PATH"}`.
Select a known retained resume with a valid `resume_link` and an existing nonempty
object in `personalized_resumes`; do not assume an arbitrary first database row
or first listed object is signable. The qualifier filters resume metadata by this
ID, requires the exact object basename in its directory, downloads that exact
object and exercises the signing route for that exact resume. Fixture values,
object paths and signed URLs are never emitted in results. Keep this fixture and
all qualification receipts outside the repository.

The qualifier performs no data/object mutations: authenticated metadata reads,
invalid-token rejection, retained object download, representative UI/API reads and
Storage signed-download route. Signed URL creation does not mutate stored objects.
Do not use a successful pre-promotion run as final candidate acceptance. The parent
must independently identify the database authority and rerun against the promoted
API. `finalCandidateQualified` stays false intentionally; final DB acceptance is
not asserted by this script.

## Switch, restart, rollback

Run authorized launchd maintenance in a shell outside any gateway that prohibits
`launchctl bootstrap`. Never bypass such a restriction using another launch verb.

Before activation, validate runtime with `launcher.py ... --check`, inspect3011's
PID/cwd and capture its exact rollback supervisor/start command. Stop ONLY the
confirmed old3011 listener after DB acceptance; never stop3000 or3012. The control
script refuses activation while3011 is occupied and never kills a listener.

```sh
python3 "$HELPERS/control.py" activate --approved --label "$LABEL" \
  --plist "$PLIST" --runtime "$RUNTIME" --node "$NODE" --release "$RELEASE"
python3 "$HELPERS/control.py" restart --label "$LABEL" \
  --plist "$PLIST" --runtime "$RUNTIME" --node "$NODE" --release "$RELEASE"
python3 "$HELPERS/control.py" rollback --approved --label "$LABEL" \
  --plist "$PLIST" --runtime "$RUNTIME" --node "$NODE" --release "$RELEASE" \
  --rollback-runtime "$PREVIOUS_QUALIFIED_RUNTIME"
```

`LABEL` must be exactly `com.zeroluck.job-scraper-web337` (the prepared identity;
no service identity migration). Renderer and control both reject other labels. Control requires an independently
selected `--release`, exact helper/runtime/Node/port3011 plist arguments and matching
loaded service program/arguments/plist path. Unverifiable identity fails closed
before each mutation. Both log parents must be owned mode0700 directories; existing
logs must be owned regular single-link mode0600 files, never symlinks or protected
inputs. These checks repeat before activation, restart and rollback, and loaded
stdout/stderr paths must match the validated plist. Umask alone cannot make old
public logs private. Subprocess output is captured rather than disclosed.

Rollback validates an explicit known-good runtime descriptor snapshot and copies
those exact validated bytes (never reopens the source path), atomically replaces
runtime and restarts the loaded service. Rollback must retain the selected release
and port3011 identity. It does not roll back database mutations. After target
writes, reconcile DB/Storage first; do not blindly restore the previous authority.
If initial activation fails, unload the new service from the external shell and
restore the captured original supervisor/start command, preserving3000's shared
`.next`. Never invent a previous qualified runtime when one was not captured.

After each action read back launchd state, exact listener PID/cwd, UI/API/Storage
checks. To qualify real recovery, terminate only the supervised canary PID and
observe a replacement listener with the same release/runtime. Merely linting the
plist does not qualify launchd bootstrap, crash recovery, or login persistence.

Run safety tests: `python3 -m unittest discover -s ops/web337 -p 'test_*.py'`.
