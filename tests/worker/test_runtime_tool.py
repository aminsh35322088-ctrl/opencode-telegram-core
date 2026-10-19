"""Topic-scoped introspection of live tools and health without secret exposure."""
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).parents[2] / 'worker'))
from control_bridge import ControlBridge


class RuntimeInspectionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.tools = root / 'runtime' / 'opencode' / 'tools'
        self.tools.mkdir(parents=True)
        for name in ('bot.ts', 'actions.ts', 'browser.ts', 'runtime.ts'):
            (self.tools / name).write_text('export default {}')

        class Boundary:
            def __init__(self, directory):
                self.unbound = False
                self.root = directory / 'agent'
                self.snapshot = {'revision': 7, 'hash': 'fixture-hash', 'credentialReferences': [],
                                 'configuration': {'runtime': {'options': {'apiKey': 'private-fixture-secret'}}}}

            def get(self, key):
                return {'session': 'ses_owned',
                        'activatedSnapshotHighwater': {'revision': 7, 'hash': 'fixture-hash'}}.get(key)

            def verify_snapshot(self, value):
                if value.get('hash') != 'fixture-hash':
                    raise ValueError('integrity failure')
                return b'canonical-fixture'

        class Agent:
            ready = True
            retired = False
            fatal_exit_requested = False
            agent_started_at_monotonic = time.monotonic() - 31
            process = SimpleNamespace(pid=os.getpid(), poll=lambda: None)

            def __init__(self, boundary):
                self.boundary = boundary
                self.calls = []
                self.message = {'info': {'role': 'assistant', 'providerID': 'fixture', 'modelID': 'model-1'}, 'parts': []}
                self.tool_list = [
                    {'id': 'read', 'description': 'Read a Topic file', 'parameters': {'secret': 'do-not-return'}},
                    {'id': 'runtime', 'description': 'Inspect runtime'},
                ]

            def readiness_state(self):
                return 'ready'

            def local(self, method, route, payload=None, timeout=30):
                self.calls.append((method, route, timeout))
                if route == '/experimental/tool/ids':
                    return ['read', 'runtime', 'browser', 'mcp:fixture/list']
                if route == '/session/ses_owned/message/msg_current':
                    return self.message
                if route == '/experimental/tool?provider=fixture&model=model-1':
                    return self.tool_list
                if route == '/global/health':
                    return {'healthy': True}
                raise AssertionError('unexpected route: ' + route)

        self.agent = Agent(Boundary(root))
        self.bridge = ControlBridge(self.agent)

    def tearDown(self):
        self.temp.cleanup()

    def request(self, section, payload=None, session='ses_owned'):
        return {'action': 'runtime.inspect', 'sessionId': session,
                'payload': {'section': section, **(payload or {})}}

    def test_capabilities_uses_live_model_registry_but_drops_parameter_schemas(self):
        result = self.bridge.dispatch(self.request('capabilities', {'messageID': 'msg_current'}))
        self.assertTrue(result['modelSpecific'])
        self.assertEqual(result['model'], {'providerID': 'fixture', 'modelID': 'model-1'})
        self.assertEqual([item['id'] for item in result['tools']], ['read', 'runtime'])
        self.assertNotIn('parameters', result['tools'][0])
        self.assertNotIn('do-not-return', str(result))
        self.assertIn(('GET', '/experimental/tool/ids', 5), self.agent.calls)
        self.assertIn(('GET', '/session/ses_owned/message/msg_current', 5), self.agent.calls)

    def test_capabilities_falls_back_to_exact_live_ids_when_message_has_no_model(self):
        self.agent.message = {'info': {'role': 'user'}, 'parts': []}
        result = self.bridge.dispatch(self.request('capabilities', {'messageID': 'msg_current'}))
        self.assertFalse(result['modelSpecific'])
        self.assertEqual([item['id'] for item in result['tools']], ['read', 'runtime', 'browser', 'mcp:fixture/list'])
        self.assertNotIn('model', result)

    def test_capabilities_rejects_foreign_session_and_arbitrary_payload(self):
        with self.assertRaisesRegex(ValueError, 'foreign tool session'):
            self.bridge.dispatch(self.request('capabilities', {'messageID': 'msg_current'}, session='ses_foreign'))
        with self.assertRaisesRegex(ValueError, 'invalid runtime inspection request'):
            self.bridge.dispatch(self.request('diagnostics', {'messageID': 'msg_current', 'path': '/data'}))
        with self.assertRaisesRegex(ValueError, 'invalid runtime message context'):
            self.bridge.dispatch(self.request('capabilities', {'messageID': '../foreign'}))

    def test_diagnostics_are_topic_scoped_and_do_not_echo_configuration(self):
        result = self.bridge.dispatch(self.request('diagnostics'))
        self.assertEqual(result['scope'], 'current-topic')
        self.assertEqual(result['readiness'], 'ready')
        self.assertTrue(result['coreProcessAlive'])
        self.assertGreaterEqual(result['agentUptimeSeconds'], 30)
        self.assertTrue(result['snapshotIntegrity'])
        self.assertNotIn('private-fixture-secret', str(result))
        self.assertNotIn('sessionID', result)
        self.assertNotIn('pid', result)

    def test_verify_checks_exact_expected_tool_materialization_and_live_health(self):
        result = self.bridge.dispatch(self.request('verify'))
        self.assertTrue(result['passed'], result)
        self.assertEqual({check['name'] for check in result['checks']},
                         {'bound_topic', 'core_process', 'snapshot_integrity', 'snapshot_activation', 'worker_tool_materialization', 'core_health_endpoint'})
        self.assertTrue(all(check['passed'] for check in result['checks']))
        self.assertNotIn(self.temp.name, str(result))

    def test_verify_fails_on_missing_required_or_stale_optional_tool(self):
        (self.tools / 'browser.ts').unlink()
        (self.tools / 'github.ts').write_text('export default {}')
        result = self.bridge.dispatch(self.request('verify'))
        self.assertFalse(result['passed'])
        files = next(check for check in result['checks'] if check['name'] == 'worker_tool_materialization')
        self.assertEqual(files['missing'], ['browser.ts'])
        self.assertEqual(files['unexpectedOptionalTools'], ['github.ts'])

    def test_verify_fails_when_a_materialized_tool_is_group_or_world_writable(self):
        target = self.tools / 'browser.ts'
        target.chmod(0o666)
        result = self.bridge.dispatch(self.request('verify'))
        self.assertFalse(result['passed'])
        check = next(check for check in result['checks'] if check['name'] == 'worker_tool_materialization')
        self.assertEqual(check['unsafe'], ['browser.ts'])

    def test_snapshot_integrity_failure_is_reported_without_private_error_text(self):
        self.agent.boundary.snapshot['hash'] = 'tampered'
        result = self.bridge.dispatch(self.request('verify'))
        self.assertFalse(result['passed'])
        check = next(check for check in result['checks'] if check['name'] == 'snapshot_integrity')
        self.assertFalse(check['passed'])
        self.assertNotIn('integrity failure', str(result))
