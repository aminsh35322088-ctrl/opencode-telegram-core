"""Exercise npm's actual config loader without network or credential inheritance."""
import ast
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


class NetworkEnvironmentTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which('npm'), 'npm runtime not installed')
    def test_isolated_configuration_loads_with_real_npm(self):
        source = Path(__file__).parents[2] / 'scripts' / 'worker-runtime-smoke.py'
        function = next(node for node in ast.parse(source.read_text()).body
                        if isinstance(node, ast.FunctionDef) and node.name == 'isolated_network_environment')
        namespace = {}
        exec(compile(ast.Module(body=[function], type_ignores=[]), str(source), 'exec'), namespace)
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            environment = namespace['isolated_network_environment'](home)
            self.assertNotEqual(environment['npm_config_userconfig'], environment['npm_config_globalconfig'])
            for key in ('npm_config_userconfig', 'npm_config_globalconfig'):
                self.assertEqual(Path(environment[key]).read_text(), '')
            self.assertNotIn('RAILWAY_API_TOKEN', environment)
            # npm needs its Node executable on PATH on non-image test hosts too.
            environment['PATH'] = str(Path(shutil.which('npm')).parent) + os.pathsep + environment['PATH']
            for key, expected in (('registry', 'https://registry.npmjs.org'), ('strict-ssl', 'true')):
                result = subprocess.run([shutil.which('npm'), 'config', 'get', key],
                                        cwd=directory, env=environment, capture_output=True, text=True, timeout=15)
                self.assertEqual(result.returncode, 0, 'npm rejected isolated configuration')
                self.assertEqual(result.stdout.strip(), expected)
