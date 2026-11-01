"""Render secret-free per-user launchd definitions; does not load services."""
from pathlib import Path
EXPECTED_LABEL = 'com.zeroluck.job-scraper-web337'


def definition(label, helper, runtime, node, stdout, stderr, port=3011):
    if label != EXPECTED_LABEL:
        raise ValueError('unexpected service label')
    if port not in (3011, 3013) or not all(Path(p).is_absolute() for p in (helper, runtime, node, stdout, stderr)):
        raise ValueError('absolute paths and an approved loopback port are required')
    return {
        'Label': label,
        'ProgramArguments': ['/usr/bin/python3', helper, '--runtime', runtime, '--node', node, '--port', str(port)],
        'RunAtLoad': True,
        'KeepAlive': True,
        'ThrottleInterval': 30,
        'ExitTimeOut': 30,
        'ProcessType': 'Background',
        'Umask': 0o077,
        'StandardOutPath': stdout,
        'StandardErrorPath': stderr,
    }
