import json
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).parents[2] / 'worker'))
from github_api_proxy import GitHubApiProxy, api_request
from credential_broker import CredentialBroker
from provider_proxy import PinnedConnection


class ApiRequestTests(unittest.TestCase):
    def test_valid_requests_are_normalized(self):
        self.assertEqual(api_request({'path': '/user'}), ('GET', '/user', None))
        self.assertEqual(api_request({'method': 'POST', 'path': '/repos/a/b', 'body': '{}'}), ('POST', '/repos/a/b', b'{}'))
        self.assertEqual(api_request({'path': '/user/repos?per_page=30&sort=updated'})[1], '/user/repos?per_page=30&sort=updated')

    def test_invalid_routes_methods_and_bodies_fail_closed(self):
        for request in [
            {'method': 'GET', 'path': '/user', 'body': 'x'},
            {'method': 'HEAD', 'path': '/user'},
            {'method': 'GET', 'path': 'user'},
            {'method': 'GET', 'path': 'https://evil.example/user'},
            {'method': 'GET', 'path': '/../user'},
            {'method': 'GET', 'path': '/user\nX: 1'},
            {'method': 'GET', 'path': '/user', 'extra': 'x'},
            {'path': '/user', 'body': 7},
            {'method': 'DELETE', 'path': '/x', 'body': 'y'},
        ]:
            with self.assertRaises(ValueError, msg=repr(request)):
                api_request(request)


