import importlib.util
from pathlib import Path
import unittest

class SupervisorTests(unittest.TestCase):
    def test_secret_free_loopback_supervisor(self):
        path = Path(__file__).with_name('supervisor.py')
        self.assertTrue(path.exists(), 'supervisor not implemented')
        spec = importlib.util.spec_from_file_location('supervisor', path)
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        result = module.definition('com.zeroluck.job-scraper-web337', '/deploy/launcher.py', '/private/runtime.json', '/opt/node', '/private/stdout.log', '/private/stderr.log', 3013)
        self.assertTrue(result['KeepAlive'])
        self.assertTrue(result['RunAtLoad'])
        self.assertEqual(result['ThrottleInterval'], 30)
        self.assertEqual(result['Umask'], 0o077)
        self.assertNotIn('EnvironmentVariables', result)
        self.assertEqual(result['ProgramArguments'][-2:], ['--port', '3013'])
        with self.assertRaises(ValueError): module.definition('com.example.web', 'relative', '/private/runtime.json', '/opt/node', '/private/out', '/private/err', 3011)
        with self.assertRaises(ValueError): module.definition('com.example.web', '/launcher', '/runtime', '/node', '/out', '/err', 3000)

if __name__ == '__main__': unittest.main()
