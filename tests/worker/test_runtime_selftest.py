import sys
import tempfile
import threading
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parents[2] / 'worker'))
from node_agent import Agent, Boundary


class SelftestTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.boundary = Boundary(Path(self.temp.name) / 'agent', 's'*32, dict(nodeId='n', generation=1, chatId=0, threadId=0))
        self.exits = []
        self.agent = Agent(self.boundary, 'https://control.invalid', exit_on_crash=self.exits.append)
        self.agent.ready = True
        self.agent.process = type('Process', (), {'poll': lambda self: None})()
    def tearDown(self):
        self.boundary.db.close(); self.temp.cleanup()
    def request(self, payload):
        return self.boundary.envelope('runtime.selftest', payload)
    def test_fixed_profile_generates_private_run_and_requires_join_proof(self):
        calls = []
        def local(method, route, payload, timeout):
            calls.append((method, route, payload, timeout))
            return dict(payload, joined=True, proof={'baseline': True})
        self.agent.local = local
        result = self.agent.dispatch(self.request({'profile': 'baseline'}))
        self.assertTrue(result['joined'])
        self.assertEqual(calls[0][1], '/telegram/runtime-selftest')
        self.assertEqual(calls[0][3], 210)
        self.assertEqual(set(calls[0][2]), {'runId', 'profile'})
        self.assertIsNone(self.boundary.get('session'))
        self.assertIsNone(self.boundary.get('runId'))
    def test_fixed_network_profile_uses_same_owned_native_path(self):
        calls = []
        def local(method, route, payload, timeout):
            calls.append((method, route, payload, timeout))
            return dict(payload, joined=True, success=True)
        self.agent.local = local
        result = self.agent.dispatch(self.request({'profile': 'network'}))
        self.assertTrue(result['joined'])
        self.assertEqual(calls[0][1], '/telegram/runtime-selftest')
        self.assertEqual(calls[0][2]['profile'], 'network')
        self.assertEqual(set(calls[0][2]), {'runId', 'profile'})
        self.assertIsNone(self.agent.runtime_selftest_owner)

    def test_unbound_gate_is_derived_not_inherited(self):
        self.assertEqual(self.agent.core_environment()['OPENCODE_TELEGRAM_RUNTIME_SELFTEST'], '1')
        self.boundary.identity = dict(self.boundary.identity, chatId=-1, threadId=2)
        self.assertNotIn('OPENCODE_TELEGRAM_RUNTIME_SELFTEST', self.agent.core_environment())
        with self.assertRaises(ValueError): self.agent.dispatch(self.request({'profile': 'baseline'}))
    def test_rejects_arbitrary_command_or_profile_and_foreign_session(self):
        self.agent.local = lambda *args, **kwargs: self.fail('invalid request reached native')
        for payload in ({'profile': 'shell'}, {'profile': 'baseline', 'command': 'id'}, {'profile': 'browser', 'runId': 'chosen'}):
            with self.assertRaises(ValueError): self.agent.dispatch(self.request(payload))
        with self.assertRaises(ValueError): self.agent.dispatch(self.boundary.envelope('runtime.selftest', {'profile': 'baseline'}, 'foreign'))
    def test_concurrent_sync_and_selftest_are_denied_and_cancel_joins(self):
        active, release = threading.Event(), threading.Event()
        calls, errors = [], []
        def local(method, route, payload, timeout):
            calls.append(route)
            if route.endswith('/abort'):
                run_id = route.split('/')[-2]
                release.set()
                return {'runId': run_id, 'joined': True, 'aborted': True}
            active.set()
            release.wait(2)
            return dict(payload, joined=True)
        self.agent.local = local
        def run():
            try: self.agent.dispatch(self.request({'profile': 'browser'}))
            except Exception as error: errors.append(error)
        thread = threading.Thread(target=run)
        thread.start()
        self.assertTrue(active.wait(1))
        with self.assertRaises(ValueError): self.agent.dispatch(self.request({'profile': 'baseline'}))
        with self.assertRaises(ValueError): self.agent.dispatch(self.boundary.envelope('sync-global', {}))
        self.agent.cancel_runtime_selftest()
        thread.join(1)
        self.assertFalse(thread.is_alive())
        self.assertFalse(errors)
        self.assertEqual(len(calls), 2)
    def test_missing_join_proof_fences_agent(self):
        self.agent.local = lambda method, route, payload, timeout: dict(payload, joined=False)
        with self.assertRaises(RuntimeError): self.agent.dispatch(self.request({'profile': 'baseline'}))
        self.assertEqual(self.exits, [1])
        self.assertFalse(self.agent.ready)
    def test_retirement_cancels_and_joins_before_handoff_proof(self):
        active, release = threading.Event(), threading.Event()
        def local(method, route, payload, timeout):
            if route.endswith('/abort'):
                self.assertIsNone(self.boundary.get('retired'))
                release.set()
                return {'runId': route.split('/')[-2], 'joined': True}
            active.set(); release.wait(2)
            return dict(payload, joined=True, aborted=True)
        self.agent.local = local
        failures = []
        def run():
            try: self.agent.dispatch(self.request({'profile': 'baseline'}))
            except Exception as error: failures.append(error)
        thread = threading.Thread(target=run)
        thread.start(); self.assertTrue(active.wait(1))
        def stop():
            self.assertTrue(release.is_set())
            self.assertIsNone(self.agent.runtime_selftest_owner)
            self.assertIsNone(self.boundary.get('retired'))
            self.agent.process = None
        self.agent.stop_core = stop
        result = self.agent.dispatch(self.boundary.envelope('retire', {}))
        thread.join(1)
        self.assertFalse(thread.is_alive())
        self.assertFalse(failures)
        self.assertEqual(result, {'retired': True})
        self.assertTrue(self.boundary.get('retired'))
    def test_uncertain_abort_does_not_issue_retirement_proof(self):
        self.agent.runtime_selftest_owner = {'runId': 'fixture', 'profile': 'baseline', 'done': threading.Event()}
        self.agent.local = lambda *args, **kwargs: {'runId': 'fixture', 'joined': False}
        self.agent.stop_core = lambda: self.fail('uncertain selftest reached disposal')
        with self.assertRaises(RuntimeError): self.agent.dispatch(self.boundary.envelope('retire', {}))
        self.assertIsNone(self.boundary.get('retired'))
        self.assertEqual(self.exits, [1])
