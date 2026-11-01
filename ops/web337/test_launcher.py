import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

class LauncherTests(unittest.TestCase):
    def test_protected_runtime_and_pre_node_environment(self):
        spec = importlib.util.spec_from_file_location('launcher', Path(__file__).with_name('launcher.py'))
        self.assertTrue(Path(spec.origin).exists(), 'safe launcher not implemented')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            release = root / 'release'
            (release / '.next').mkdir(parents=True)
            (release / '.next/BUILD_ID').write_text('test-build')
            (release / 'node_modules/next/dist/bin').mkdir(parents=True)
            (release / 'node_modules/next/dist/bin/next').write_text('')
            ca = root / 'ca.pem'
            ca.write_text('test CA')
            runtime = root / 'runtime.json'
            value = {'cwd': str(release), 'port': 3011, 'environment': {
                'NODE_ENV': 'production', 'NODE_EXTRA_CA_CERTS': str(ca),
                'JOB_DATA_API_URL': 'https://api.example.test', 'JOB_DATA_API_TOKEN': 'test-token',
                'NEXT_PUBLIC_SUPABASE_URL': 'https://storage.example.test',
                'NEXT_PUBLIC_SUPABASE_ANON_KEY': 'test-anon', 'SUPABASE_SERVICE_ROLE_KEY': 'test-storage'}}
            runtime.write_text(json.dumps(value)); runtime.chmod(0o600)
            command, cwd, environment = module.prepare(runtime, '/usr/bin/true', 3013)
            self.assertEqual(cwd, str(release))
            self.assertEqual(command[-4:], ['--hostname', '127.0.0.1', '--port', '3013'])
            self.assertEqual(environment['NODE_EXTRA_CA_CERTS'], str(ca))
            self.assertEqual(environment['JOB_DATA_API_TOKEN'], 'test-token')
            self.assertNotIn('NODE_OPTIONS', environment)
            # Unknown execution-controlling environment entries must fail closed.
            value['environment']['LD_PRELOAD'] = '/unsafe/library'
            runtime.write_text(json.dumps(value))
            with self.assertRaises(module.UnsafeConfig): module.prepare(runtime, '/usr/bin/true', None)
            del value['environment']['LD_PRELOAD']
            runtime.write_text(json.dumps(value))
            replacement = root / 'replacement.json'
            value['environment']['JOB_DATA_API_TOKEN'] = 'renewed-token'
            replacement.write_text(json.dumps(value)); replacement.chmod(0o600)
            replacement.replace(runtime)
            self.assertEqual(module.prepare(runtime, '/usr/bin/true', None)[2]['JOB_DATA_API_TOKEN'], 'renewed-token')
            runtime.chmod(0o644)
            with self.assertRaises(module.UnsafeConfig): module.prepare(runtime, '/usr/bin/true', None)
            runtime.chmod(0o600)
            alias = root / 'alias'; alias.symlink_to(runtime)
            with self.assertRaises(module.UnsafeConfig): module.prepare(alias, '/usr/bin/true', None)

if __name__ == '__main__': unittest.main()
