import importlib.util
import json
import os
from pathlib import Path
import plistlib
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import control
import supervisor


class IdentityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=os.environ.get('TMPDIR', str(Path.home() / '.hermes/cache/scratch')))
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.release = self.root / 'release'
        for name in ('.next/BUILD_ID', 'node_modules/next/dist/bin/next'):
            p = self.release / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text('fixture')
        self.ca = self.root / 'ca'
        self.ca.write_text('fixture')
        self.runtime = self.root / 'runtime'
        self.value = {'cwd': str(self.release), 'port': 3011, 'environment': {
            'NODE_ENV': 'production', 'NODE_EXTRA_CA_CERTS': str(self.ca),
            'JOB_DATA_API_URL': 'https://api.example.test', 'JOB_DATA_API_TOKEN': 'fixture',
            'NEXT_PUBLIC_SUPABASE_URL': 'https://storage.example.test',
            'NEXT_PUBLIC_SUPABASE_ANON_KEY': 'fixture', 'SUPABASE_SERVICE_ROLE_KEY': 'fixture'}}
        self.runtime.write_text(json.dumps(self.value)); self.runtime.chmod(0o600)
        self.label = 'com.zeroluck.job-scraper-web337'
        self.plist = self.root / 'service.plist'
        self.definition = supervisor.definition(self.label, str(Path(control.__file__).with_name('launcher.py')),
            str(self.runtime), '/usr/bin/true', str(self.root / 'out'), str(self.root / 'err'))
        self.save_plist()
        self.calls = []

    def save_plist(self):
        self.plist.write_bytes(plistlib.dumps(self.definition))

    def loaded(self):
        return ('path = ' + str(self.plist) + '\nprogram = /usr/bin/python3\narguments = {\n' + '\n'.join(self.definition['ProgramArguments']) + '\n}\n'
                + 'stdout path = ' + self.definition['StandardOutPath'] + '\nstderr path = ' + self.definition['StandardErrorPath'] + '\n')

    def run_control(self, action='restart', extra=(), runner=None):
        def fake_run(command, **kwargs):
            self.calls.append(command)
            if runner: return runner(command, **kwargs)
            return subprocess.CompletedProcess(command, 0, self.loaded(), '')
        argv = ['control.py', action, '--label', self.label, '--plist', str(self.plist),
                '--runtime', str(self.runtime), '--node', '/usr/bin/true', '--release', str(self.release), *extra]
        with patch.object(sys, 'argv', argv), patch.object(control.subprocess, 'run', side_effect=fake_run):
            control.main()

    def test_unsafe_logs_block_all_actions_before_supervisor_access(self):
        for kind in ('public_file', 'symlink', 'directory', 'fifo', 'public_parent'):
            for action in ('activate', 'restart', 'rollback'):
                with self.subTest(kind=kind, action=action):
                    log = self.root / 'unsafe'
                    if log.is_symlink() or log.is_file() or log.exists() and not log.is_dir(): log.unlink()
                    if log.is_dir(): log.rmdir()
                    self.root.chmod(0o700)
                    if kind == 'public_file': log.write_text('preserve'); log.chmod(0o644)
                    if kind == 'symlink': log.symlink_to(self.runtime)
                    if kind == 'directory': log.mkdir()
                    if kind == 'fifo': os.mkfifo(log, 0o600)
                    if kind == 'public_parent': self.root.chmod(0o755)
                    self.definition['StandardOutPath'] = str(log)
                    self.save_plist()
                    self.calls.clear()
                    with self.assertRaises(ValueError):
                        self.run_control(action, ['--approved', '--rollback-runtime', str(self.runtime)])
                    self.assertEqual(self.calls, [])
        self.root.chmod(0o700)

    def test_stderr_and_protected_log_aliases_are_rejected(self):
        for kind in ('public_stderr', 'runtime_alias', 'runtime_hardlink', 'parent_symlink'):
            with self.subTest(kind=kind):
                log = self.root / ('log-' + kind)
                if kind == 'public_stderr': log.write_text('preserve'); log.chmod(0o644)
                if kind == 'runtime_alias': log = self.runtime
                if kind == 'runtime_hardlink': os.link(self.runtime, log)
                if kind == 'parent_symlink':
                    log.symlink_to(self.root, target_is_directory=True)
                    log = log / 'err'
                self.definition['StandardErrorPath'] = str(log)
                self.save_plist()
                with self.assertRaises(ValueError): self.run_control()
                self.assertEqual(self.calls, [])

    def test_ca_log_aliases_block_all_actions_before_supervisor_access(self):
        self.ca.chmod(0o600)
        original = self.ca.read_bytes()
        for action in ('activate', 'restart', 'rollback'):
            for key in ('StandardOutPath', 'StandardErrorPath'):
                for kind in ('direct', 'normalized', 'symlink', 'hardlink', 'ancestor_symlink', 'input_symlink'):
                    with self.subTest(action=action, key=key, kind=kind):
                        alias = self.root / 'ca-alias'
                        normal = self.root / 'normal'
                        normal.mkdir(exist_ok=True)
                        log = self.ca
                        if kind == 'normalized': log = normal / '..' / self.ca.name
                        if kind == 'symlink': alias.symlink_to(self.ca); log = alias
                        if kind == 'hardlink': os.link(self.ca, alias); log = alias
                        if kind == 'ancestor_symlink':
                            alias.symlink_to(self.root, target_is_directory=True); log = alias / self.ca.name
                        if kind == 'input_symlink':
                            alias.symlink_to(self.ca)
                            self.value['environment']['NODE_EXTRA_CA_CERTS'] = str(alias)
                            self.runtime.write_text(json.dumps(self.value))
                        previous = self.definition[key]
                        self.definition[key] = str(log)
                        self.save_plist()
                        self.calls.clear()
                        try:
                            with self.assertRaises(ValueError):
                                self.run_control(action, ['--approved', '--rollback-runtime', str(self.runtime)])
                            self.assertEqual(self.calls, [])
                            self.assertEqual(self.ca.read_bytes(), original)
                        finally:
                            if alias.exists() or alias.is_symlink(): alias.unlink()
                            self.value['environment']['NODE_EXTRA_CA_CERTS'] = str(self.ca)
                            self.runtime.write_text(json.dumps(self.value))
                            self.definition[key] = previous

    def test_supplied_rollback_runtime_log_aliases_block_all_actions(self):
        source = self.root / 'rollback'
        original = self.runtime.read_bytes()
        source.write_bytes(original); source.chmod(0o600)
        for action in ('activate', 'restart', 'rollback'):
            for key in ('StandardOutPath', 'StandardErrorPath'):
                for kind in ('direct', 'normalized', 'symlink', 'hardlink', 'ancestor_symlink', 'input_symlink'):
                    with self.subTest(action=action, key=key, kind=kind):
                        alias = self.root / 'rollback-alias'
                        normal = self.root / 'normal'
                        normal.mkdir(exist_ok=True)
                        supplied = log = source
                        if kind == 'normalized': log = normal / '..' / source.name
                        if kind == 'symlink': alias.symlink_to(source); log = alias
                        if kind == 'hardlink': os.link(source, alias); log = alias
                        if kind == 'ancestor_symlink':
                            alias.symlink_to(self.root, target_is_directory=True); log = alias / source.name
                        if kind == 'input_symlink': alias.symlink_to(source); supplied = alias
                        previous = self.definition[key]
                        self.definition[key] = str(log)
                        self.save_plist()
                        self.calls.clear()
                        try:
                            with patch.object(control.os, 'replace', wraps=os.replace) as replace:
                                with self.assertRaises(ValueError):
                                    self.run_control(action, ['--approved', '--rollback-runtime', str(supplied)])
                                replace.assert_not_called()
                            self.assertEqual(self.calls, [])
                            self.assertEqual(source.read_bytes(), original)
                            self.assertEqual(self.runtime.read_bytes(), original)
                        finally:
                            if alias.exists() or alias.is_symlink(): alias.unlink()
                            self.definition[key] = previous

    def test_private_existing_logs_allow_restart(self):
        for key in ('StandardOutPath', 'StandardErrorPath'):
            log = Path(self.definition[key]); log.write_text('preserve'); log.chmod(0o600)
        self.run_control()
        for key in ('StandardOutPath', 'StandardErrorPath'):
            self.assertEqual(Path(self.definition[key]).read_text(), 'preserve')

    def test_unrelated_label_is_rejected_without_subprocess(self):
        self.label = 'com.unrelated.service'
        self.definition['Label'] = self.label
        self.save_plist()
        for action in ('activate', 'restart', 'rollback'):
            with self.subTest(action=action):
                with self.assertRaises(ValueError): self.run_control(action, ['--approved'])
                self.assertEqual(self.calls, [])

    def test_runtime_release_and_port_mismatch_are_rejected(self):
        for key, value in [('cwd', str(self.root)), ('port', 3013)]:
            with self.subTest(key=key):
                modified = dict(self.value, **{key: value})
                self.runtime.write_text(json.dumps(modified))
                with self.assertRaises(Exception): self.run_control()
                self.assertEqual(self.calls, [])

    def test_plist_identity_mismatch_blocks_every_mutation(self):
        for key, value in [('Label', 'com.unrelated.service'), ('ProgramArguments', ['/usr/bin/false'])]:
            with self.subTest(key=key):
                old = self.definition[key]
                self.definition[key] = value
                self.save_plist()
                with self.assertRaises(Exception): self.run_control()
                self.assertEqual(self.calls, [])
                self.definition[key] = old

    def test_identity_rechecked_immediately_before_restart(self):
        real_prepare = control.prepare
        count = 0
        def tamper_before_restart(*args, **kwargs):
            nonlocal count
            count += 1
            result = real_prepare(*args, **kwargs)
            if count == 2:
                self.definition['Label'] = 'com.unrelated.service'
                self.save_plist()
            return result
        with patch.object(control, 'prepare', side_effect=tamper_before_restart):
            with self.assertRaises(Exception): self.run_control()
        self.assertTrue(all(c[1] == 'print' for c in self.calls))

    def test_prepared_identity_consistent_across_renderer_controller_docs(self):
        self.assertEqual(control.EXPECTED_LABEL, self.label)
        self.assertEqual(supervisor.EXPECTED_LABEL, self.label)
        self.assertEqual(self.definition['Label'], self.label)
        self.assertIn('`' + self.label + '`', Path(control.__file__).with_name('README.md').read_text())
        with self.assertRaises(ValueError):
            supervisor.definition('com.job-scraper.web337', '/launcher', '/runtime', '/node', '/out', '/err')

    def test_activation_bootstrap_then_loaded_identity_readback(self):
        bootstrapped = False
        def runner(command, **kwargs):
            nonlocal bootstrapped
            if command[1] == 'bootstrap':
                bootstrapped = True
                return subprocess.CompletedProcess(command, 0, '', '')
            if not bootstrapped:
                return subprocess.CompletedProcess(command, 113, '', 'Could not find service')
            return subprocess.CompletedProcess(command, 0, self.loaded(), '')
        with patch.object(control.socket, 'socket') as sock:
            sock.return_value.__enter__.return_value.connect_ex.return_value = 61
            self.run_control('activate', ['--approved'], runner)
        self.assertEqual([c[1] for c in self.calls], ['print', 'print', 'bootstrap', 'print'])

    def test_activation_rejects_already_loaded_identity(self):
        with self.assertRaisesRegex(ValueError, 'already loaded'):
            self.run_control('activate', ['--approved'])
        self.assertEqual([c[1] for c in self.calls], ['print'])

    def test_activation_rejects_postbootstrap_identity_mismatch(self):
        def runner(command, **kwargs):
            if command[1] == 'bootstrap':
                return subprocess.CompletedProcess(command, 0, '', '')
            if any(c[1] == 'bootstrap' for c in self.calls):
                return subprocess.CompletedProcess(command, 0, self.loaded().replace('/usr/bin/true', '/usr/bin/false'), '')
            return subprocess.CompletedProcess(command, 113, '', 'Could not find service')
        with patch.object(control.socket, 'socket') as sock:
            sock.return_value.__enter__.return_value.connect_ex.return_value = 61
            with self.assertRaisesRegex(ValueError, 'unexpected loaded identity'):
                self.run_control('activate', ['--approved'], runner)
        self.assertEqual(self.calls[-1][1], 'print')

    def test_loaded_log_paths_must_match_validated_plist(self):
        for key in ('stdout path', 'stderr path'):
            with self.subTest(key=key):
                self.calls.clear()
                def runner(command, **kwargs):
                    import re
                    text = re.sub(key + r' = .*', key + ' = /unsafe/old.log', self.loaded())
                    return subprocess.CompletedProcess(command, 0, text, '')
                with self.assertRaises(ValueError): self.run_control(runner=runner)
                self.assertEqual([c[1] for c in self.calls], ['print'])

    def test_matching_identity_allows_restart_and_readback(self):
        self.run_control()
        self.assertEqual([c[1] for c in self.calls][-2:], ['kickstart', 'print'])

    def test_cli_subprocess_failure_is_nonzero_and_redacted(self):
        argv = [str(Path(control.__file__)), 'restart', '--label', self.label, '--plist', str(self.plist),
                '--runtime', str(self.runtime), '--node', '/usr/bin/true', '--release', str(self.release)]
        harness = (
            "import runpy,sys,subprocess; from unittest.mock import patch; "
            "sys.path.insert(0, " + repr(str(Path(control.__file__).parent)) + "); "
            "sys.argv=" + repr(argv) + "; "
            "failure=subprocess.CalledProcessError(1,['fixture'],stderr='sensitive-fixture'); "
            "guard=patch('subprocess.run',side_effect=failure); guard.start(); "
            "runpy.run_path(sys.argv[0],run_name='__main__')")
        result = subprocess.run([sys.executable, '-c', harness], capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 1)
        self.assertIn('supervisor operation failed', result.stderr)
        self.assertNotIn('sensitive-fixture', result.stdout + result.stderr)
        self.assertNotIn('Traceback', result.stderr)

    def test_subprocess_failure_stops_before_any_mutation(self):
        def runner(command, **kwargs):
            raise subprocess.CalledProcessError(1, command, stderr='sensitive fixture')
        with self.assertRaises(subprocess.CalledProcessError): self.run_control(runner=runner)
        self.assertEqual([c[1] for c in self.calls], ['print'])

    def test_rollback_copies_validated_snapshot_not_reopened_path(self):
        source = self.root / 'rollback'
        original = json.dumps(self.value).encode()
        source.write_bytes(original); source.chmod(0o600)
        real_prepare = control.prepare
        def swap_after_validation(runtime, *args, **kwargs):
            result = real_prepare(runtime, *args, **kwargs)
            if str(runtime) == str(source):
                replaced = dict(self.value)
                replaced['environment'] = dict(self.value['environment'], JOB_DATA_API_TOKEN='swapped')
                source.write_text(json.dumps(replaced))
            return result
        with patch.object(control, 'prepare', side_effect=swap_after_validation):
            self.run_control('rollback', ['--approved', '--rollback-runtime', str(source)])
        self.assertEqual(self.runtime.read_bytes(), original)

    def test_loaded_identity_mismatch_blocks_restart(self):
        def runner(command, **kwargs):
            return subprocess.CompletedProcess(command, 0, self.loaded().replace('/usr/bin/true', '/usr/bin/false'), '')
        with self.assertRaises(Exception): self.run_control(runner=runner)
        self.assertTrue(self.calls)
        self.assertTrue(all(c[1] == 'print' for c in self.calls))


class ControlTests(unittest.TestCase):
    def test_requires_approval_before_any_production_action(self):
        path = Path(__file__).with_name('control.py')
        self.assertTrue(path.exists(), 'cutover control not implemented')
        spec = importlib.util.spec_from_file_location('control', path)
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        self.assertFalse(module.authorized('activate', False))
        self.assertFalse(module.authorized('rollback', False))
        self.assertTrue(module.authorized('activate', True))
        self.assertTrue(module.authorized('rollback', True))
        self.assertTrue(module.authorized('restart', False))
        self.assertFalse(module.authorized('unknown', True))
        self.assertEqual(module.target('com.example.web'), 'gui/' + str(module.os.getuid()) + '/com.example.web')
        with self.assertRaises(ValueError): module.target('bad/name')

if __name__ == '__main__': unittest.main()
