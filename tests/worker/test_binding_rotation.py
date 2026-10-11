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
            agent.dispatch({'operation':'retire','payload':{'sanitize':True}})
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
            agent.dispatch({'operation':'retire','payload':{'sanitize':True}})
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

    def test_live_worker_rejects_rotation_before_bootstrap(self):
        with tempfile.TemporaryDirectory() as tmp:
            boundary = a.Boundary(Path(tmp)/'agent', 's'*64, {'nodeId':'worker-01','generation':1,'chatId':0,'threadId':0})
            agent = a.Agent(boundary, 'https://control.example', exit_on_crash=lambda _:None)
            with patch.object(cloud_bootstrap, 'resolve_cloud_identity', side_effect=AssertionError('bootstrap contacted')):
                with self.assertRaises(ValueError):agent.rotate_binding({'bootstrapToken':'b'*64})
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
