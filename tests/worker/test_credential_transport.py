import socket
import sys
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).parents[2] / 'worker'))
from credential_broker import CredentialBroker, CredentialError


class TransportTests(unittest.TestCase):
    def fixture(self, lifetime=1, interval=.04, validation_timeout=.06):
        from credential_transport import LeaseTransport
        self.valid = True
        self.block = None
        self.validations = 0
        self.entered = threading.Event()
        self.agent = SimpleNamespace(ready=True, retired=False, boundary=SimpleNamespace(
            unbound=False, identity=dict(nodeId='worker', chatId=-100, threadId=42, generation=3), get=lambda _: 'session'))
        def outbound(operation, payload, session=None):
            if operation == 'credential.acquire':
                return dict(value='protected-material', leaseId='lease', expiresAt=(time.time() + 1)*1000)
            if operation == 'credential.validate':
                self.validations += 1
                self.entered.set()
                if self.block is not None:self.block.wait(2)
                if self.valid is None:raise OSError('control plane unavailable')
                return dict(valid=self.valid)
            return {}
        self.agent.outbound = outbound
        broker = CredentialBroker(self.agent)
        self.lease = broker.acquire(dict(integrationId='provider:p',credentialId='cid',capability='provider.request',scopes=['provider.request']))
        self.lease.consume(lambda _: None)
        self.left, self.right = socket.socketpair()
        self.closed = threading.Event()
        class Connection:
            def close(inner):
                try:self.left.shutdown(socket.SHUT_RDWR)
                except OSError:pass
                self.closed.set()
        self.owner = True
        self.scope = LeaseTransport(self.lease, Connection(), lambda:self.owner, lifetime=lifetime,
            interval=interval, validation_timeout=validation_timeout)
        self.addCleanup(self.left.close);self.addCleanup(self.right.close);self.addCleanup(self.scope.close)
        return self.scope

    def test_revocation_revalidates_during_blocked_response_and_fences_output(self):
        scope = self.fixture()
        scope.forward(lambda:self.assertTrue(True))
        self.valid = False
        self.assertTrue(self.closed.wait(.5))
        self.assertGreaterEqual(self.validations, 2)
        self.assertEqual(self.left.recv(1), b'')
        with self.assertRaises(ValueError):scope.forward(lambda:self.fail('output after revocation'))
        with self.assertRaises(CredentialError):self.lease.consume(lambda _:self.fail('retained material'))

    def test_blocked_control_plane_validation_has_independent_deadline(self):
        scope = self.fixture()
        self.block = threading.Event();self.entered.clear()
        try:
            self.assertTrue(self.entered.wait(.5))
            self.assertTrue(self.closed.wait(.5), 'blocked validation kept transport alive')
            with self.assertRaises(ValueError):scope.forward(lambda:self.fail('output while authority unavailable'))
        finally:self.block.set()

    def test_expiry_total_deadline_owner_change_and_cp_failure_close_transport(self):
        for change in ('expiry', 'deadline', 'owner', 'generation', 'unavailable'):
            with self.subTest(change=change):
                scope = self.fixture(lifetime=.08 if change=='deadline' else 1)
                if change=='expiry':self.lease._expiry=(time.time()+.04)*1000
                elif change=='owner':self.owner=False
                elif change=='generation':self.agent.boundary.identity['generation']=4
                elif change=='unavailable':self.valid=None
                self.assertTrue(self.closed.wait(1.3))
                with self.assertRaises(ValueError):scope.forward(lambda:self.fail('stale output'))
                scope.close()

    def test_no_forwarding_while_authoritative_validation_is_pending(self):
        scope = self.fixture(validation_timeout=.3)
        self.block=threading.Event();self.entered.clear()
        try:
            self.assertTrue(self.entered.wait(.5))
            sent=threading.Event()
            thread=threading.Thread(target=lambda:scope.forward(sent.set))
            thread.start()
            self.assertFalse(sent.wait(.03))
            self.block.set();thread.join(.5)
            self.assertTrue(sent.is_set())
        finally:self.block.set()

    def test_watchdog_expiry_deadline_and_revocation_do_not_wait_for_blocked_callback(self):
        for failure in ('expiry','deadline','revoke','blocked'):
            with self.subTest(failure=failure):
                scope=self.fixture(lifetime=.08 if failure=='deadline' else 1)
                entered,release=threading.Event(),threading.Event()
                def callback():entered.set();release.wait(1)
                thread=threading.Thread(target=lambda:scope.forward(callback),daemon=True);thread.start()
                try:
                    self.assertTrue(entered.wait(.5))
                    if failure=='expiry':self.lease._expiry=(time.time()+.04)*1000
                    elif failure=='revoke':self.valid=False
                    elif failure=='blocked':self.block=threading.Event()
                    self.assertTrue(self.closed.wait(.3),'watcher blocked on forwarding callback')
                finally:
                    release.set()
                    if self.block is not None:self.block.set()
                    thread.join(.5);scope.close()
