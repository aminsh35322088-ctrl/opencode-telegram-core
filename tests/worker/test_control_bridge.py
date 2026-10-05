import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parents[2] / 'worker'))
from control_bridge import ControlBridge


class BridgeTests(unittest.TestCase):
    def setUp(self):
        class Boundary:
            snapshot = {'revision': 1, 'skills': [], 'catalog': {}, 'actions': [], 'configuration': {}, 'defaults': {}}
            def get(self, key):
                return 'ses_owned'
        class Agent:
            retired = False
            ready = True
            boundary = Boundary()
            def __init__(self):
                self.calls = []
            def outbound(self, operation, payload, session=None):
                self.calls.append((operation, payload, session))
                return {'approvalId': 'approval-fixture', 'preview': payload['mutation']}
        self.agent = Agent()
        self.bridge = ControlBridge(self.agent)

    def test_foreign_session_and_action_cannot_sign_control_requests(self):
        for value in ({'sessionId': 'foreign', 'action': 'skills.create'}, {'sessionId': 'ses_owned', 'action': 'railway.delete'}):
            with self.assertRaises(ValueError):
                self.bridge.dispatch(value)
        self.assertEqual(self.agent.calls, [])

    def test_prepare_forwards_only_exact_mutation_and_bound_session(self):
        result = self.bridge.dispatch({'sessionId': 'ses_owned', 'action': 'skills.create', 'operation': 'mutation.prepare', 'payload': {'resource': 'safe', 'config': {'content': 'fixture'}}})
        self.assertIn('question', result['next'])
        self.assertEqual(self.agent.calls[0], ('mutation.prepare', {'mutation': {'type': 'skills.create', 'resource': 'safe', 'config': {'content': 'fixture'}}}, 'ses_owned'))

    def test_commit_requires_approval_and_exact_preview(self):
        base = {'sessionId': 'ses_owned', 'action': 'skills.create', 'operation': 'mutation.commit'}
        for payload in ({'resource': 'safe', 'config': {}}, {'approvalId': 'fixture', 'resource': 'safe', 'config': {}}):
            with self.assertRaises(ValueError):
                self.bridge.dispatch({**base, 'payload': payload})
        self.assertEqual(self.agent.calls, [])

    def test_model_cannot_replace_mutation_type(self):
        with self.assertRaises(ValueError):
            self.bridge.dispatch({'sessionId': 'ses_owned', 'action': 'skills.create', 'payload': {'mutation': {'type': 'extensions.ensure', 'resource': 'unsafe', 'config': {}}}})

    def test_read_only_snapshot_needs_no_outgoing_request(self):
        result = self.bridge.dispatch({'sessionId': 'ses_owned', 'action': 'skills.list'})
        self.assertEqual(result, {'revision': 1, 'data': []})
        self.assertEqual(self.agent.calls, [])
