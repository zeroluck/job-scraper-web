import json
import os
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch
import importlib
import shutil
import socket
import subprocess
import sys
import time


class ListenerTests(unittest.TestCase):
    @unittest.skipUnless(sys.platform == 'darwin' and shutil.which('node'), 'macOS kernel + Node required')
    def test_real_node_title_rewrite_independent_listener_attestation(self):
        import listener
        import launcher
        with socket.socket() as probe:
            try: probe.bind(('127.0.0.1', 3013))
            except OSError: self.fail('isolated integration requires unused port3013; no listener stopped')
        with tempfile.TemporaryDirectory(dir=os.environ['TMPDIR']) as directory:
            root = Path(directory)
            release = root / 'release'
            script = release / 'node_modules/next/dist/bin/next'
            script.parent.mkdir(parents=True)
            script.write_text("process.title='next-server (v15.5.14)'; require('node:http').createServer((q,s)=>s.end('fixture')).listen(3013,'127.0.0.1');")
            build = release / '.next/BUILD_ID'; build.parent.mkdir(); build.write_text('fixture')
            ca = root / 'ca'; ca.write_text('')
            runtime = root / 'runtime'
            env = dict(NODE_ENV='production', NODE_EXTRA_CA_CERTS=str(ca), JOB_DATA_API_URL='https://api.example.test', JOB_DATA_API_TOKEN='fixture', NEXT_PUBLIC_SUPABASE_URL='https://storage.example.test', NEXT_PUBLIC_SUPABASE_ANON_KEY='fixture', SUPABASE_SERVICE_ROLE_KEY='fixture')
            value = dict(cwd=str(release), port=3013, environment=env)
            original = json.dumps(value).encode()
            runtime.write_bytes(original); runtime.chmod(0o600)
            node = os.path.realpath(shutil.which('node') or '/missing/node')
            process = subprocess.Popen([sys.executable, str(Path(launcher.__file__)), '--runtime', str(runtime), '--node', node], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                for _ in range(100):
                    if process.poll() is not None: self.fail('isolated Node exited before listener proof')
                    with socket.socket() as connection:
                        if connection.connect_ex(('127.0.0.1', 3013)) == 0: break
                    time.sleep(0.05)
                else: self.fail('isolated Node did not listen')
                title = subprocess.check_output(['/bin/ps', '-p', str(process.pid), '-o', 'command='], text=True)
                self.assertIn('next-server', title)
                proof = listener.inspect(str(runtime), str(release), node)
                self.assertEqual(proof['pid'], process.pid)
                self.assertEqual(listener.inspect(str(runtime), str(release), node), proof)
                self.assertNotIn('JOB_DATA_API_TOKEN', json.dumps(proof))
                for kind in ('token', 'runtime_path', 'release', 'node'):
                    with self.subTest(kind=kind):
                        other = root / 'other-runtime'; other.write_bytes(original); other.chmod(0o600)
                        env['JOB_DATA_API_TOKEN'] = 'changed' if kind == 'token' else 'fixture'
                        runtime.write_text(json.dumps(value))
                        with self.assertRaises(ValueError):
                            listener.inspect(str(other if kind == 'runtime_path' else runtime), str(root if kind == 'release' else release), '/usr/bin/true' if kind == 'node' else node)
                        runtime.write_bytes(original)
            finally:
                process.terminate()
                try: process.wait(timeout=5)
                except subprocess.TimeoutExpired: process.kill(); process.wait(timeout=5)

    def test_kernel_listener_release_runtime_and_startup_binding(self):
        self.assertTrue(Path(__file__).with_name('listener.py').exists(), 'independent listener proof missing')
        listener = importlib.import_module('listener')
        with tempfile.TemporaryDirectory(dir=os.environ['TMPDIR']) as root:
            root = Path(root)
            release = root / 'release'
            for name in ('.next/BUILD_ID', 'node_modules/next/dist/bin/next'):
                file = release / name
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text('fixture')
            ca = root / 'ca'; ca.write_text('fixture')
            runtime = root / 'runtime'
            env = dict(NODE_ENV='production', NODE_EXTRA_CA_CERTS=str(ca), JOB_DATA_API_URL='https://api.example.test', JOB_DATA_API_TOKEN='fixture', NEXT_PUBLIC_SUPABASE_URL='https://storage.example.test', NEXT_PUBLIC_SUPABASE_ANON_KEY='fixture', SUPABASE_SERVICE_ROLE_KEY='fixture')
            runtime.write_text(json.dumps(dict(cwd=str(release), port=3013, environment=env))); runtime.chmod(0o600)
            argv = ['/usr/bin/true', str(release / 'node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', '3013']
            observed_env = listener.prepare(str(runtime), '/usr/bin/true')[2]
            def kernel(args, environment):
                return struct.pack('i', len(args)) + b'/usr/bin/true\0\0' + b'\0'.join(x.encode() for x in args) + b'\0' + b'\0'.join((k+'='+v).encode() for k,v in environment.items()) + b'\0'
            def command(args, **kwargs):
                if '-iTCP:3013' in args: return 'p42\nf12\n'
                if args[0] == '/bin/ps': return 'Sat Oct 31 10:00:00 2026\n'
                return 'p42\nfcwd\nn' + str(release) + '\nftxt\nn/usr/bin/true\n'
            with patch.object(listener.subprocess, 'check_output', side_effect=command), patch.object(listener, 'procargs', return_value=kernel(argv, observed_env)):
                proof = listener.inspect(str(runtime), str(release), '/usr/bin/true')
                self.assertEqual(proof['pid'], 42)
                self.assertEqual(proof['cwd'], str(release))
                self.assertEqual(proof['argv'], argv)
                self.assertEqual(len(proof['runtimeSha256']), 64)
                self.assertNotIn('JOB_DATA_API_TOKEN', json.dumps(proof))
                for kind in ('release', 'runtime', 'argv', 'extra_environment'):
                    bad_argv = list(argv); bad_env = dict(observed_env)
                    if kind == 'release': bad_argv[1] = '/old/node_modules/next/dist/bin/next'
                    if kind == 'runtime': bad_env['JOB_DATA_API_TOKEN'] = 'old-fixture'
                    if kind == 'argv': bad_argv[-1] = '3011'
                    if kind == 'extra_environment': bad_env['NODE_OPTIONS'] = '--require=/unapproved.js'
                    with self.subTest(kind=kind), patch.object(listener, 'procargs', return_value=kernel(bad_argv, bad_env)):
                        with self.assertRaises(ValueError): listener.inspect(str(runtime), str(release), '/usr/bin/true')
                title_argv = ['next-server (v15.5.14)'] + [''] * (len(argv) - 1)
                for kind in ('missing_binding', 'wrong_binding', 'unknown_title', 'partial_rewrite', 'wrong_port'):
                    args = list(title_argv); environment = dict(observed_env)
                    if kind == 'missing_binding': del environment['WEB337_STARTUP_SHA256']
                    if kind == 'wrong_binding': environment['WEB337_STARTUP_SHA256'] = '0' * 64
                    if kind == 'unknown_title': args[0] = 'unapproved server'
                    if kind == 'partial_rewrite': args[-1] = '3011'
                    if kind == 'wrong_port': environment['PORT'] = '3011'
                    with self.subTest(title_control=kind), patch.object(listener, 'procargs', return_value=kernel(args, environment)):
                        with self.assertRaises(ValueError): listener.inspect(str(runtime), str(release), '/usr/bin/true')
                for old, new in ((str(release), '/old-release'), ('n/usr/bin/true', 'n/usr/bin/false')):
                    with self.subTest(location=new), patch.object(listener.subprocess, 'check_output', side_effect=lambda args, **kw: command(args, **kw).replace(old, new)):
                        with self.assertRaises(ValueError): listener.inspect(str(runtime), str(release), '/usr/bin/true')
                with patch.object(listener.subprocess, 'check_output', side_effect=lambda args, **kw: 'p42\np43\n'):
                    with self.assertRaises(ValueError): listener.inspect(str(runtime), str(release), '/usr/bin/true')


if __name__ == '__main__': unittest.main()
