import json
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).parents[2] / 'worker'))
from credential_broker import CredentialBroker, CredentialError


class BrokerTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.now = 100
        self.identity = dict(nodeId='worker-one', chatId=-100, threadId=42, generation=3)
        self.agent = SimpleNamespace(retired=False, ready=True,
            boundary=SimpleNamespace(unbound=False, identity=self.identity,
                get=lambda key: 'session-one'))
        self.reply = dict(leaseId='lease-one', expiresAt=110000, value='fixture-private-secret')
        def outbound(operation, payload, session=None):
            self.calls.append((operation, payload, session))
            return self.reply if operation == 'credential.acquire' else {'valid': True}
        self.agent.outbound = outbound
        self.broker = CredentialBroker(self.agent, now=lambda: self.now)
        self.request = dict(integrationId='mock.database', credentialId='credential-one',
            capability='database.query', scopes=['database:sample'])

    def test_generic_mock_acquisition_captures_worker_identity_and_releases(self):
        with self.broker.acquire(self.request) as lease:
            self.assertEqual(lease.consume(lambda value: len(value)), 22)
            self.assertNotIn(self.reply['value'], repr(lease))
            self.assertNotIn(self.reply['value'], json.dumps(lease.metadata))
            with self.assertRaises(TypeError):
                json.dumps(lease)
        self.assertEqual(self.calls[0][0], 'credential.acquire')
        self.assertEqual(self.calls[0][1]['workerId'], 'worker-one')
        self.assertEqual(self.calls[0][1]['topicId'], '-100:42')
        self.assertEqual(self.calls[0][1]['generation'], 3)
        self.assertEqual(self.calls[-1][0], 'credential.release')
        with self.assertRaises(CredentialError):
            lease.consume(lambda value: value)

    def test_expiration_and_generation_replacement_fence_material(self):
        for mutation in (lambda: setattr(self, 'now', 111),
                         lambda: self.identity.update(generation=4),
                         lambda: setattr(self.agent, 'retired', True)):
            self.setUp()
            with self.broker.acquire(self.request) as lease:
                mutation()
                with self.assertRaises(CredentialError):
                    lease.consume(lambda value: self.fail('stale material consumed'))

    def test_errors_do_not_chain_or_echo_credentials(self):
        with self.broker.acquire(self.request) as lease:
            with self.assertRaises(CredentialError) as failure:
                lease.consume(lambda value: (_ for _ in ()).throw(ValueError(value)))
            self.assertNotIn(self.reply['value'], str(failure.exception))
            self.assertTrue(failure.exception.__suppress_context__)

    def test_no_acquisition_cache_and_unbound_worker_rejected(self):
        for _ in range(2):
            with self.broker.acquire(self.request):
                pass
        self.assertEqual(sum(call[0] == 'credential.acquire' for call in self.calls), 2)
        self.agent.boundary.unbound = True
        with self.assertRaises(CredentialError):
            self.broker.acquire(self.request)

    def test_revocation_validation_failure_does_not_consume(self):
        with self.broker.acquire(self.request) as lease:
            self.agent.outbound = lambda *args, **kwargs: {'valid': False}
            with self.assertRaises(CredentialError):
                lease.consume(lambda value: self.fail('revoked material consumed'))

    def test_release_during_validation_cannot_call_consumer_with_discarded_material(self):
        lease = self.broker.acquire(self.request)
        def outbound(operation, payload, session=None):
            if operation == 'credential.validate':lease.release()
            return {'valid': True}
        self.agent.outbound = outbound
        consumed = []
        with self.assertRaises(CredentialError):
            lease.consume(consumed.append)
        self.assertEqual(consumed, [])
