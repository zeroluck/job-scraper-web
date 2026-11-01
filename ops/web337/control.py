#!/usr/bin/env python3
"""Explicit supervisor control. Run from an authorized shell outside the gateway."""
import argparse
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
import plistlib
import stat
from supervisor import definition, EXPECTED_LABEL
from launcher import prepare, read_runtime_snapshot




def validate_logs(value, protected):
    for key in ('StandardOutPath', 'StandardErrorPath'):
        path = Path(value.get(key, ''))
        if not path.is_absolute():
            raise ValueError('unsafe log path')
        parent = path.parent.lstat()
        if (not stat.S_ISDIR(parent.st_mode) or parent.st_uid != os.getuid() or
                stat.S_IMODE(parent.st_mode) != 0o700):
            raise ValueError('unsafe log directory')
        if path.resolve() in {Path(p).resolve() for p in protected}:
            raise ValueError('log aliases protected input')
        try:
            info = path.lstat()
        except FileNotFoundError:
            continue
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or
                stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink != 1):
            raise ValueError('unsafe existing log')


def validate_identity(args, require_loaded=True):
    if args.label != EXPECTED_LABEL:
        raise ValueError('unexpected service label')
    if not all(Path(p).is_absolute() for p in (args.plist, args.runtime, args.node, args.release)):
        raise ValueError('absolute identity paths required')
    command, cwd, environment = prepare(args.runtime, args.node)
    if cwd != args.release or command[-1] != '3011':
        raise ValueError('unexpected release or port')
    fd = os.open(args.plist, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o022:
            raise ValueError('unsafe plist')
        value = plistlib.load(stream)
    protected = [args.runtime, args.plist, args.node, str(Path(__file__).with_name('launcher.py')),
                 environment['NODE_EXTRA_CA_CERTS']]
    if args.rollback_runtime:
        protected.append(args.rollback_runtime)
    validate_logs(value, protected)
    expected = definition(EXPECTED_LABEL, str(Path(__file__).resolve().with_name('launcher.py')),
                          args.runtime, args.node, value.get('StandardOutPath', ''), value.get('StandardErrorPath', ''))
    if value != expected:
        raise ValueError('unexpected plist identity')
    result = subprocess.run(['/bin/launchctl', 'print', target(args.label)], check=False, capture_output=True, text=True)
    if result.returncode:
        if not require_loaded and result.returncode == 113 and 'Could not find service' in result.stderr:
            return
        raise ValueError('cannot verify loaded identity')
    text = result.stdout
    def scalar(key):
        matches = re.findall(r'^\s*' + key + r' = (.+)$', text, re.M)
        if len(matches) != 1:
            raise ValueError('ambiguous loaded identity')
        return matches[0]
    blocks = re.findall(r'^\s*arguments = \{\n(.*?)^\s*\}', text, re.M | re.S)
    if (scalar('path') != args.plist or scalar('program') != '/usr/bin/python3' or
            scalar('stdout path') != expected['StandardOutPath'] or scalar('stderr path') != expected['StandardErrorPath'] or len(blocks) != 1 or
            [line.strip() for line in blocks[0].splitlines() if line.strip()] != expected['ProgramArguments']):
        raise ValueError('unexpected loaded identity')
    if not require_loaded:
        raise ValueError('service already loaded')



def authorized(action, approved):
    return action == 'restart' or action in ('activate', 'rollback') and approved


def target(label):
    if not re.fullmatch(r'[A-Za-z0-9.-]+', label):
        raise ValueError('invalid label')
    return 'gui/' + str(os.getuid()) + '/' + label


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('activate', 'restart', 'rollback'))
    parser.add_argument('--approved', action='store_true', help='DB promotion/access accepted; existing listener separately stopped after identity check')
    parser.add_argument('--label', required=True)
    parser.add_argument('--plist', required=True)
    parser.add_argument('--runtime', required=True)
    parser.add_argument('--release', required=True, help='independently selected immutable release')
    parser.add_argument('--node', required=True)
    parser.add_argument('--rollback-runtime', help='owned mode0600 known-good runtime; never rolls back database writes')
    args = parser.parse_args()
    if not authorized(args.action, args.approved):
        parser.error('production action requires explicit acceptance')
    service = target(args.label)
    validate_identity(args, require_loaded=args.action != 'activate')
    if args.action == 'rollback':
        if not args.rollback_runtime:
            parser.error('rollback requires an explicit previously qualified runtime')
        snapshot = read_runtime_snapshot(args.rollback_runtime)
        command, cwd, _ = prepare(args.rollback_runtime, args.node, snapshot=snapshot)
        if cwd != args.release or command[-1] != '3011':
            raise ValueError('unexpected rollback identity')
        destination = Path(args.runtime)
        temp = destination.with_name(destination.name + '.rollback.' + str(os.getpid()))
        validate_identity(args)
        descriptor = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        try:
            with os.fdopen(descriptor, 'wb') as stream:
                stream.write(snapshot)
                stream.flush(); os.fsync(stream.fileno())
            os.replace(temp, destination)
        finally:
            if temp.exists(): temp.unlink()
    prepare(args.runtime, args.node, 3011)
    if args.action == 'activate':
        with socket.socket() as connection:
            if connection.connect_ex(('127.0.0.1', 3011)) == 0:
                parser.error('port3011 occupied; no process was stopped')
        validate_identity(args, require_loaded=False)
        subprocess.run(['/bin/launchctl', 'bootstrap', 'gui/' + str(os.getuid()), args.plist], check=True, capture_output=True, text=True)
    else:
        validate_identity(args)
        subprocess.run(['/bin/launchctl', 'kickstart', '-k', service], check=True, capture_output=True, text=True)
    validate_identity(args)

if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('supervisor operation failed; inspect locally without disclosing runtime', file=sys.stderr)
        sys.exit(1)
