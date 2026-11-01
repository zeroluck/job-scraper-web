#!/usr/bin/env python3
"""Read-only macOS listener evidence. No secrets or process environment are emitted."""
import ctypes
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import subprocess
import sys
from launcher import prepare, read_runtime_snapshot


def procargs(pid):
    # KERN_PROCARGS2 returns executable, original argv and environment from the kernel.
    libc = ctypes.CDLL('/usr/lib/libSystem.B.dylib', use_errno=True)
    mib = (ctypes.c_int * 3)(1, 49, pid)
    size = ctypes.c_size_t(1024 * 1024)
    buffer = ctypes.create_string_buffer(size.value)
    if libc.sysctl(mib, 3, buffer, ctypes.byref(size), None, 0) != 0:
        raise ValueError('kernel process evidence unavailable')
    return buffer.raw[:size.value]


def inspect(runtime, release, node):
    snapshot = read_runtime_snapshot(runtime)
    argv, cwd, expected_env = prepare(runtime, node, snapshot=snapshot)
    if cwd != release or argv[-1] != '3013' or json.loads(snapshot)['port'] != 3013:
        raise ValueError('unexpected runtime identity')
    def output(command):
        return subprocess.check_output(command, text=True, stderr=subprocess.DEVNULL, timeout=10).strip()
    pids = [line for line in output(['/usr/sbin/lsof', '-nP', '-iTCP:3013', '-sTCP:LISTEN', '-Fp']).splitlines() if line.startswith('p')]
    if len(pids) != 1 or not pids[0].startswith('p') or not pids[0][1:].isdigit():
        raise ValueError('ambiguous listener')
    pid = int(pids[0][1:])
    started = output(['/bin/ps', '-p', str(pid), '-o', 'lstart='])
    files = output(['/usr/sbin/lsof', '-a', '-p', str(pid), '-d', 'cwd,txt', '-Fn']).splitlines()
    current = None
    locations = {}
    for line in files:
        if line.startswith('f'): current = line[1:]
        if line.startswith('n'): locations.setdefault(current, []).append(line[1:])
    if locations.get('cwd') != [release] or os.path.realpath(node) not in locations.get('txt', []):
        raise ValueError('listener release or executable mismatch')
    raw = procargs(pid)
    argc = struct.unpack_from('i', raw)[0]
    if not 0 < argc < 1024: raise ValueError('invalid kernel argv')
    offset = raw.index(b'\0', 4) + 1
    while offset < len(raw) and raw[offset] == 0: offset += 1
    entries = raw[offset:].split(b'\0')
    actual_argv = [item.decode() for item in entries[:argc]]
    actual_env = {}
    remaining = iter(entries[argc:])
    for item in remaining:
        if item: break
    else:
        raise ValueError('missing kernel environment')
    while item:
        key, separator, value = item.decode().partition('=')
        if not separator or key in actual_env: raise ValueError('ambiguous kernel environment')
        actual_env[key] = value
        item = next(remaining, b'')
    # KERN_PROCARGS2 has an Apple vector after the environment's terminating NUL;
    # it is kernel metadata, not additional environment supplied to Node.
    rewritten = (len(actual_argv) == len(argv) and
                 re.fullmatch(r'next-server \(v[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?\)', actual_argv[0]) and
                 all(not item for item in actual_argv[1:]))
    if set(actual_env) - set(expected_env) or not (actual_argv == argv or rewritten) or any(actual_env.get(key) != value for key, value in expected_env.items() if key not in ('PATH', 'HOME', 'TMPDIR')):
        raise ValueError('listener startup or runtime mismatch')
    if not started or read_runtime_snapshot(runtime) != snapshot:
        raise ValueError('runtime changed during proof')
    return dict(pid=pid, started=started, cwd=release, node=os.path.realpath(node), argv=argv,
                runtimeSha256=hashlib.sha256(snapshot).hexdigest(),
                startupBindingSha256=actual_env['WEB337_STARTUP_SHA256'],
                argvEvidence='launcher_kernel_environment' if rewritten else 'kernel_argv')


if __name__ == '__main__':
    try:
        print(json.dumps(inspect(*sys.argv[1:])))
    except Exception:
        print('listener evidence unavailable or mismatched', file=sys.stderr)
        sys.exit(1)
