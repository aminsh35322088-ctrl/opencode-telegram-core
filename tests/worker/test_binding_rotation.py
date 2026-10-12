import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch, Mock
sys.path.insert(0, str(Path(__file__).parents[2] / 'worker'))
import cloud_bootstrap
spec = importlib.util.spec_from_file_location('rotation_agent', Path(__file__).parents[2] / 'worker' / 'node_agent.py')
a = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a)

class BindingRotationTests(unittest.TestCase):
    def test_retired_worker_binds_in_place_and_persists_rotated_identity(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'agent'
            old = {'nodeId':'worker-01','generation':1,'chatId':0,'threadId':0}
            new = {**old,'generation':2,'chatId':-100,'threadId':42}
            boundary = a.Boundary(root, 's'*64, old)
            os.chmod(root, 0o700)
            agent = a.Agent(boundary, 'https://control.example', exit_on_crash=lambda _:None)
            agent.dispatch(boundary.envelope('retire', {'sanitize': True}))
            listeners = [Mock(), Mock(), Mock(), Mock()]
            for proxy, listener in zip((agent.proxy, agent.mcp_proxy, agent.github, agent.bridge), listeners):
                proxy.server = listener
            resolve = cloud_bootstrap.resolve_cloud_identity
            def bootstrap(*args):
                return resolve(*args, transport=lambda *_:{'version':1,'identity':new,'secret':'t'*64,'revision':1})
            with patch.dict(os.environ, {'RAILWAY_SERVICE_ID':'service','RAILWAY_PROJECT_ID':'project'}), patch.object(cloud_bootstrap, 'resolve_cloud_identity', bootstrap):
                next_agent = agent.rotate_binding({'bootstrapToken':'b'*64})
            for listener in listeners:
                listener.shutdown.assert_called_once_with()
                listener.server_close.assert_called_once_with()
            self.assertEqual(next_agent.boundary.identity, new)
            self.assertFalse(next_agent.retired)
            self.assertEqual(next_agent.boundary.secret, b't'*64)
            self.assertEqual(boundary.identity, old)
            cached = resolve(root, 'original-environment-token'*3, 'https://control.example','service','project', prefer_cached=True, transport=lambda *_:self.fail('restart must use rotated cache'))
            self.assertEqual(cached['identity'],new)
            next_agent.boundary.db.close()
            boundary.db.close()

    def test_rotation_releases_every_listener_for_rebinding(self):
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
        import threading
        with tempfile.TemporaryDirectory() as tmp:
            old = {'nodeId':'worker-04','generation':1,'chatId':0,'threadId':0}
            new = {**old,'generation':2,'chatId':-100,'threadId':43}
            boundary = a.Boundary(Path(tmp)/'agent', 's'*64, old)
            os.chmod(boundary.root, 0o700)
            agent = a.Agent(boundary, 'https://control.example', exit_on_crash=lambda _:None)
            agent.dispatch(boundary.envelope('retire', {'sanitize': True}))
            owners = (agent.proxy, agent.mcp_proxy, agent.github, agent.bridge)
            servers, threads, ports = [], [], []
            replacement = None
            try:
                for owner in owners:
                    try:
                        server = ThreadingHTTPServer(('127.0.0.1', 0), BaseHTTPRequestHandler)
                    except PermissionError:
                        self.skipTest('local TCP listeners unavailable in this environment')
                    owner.server = server
                    servers.append(server)
                    ports.append(server.server_address[1])
                    thread = threading.Thread(target=server.serve_forever, daemon=True)
                    thread.start()
                    threads.append(thread)
                resolve = cloud_bootstrap.resolve_cloud_identity
                def bootstrap(*args):
                    return resolve(*args, transport=lambda *_:{'version':1,'identity':new,'secret':'t'*64,'revision':1})
                with patch.dict(os.environ, {'RAILWAY_SERVICE_ID':'service','RAILWAY_PROJECT_ID':'project'}), patch.object(cloud_bootstrap, 'resolve_cloud_identity', bootstrap):
                    replacement = agent.rotate_binding({'bootstrapToken':'b'*64})
                for owner, port in zip((replacement.proxy, replacement.mcp_proxy, replacement.github, replacement.bridge), ports):
                    owner.port = port
                    owner.start()
                    self.assertEqual(owner.server.server_address[1], port)
                for thread in threads:
                    thread.join(timeout=2)
                    self.assertFalse(thread.is_alive())
            finally:
                for server in servers:
                    server.shutdown()
                    server.server_close()
                if replacement:
                    for owner in (replacement.proxy, replacement.mcp_proxy, replacement.github, replacement.bridge):
                        if owner.server:
                            owner.server.shutdown()
                            owner.server.server_close()
                    replacement.boundary.db.close()
                boundary.db.close()

    def test_clean_bound_worker_recycles_to_ready_unbound_then_binds_next_topic_directly(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'agent'
            old = {'nodeId':'worker-reuse','generation':1,'chatId':-100,'threadId':42}
            unbound_identity = {'nodeId':'worker-reuse','generation':2,'chatId':0,'threadId':0}
            next_topic = {'nodeId':'worker-reuse','generation':3,'chatId':-100,'threadId':43}
            boundary = a.Boundary(root, 'fixture-old-secret-' * 4, old)
            os.chmod(root, 0o700)
            agent = a.Agent(boundary, 'https://control.example', exit_on_crash=lambda _:None)
            agent.stop_core = lambda: None
            unbound = rebound = None
            try:
                self.assertEqual(agent.dispatch(boundary.envelope('retire', {'sanitize': True})), {'retired': True, 'sanitized': True})
                with patch.object(cloud_bootstrap, 'resolve_cloud_identity', return_value={'identity':unbound_identity,'secret':'fixture-unbound-secret-' * 4,'controlUrl':'https://control.example'}):
                    unbound = agent.rotate_binding({'bootstrapToken':'fixture_bootstrap_' * 4})
                self.assertTrue(unbound.boundary.unbound)
                self.assertEqual(unbound.readiness_state(), 'ready-unbound')
                self.assertFalse(unbound.retired)
                stale = boundary.envelope('health', {})
                stale_raw = a.canonical(stale)
                stale_signature = boundary.signature(stale_raw)
                with self.assertRaises(ValueError):
                    unbound.boundary.authenticate(stale_raw, stale_signature)

                with patch.object(cloud_bootstrap, 'resolve_cloud_identity', return_value={'identity':next_topic,'secret':'fixture-next-secret-' * 4,'controlUrl':'https://control.example'}):
                    rebound = unbound.rotate_binding({'bootstrapToken':'fixture_rebind_' * 4})
                self.assertFalse(rebound.boundary.unbound)
                self.assertEqual(rebound.boundary.identity, next_topic)
                self.assertEqual(rebound.readiness_state(), 'warming')
            finally:
                if rebound is not None:
                    rebound.boundary.db.close()
                if unbound is not None:
                    unbound.boundary.db.close()
                boundary.db.close()

    def test_listener_cleanup_failure_never_returns_reusable_slot(self):
        with tempfile.TemporaryDirectory() as tmp:
            boundary = a.Boundary(Path(tmp)/'agent', 'fixture-cleanup-secret-' * 3, {'nodeId':'worker-fail','generation':1,'chatId':-100,'threadId':42})
            os.chmod(boundary.root, 0o700)
            agent = a.Agent(boundary, 'https://control.example', exit_on_crash=lambda _:None)
            agent.stop_core = lambda: None
            try:
                agent.dispatch(boundary.envelope('retire', {'sanitize': True}))
                listener = Mock()
                listener.shutdown.side_effect = OSError('listener did not join')
                agent.bridge.server = listener
                with patch.object(cloud_bootstrap, 'resolve_cloud_identity', side_effect=AssertionError('bootstrap must not run')):
                    with self.assertRaisesRegex(OSError, 'listener did not join'):
                        agent.rotate_binding({'bootstrapToken':'fixture_cleanup_' * 4})
                self.assertEqual(agent.slot.state.value, 'RETIRING')
                self.assertEqual(agent.readiness_state(), 'retiring')
            finally:
                boundary.db.close()

    def test_callback_stream_must_join_before_reuse(self):
        class StuckCallback:
            def __init__(self):
                self.joined = False
            def join(self, timeout=None):
                self.joined = True
            def is_alive(self):
                return True
        with tempfile.TemporaryDirectory() as tmp:
            boundary = a.Boundary(Path(tmp)/'agent', 'fixture-callback-secret-' * 3, {'nodeId':'worker-callback','generation':1,'chatId':-100,'threadId':42})
            agent = a.Agent(boundary, 'https://control.example', exit_on_crash=lambda _:None)
            agent.stop_core = lambda: None
            callback = StuckCallback()
            try:
                agent.dispatch(boundary.envelope('retire', {'sanitize': True}))
                agent.callback_owner = callback
                with patch.object(cloud_bootstrap, 'resolve_cloud_identity', side_effect=AssertionError('bootstrap must not run')):
                    with self.assertRaisesRegex(RuntimeError, 'callback stream did not join'):
                        agent.rotate_binding({'bootstrapToken':'fixture_callback_' * 4})
                self.assertTrue(callback.joined)
                self.assertEqual(agent.readiness_state(), 'retiring')
            finally:
                boundary.db.close()

    def test_bound_live_worker_rejects_rotation_before_retirement(self):
        with tempfile.TemporaryDirectory() as tmp:
            boundary = a.Boundary(Path(tmp)/'agent', 'fixture-bound-secret-' * 4, {'nodeId':'worker-01','generation':1,'chatId':-100,'threadId':42})
            agent = a.Agent(boundary, 'https://control.example', exit_on_crash=lambda _:None)
            with patch.object(cloud_bootstrap, 'resolve_cloud_identity', side_effect=AssertionError('bootstrap contacted')):
                with self.assertRaisesRegex(ValueError, 'clean retired worker'):
                    agent.rotate_binding({'bootstrapToken':'fixture_bound_' * 4})
            boundary.db.close()

    def test_rotation_reply_uses_previous_secret_and_bootstraps_replacement(self):
        import io
        import threading
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as tmp:
            old = a.Boundary(Path(tmp)/'old', 's'*64, {'nodeId':'worker-01','generation':1,'chatId':0,'threadId':0})
            new = a.Boundary(Path(tmp)/'new', 't'*64, {'nodeId':'worker-01','generation':2,'chatId':-100,'threadId':42})
            replacement = SimpleNamespace(boundary=new, bootstrap=lambda:None)
            agent = SimpleNamespace(boundary=old, rotate_binding=lambda payload:replacement)
            request = old.envelope('binding.rotate', {'bootstrapToken':'b'*64})
            raw = a.canonical(request)
            handler = a.Handler.__new__(a.Handler)
            handler.path = '/rpc'
            handler.connection = SimpleNamespace(settimeout=lambda _:None)
            handler.rfile = io.BytesIO(raw)
            handler.headers = {'Content-Length':str(len(raw)), 'x-node-signature':old.signature(raw)}
            handler.server = SimpleNamespace(agent=agent, rotation_lock=threading.RLock())
            replies = []
            handler.respond = lambda status, body, signed=False, boundary=None:replies.append((status,body,signed,boundary))
            with patch.object(a.threading, 'Thread') as thread:
                handler.do_POST()
                thread.return_value.start.assert_called_once()
            self.assertIs(handler.server.agent,replacement)
            self.assertEqual(replies[0][0],200)
            self.assertIs(replies[0][3],old)
            self.assertEqual(replies[0][1]['generation'],1)
            self.assertEqual(replies[0][1]['payload']['result']['identity'],new.identity)
            old.db.close()
            new.db.close()