class GitHubApiProxyTests(unittest.TestCase):
    def make_agent(self, calls, token='fixture-private-token', configured=True):
        identity = dict(nodeId='fixture', generation=1, chatId=-100, threadId=42)
        references = [{'integrationId': 'github', 'credentialId': 'reference', 'configured': True}] if configured else []
        agent = SimpleNamespace(ready=True, retired=False,
            boundary=SimpleNamespace(unbound=False, identity=identity, get=lambda _: 'session',
                snapshot={'credentialReferences': references}))
        def outbound(operation, payload, session=None):
            calls.append((operation, payload))
            return {'leaseId': 'fixture-lease', 'expiresAt': (time.time() + 55) * 1000,
                    'value': token} if operation == 'credential.acquire' else {'valid': True}
        agent.outbound = outbound
        agent.credentials = CredentialBroker(agent)
        return agent

    def start_backend(self, respond):
        seen = {}
        class Backend(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass
            def do_GET(self):
                seen['path'] = self.path
                seen['authorization'] = self.headers.get('Authorization')
                seen['accept'] = self.headers.get('Accept')
                status, body = respond()
                raw = json.dumps(body).encode()
                self.send_response(status)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)
        backend = ThreadingHTTPServer(('127.0.0.1', 0), Backend)
        threading.Thread(target=backend.serve_forever, daemon=True).start()
        return backend, seen

    def local_connection(self, backend):
        class LocalConnection(PinnedConnection):
            def __init__(self):
                super().__init__('local', '127.0.0.1')
            def connect(self):
                if self.cancelled.is_set():
                    raise OSError('retired')
                import socket
                stream = socket.create_connection(backend.server_address, timeout=5)
                with self.socket_lock:
                    if self.cancelled.is_set():
                        stream.close()
                        raise OSError('retired')
                    self.sock = stream
        return LocalConnection

    def post(self, proxy, payload):
        from urllib.request import urlopen
        from urllib.error import HTTPError
        request = json.dumps(payload).encode()
        try:
            with urlopen(f'http://127.0.0.1:{proxy.server.server_port}/', data=request, timeout=10) as response:
                return response.status, json.loads(response.read())
        except HTTPError as error:
            return error.code, error.read()

    def test_session_access_bearer_injection_and_status_passthrough(self):
        calls = []
        agent = self.make_agent(calls)
        backend, seen = self.start_backend(lambda: (200, {'login': 'octocat'}))
        proxy = GitHubApiProxy(agent, port=0, connection=self.local_connection(backend))
        proxy.start()
        try:
            status, reply = self.post(proxy, {'path': '/user'})
            self.assertEqual(status, 200)
            self.assertEqual(reply, {'status': 200, 'body': {'login': 'octocat'}})
            self.assertEqual(seen['path'], '/user')
            self.assertEqual(seen['authorization'], 'Bearer fixture-private-token')
            self.assertEqual(seen['accept'], 'application/vnd.github+json')
            acquired = [payload for operation, payload in calls if operation == 'credential.acquire']
            self.assertEqual(len(acquired), 1)
            self.assertEqual(acquired[0]['capability'], 'session.access')
            self.assertNotIn('resource', acquired[0])
        finally:
            proxy.close()
            backend.shutdown()
            backend.server_close()

    def test_credential_echo_in_response_is_rejected(self):
        calls = []
        agent = self.make_agent(calls)
        backend, _ = self.start_backend(lambda: (200, {'leak': 'fixture-private-token'}))
        proxy = GitHubApiProxy(agent, port=0, connection=self.local_connection(backend))
        proxy.start()
        try:
            status, body = self.post(proxy, {'path': '/user'})
            self.assertEqual(status, 403)
            self.assertEqual(body, b'GitHub capability rejected')
        finally:
            proxy.close()
            backend.shutdown()
            backend.server_close()

    def test_redirect_is_rejected(self):
        calls = []
        agent = self.make_agent(calls)
        backend, _ = self.start_backend(lambda: (302, {'moved': True}))
        proxy = GitHubApiProxy(agent, port=0, connection=self.local_connection(backend))
        proxy.start()
        try:
            status, body = self.post(proxy, {'path': '/user'})
            self.assertEqual(status, 403)
            self.assertEqual(body, b'GitHub capability rejected')
        finally:
            proxy.close()
            backend.shutdown()
            backend.server_close()

    def test_upstream_401_passes_through_for_the_tool_to_gate(self):
        calls = []
        agent = self.make_agent(calls)
        backend, _ = self.start_backend(lambda: (401, {'message': 'Bad credentials'}))
        proxy = GitHubApiProxy(agent, port=0, connection=self.local_connection(backend))
        proxy.start()
        try:
            status, reply = self.post(proxy, {'path': '/user'})
            self.assertEqual(status, 200)
            self.assertEqual(reply['status'], 401)
            self.assertEqual(reply['body'], {'message': 'Bad credentials'})
        finally:
            proxy.close()
            backend.shutdown()
            backend.server_close()

    def test_unconfigured_snapshot_never_requests_a_credential(self):
        calls = []
        agent = self.make_agent(calls, configured=False)
        proxy = GitHubApiProxy(agent, port=0, connection=None)
        proxy.start()
        try:
            status, body = self.post(proxy, {'path': '/user'})
            self.assertEqual(status, 403)
            self.assertEqual(calls, [])
        finally:
            proxy.close()

    def test_invalid_listener_route_and_payload_fail_closed(self):
        from urllib.error import HTTPError
        from urllib.request import urlopen
        calls = []
        agent = self.make_agent(calls)
        proxy = GitHubApiProxy(agent, port=0, connection=None)
        proxy.start()
        try:
            for path, data in [('/other', b'{}'), ('/', b'not-json'), ('/', json.dumps({'path': 'relative'}).encode())]:
                with self.assertRaises(HTTPError) as caught:
                    urlopen(f'http://127.0.0.1:{proxy.server.server_port}{path}', data=data, timeout=10)
                self.assertEqual(caught.exception.code, 403)
            self.assertEqual(calls, [])
        finally:
            proxy.close()

    def test_retirement_closes_connections_and_fences_epoch(self):
        calls = []
        agent = self.make_agent(calls)
        proxy = GitHubApiProxy(agent, port=0, connection=None)
        closed = []
        class Stream:
            def shutdown(self, _):
                closed.append('shutdown')
        class Connection:
            sock = None
            def close(self):
                closed.append('close')
        proxy.register(Stream(), Connection(), proxy.epoch)
        epoch = proxy.epoch
        proxy.close_active()
        self.assertGreater(proxy.epoch, epoch)
        self.assertIn('shutdown', closed)
        self.assertIn('close', closed)
        with self.assertRaises(ValueError):
            proxy.register(object(), None, epoch)
        proxy.close()


if __name__ == '__main__':
    unittest.main()
