import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('git_shim', Path(__file__).parents[2] / 'worker/git_shim.py')
shim = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shim)

class GitShimTests(unittest.TestCase):
    def test_authentication_is_process_scoped_without_global_config_mutation(self):
        with patch.dict(shim.os.environ, {'CORE_GIT_PROXY_URL': 'http://127.0.0.1:4100/github/'}, clear=True), \
             patch.object(shim.os, 'execv') as execute:
            shim.main(['clone', 'https://github.com/owner/repository.git'])
        command, args = execute.call_args.args
        self.assertEqual(command, '/usr/bin/git')
        self.assertIn('credential.helper=', args)
        self.assertIn('http.followRedirects=false', args)
        self.assertIn('url.http://127.0.0.1:4100/github/.insteadOf=https://github.com/', args)
        self.assertNotIn('--global', args)
        self.assertEqual(args[-2:], ['clone', 'https://github.com/owner/repository.git'])

    def test_public_git_without_integration_configuration_remains_available(self):
        with patch.dict(shim.os.environ, {}, clear=True), patch.object(shim.os, 'execv') as execute:
            shim.main(['--version'])
        self.assertEqual(execute.call_args.args, ('/usr/bin/git', ['/usr/bin/git', '--version']))
