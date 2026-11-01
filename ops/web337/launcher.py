#!/usr/bin/env python3
"""Secret-free launchd entrypoint. Runtime JSON is replaced atomically by renewal."""
import hashlib
import argparse
import json
import os
from pathlib import Path
import stat
import sys

class UnsafeConfig(Exception):
    """Deliberately contains no supplied values."""


def read_runtime_snapshot(path):
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(descriptor, 'rb') as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600:
                raise UnsafeConfig('runtime must be an owned regular mode0600 file')
            return stream.read()
    except OSError:
        raise UnsafeConfig('cannot read protected runtime') from None


def read_runtime(path, snapshot=None):
    try:
        value = json.loads(read_runtime_snapshot(path) if snapshot is None else snapshot)
        if not isinstance(value, dict):
            raise UnsafeConfig('invalid runtime object')
        return value
    except (ValueError, TypeError):
        raise UnsafeConfig('cannot read protected runtime') from None


def prepare(runtime, node, port=None, *, snapshot=None):
    snapshot = read_runtime_snapshot(runtime) if snapshot is None else snapshot
    value = read_runtime(runtime, snapshot)
    environment = value.get('environment')
    if not isinstance(environment, dict) or not all(isinstance(k, str) and isinstance(v, str) and '\0' not in k + v and '=' not in k for k, v in environment.items()):
        raise UnsafeConfig('invalid environment')
    required = ('JOB_DATA_API_URL', 'JOB_DATA_API_TOKEN', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'NODE_EXTRA_CA_CERTS')
    if any(not environment.get(key) for key in required) or environment.get('NODE_ENV') != 'production':
        raise UnsafeConfig('missing production configuration')
    allowed = set(required) | {'NODE_ENV', 'JOB_DATA_API_CONNECT_IP'}
    if set(environment) - allowed:
        raise UnsafeConfig('unapproved environment entry')
    release = Path(value.get('cwd', ''))
    executable = Path(node)
    ca = Path(environment['NODE_EXTRA_CA_CERTS'])
    selected_port = value.get('port') if port is None else port
    if type(selected_port) is not int or selected_port not in (3011, 3013):
        raise UnsafeConfig('unsupported listener port')
    if not release.is_absolute() or not (release / '.next/BUILD_ID').is_file() or not (release / 'node_modules/next/dist/bin/next').is_file():
        raise UnsafeConfig('missing release build')
    if not executable.is_absolute() or not executable.is_file() or not os.access(executable, os.X_OK) or not ca.is_absolute() or not ca.is_file():
        raise UnsafeConfig('missing executable or trust file')
    clean = {'PATH': '/usr/bin:/bin', 'HOME': str(Path.home()), 'TMPDIR': os.environ.get('TMPDIR', str(Path.home() / '.cache'))}
    clean.update(environment)
    clean['PORT'] = str(selected_port)
    clean['HOSTNAME'] = '127.0.0.1'
    command = [str(executable), str(release / 'node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', str(selected_port)]
    # Kernel startup environment survives Node's argv/title rewrite. This binding
    # is computed before exec, never accepted from the runtime or HTTP server.
    binding = dict(argv=command, runtime=os.path.realpath(runtime), runtimeSha256=hashlib.sha256(snapshot).hexdigest())
    clean['WEB337_STARTUP_SHA256'] = hashlib.sha256(json.dumps(binding, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    return command, str(release), clean


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', required=True)
    parser.add_argument('--node', required=True)
    parser.add_argument('--port', type=int, choices=(3011, 3013))
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    try:
        command, cwd, environment = prepare(args.runtime, args.node, args.port)
        if args.check:
            print('protected runtime and release validated')
            return
        os.chdir(cwd)
        os.execve(command[0], command, environment)
    except UnsafeConfig as error:
        print(str(error), file=sys.stderr)
        sys.exit(78)
    except Exception:
        print('launcher failed; inspect protected deployment locally', file=sys.stderr)
        sys.exit(70)

if __name__ == '__main__':
    main()
