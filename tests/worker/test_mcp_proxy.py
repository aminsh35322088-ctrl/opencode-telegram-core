import sys
from pathlib import Path
import unittest
from unittest.mock import patch
from urllib.request import Request, urlopen
from urllib.error import HTTPError
sys.path.insert(0, str(Path(__file__).parents[2] / 'worker'))
import mcp_proxy as p


class Agent:
    boundary = type("Boundary", (), {"unbound": False})()
    ready = True
    retired = False
    def __init__(self):
        self.calls = []
        self.reply = {'headers': {'Authorization': 'Bearer fixture-mcp-secret'}, 'expiresAt': p.time.time() * 1000 + 60000}
    def outbound(self, operation, payload, session=None):
        self.calls.append((operation, payload, session))
        return self.reply


class MCPTests(unittest.TestCase):
    def setUp(self):
        self.agent = Agent()
        self.proxy = p.MCPProxy(self.agent, port=0)
        self.original = {'mcp': {'tools': {'type': 'remote', 'url': 'https://mcp.example/api', 'enabled': True}}}
        self.ref = {'id': 'a' * 64, 'kind': 'mcp', 'capability': 'mcp:tools', 'configured': True}
        self.config = self.proxy.rewrite(self.original, [self.ref])
        self.route = next(iter(self.proxy.routes))
        self.proxy.begin('session-one', 'run-one')

    def test_rewrite_secret_free_and_no_outbound_until_request(self):
        self.assertEqual(self.agent.calls, [])
        self.assertFalse(self.config['mcp']['tools']['oauth'])
        self.assertEqual(self.original['mcp']['tools']['url'], 'https://mcp.example/api')
        self.assertNotIn('fixture-mcp-secret', str(self.config))

    def test_unsupported_endpoint_disables_only_that_runtime_capability(self):
        config = self.proxy.rewrite({'model': 'ordinary', 'mcp': {
            'unsafe': {'type': 'remote', 'url': 'http://private.invalid/api'},
            'tools': self.original['mcp']['tools']}}, [self.ref])
        self.assertEqual(config['model'], 'ordinary')
        self.assertFalse(config['mcp']['unsafe']['enabled'])
        self.assertEqual(len(self.proxy.routes), 1)
        self.assertIn('unsafe', self.proxy.unavailable)
        self.assertEqual(self.agent.calls, [])

    def test_exact_session_endpoint_lease_and_clearing_on_rewrite(self):
        route = self.proxy.routes[self.route]
        self.proxy.credential(route, ('session-one', 'run-one'))
        self.proxy.credential(route, ('session-one', 'run-one'))
        self.assertEqual(len(self.agent.calls), 1)
        self.assertEqual(self.agent.calls[0], ('credential.get', {'purpose': 'mcp.request', 'capability': 'mcp:tools', 'credentialId': 'a' * 64, 'endpoint': 'https://mcp.example/api'}, 'session-one'))
        self.proxy.begin('session-two', 'run-two')
        self.proxy.credential(route, ('session-two', 'run-two'))
        self.assertEqual(len(self.agent.calls), 2)
        self.proxy.rewrite(self.original, [self.ref])
        self.assertEqual(self.proxy.leases, {})
        self.assertIsNone(self.proxy.active)

    def test_unsafe_lease_headers_and_expiry_fail_closed(self):
        for headers in ({'Host': 'evil'}, {'Authorization': 'Bearer x\r\nInjected: x'}, {'Mcp-Session-Id': 'secret'}, {'Cookie': 'x'}):
            self.agent.reply['headers'] = headers
            with self.assertRaises(ValueError):
                self.proxy.credential(self.proxy.routes[self.route], self.proxy.active)
        self.agent.reply = {'headers': {'Authorization': 'Bearer x'}, 'expiresAt': 1}
        with self.assertRaises(ValueError):
            self.proxy.credential(self.proxy.routes[self.route], self.proxy.active)

    def test_idle_closes_live_socket_and_invalidates_lease(self):
        class Socket:
            closed = False
            def shutdown(self, _):
                self.closed = True
        class Connection:
            sock = Socket()
            closed = False
            def close(self):
                self.closed = True
        connection = Connection()
        self.proxy.connections.add(connection)
        self.proxy.credential(self.proxy.routes[self.route], self.proxy.active)
        self.proxy.end('foreign-session', 'run-one')
        self.assertFalse(connection.closed)
        self.proxy.end('session-one', 'run-one')
        self.assertTrue(connection.closed)
        self.assertTrue(connection.sock.closed)
        self.assertFalse(self.proxy.connections)
        self.assertFalse(self.proxy.leases)

    def test_unauthenticated_server_no_lease_and_private_dns_rejected(self):
        self.proxy.rewrite(self.original, [])
        self.proxy.begin('session-one', 'run-one')
        route = next(iter(self.proxy.routes.values()))
        self.assertEqual(self.proxy.credential(route, self.proxy.active), {})
        self.assertEqual(self.agent.calls, [])
        from unittest.mock import patch
        import provider_proxy
        for address in ('127.0.0.1', '169.254.169.254', '10.0.0.1', '::1'):
            with patch.object(provider_proxy.socket, 'getaddrinfo', return_value=[(2, 1, 6, '', (address, 443))]):
                with self.assertRaises(ValueError):
                    p.provider_endpoint('https://mcp.example/api')

    def http(self, chunks, status=200, content_type='application/json', caller_headers=None):
        captured = []
        class Connection:
            def __init__(self, *_):
                self.chunks = list(chunks)
            def request(self, method, path, body=None, headers=None):
                captured.append((method, path, headers))
            def getresponse(self):
                return self
            def getheader(self, name, default=None):
                return content_type if name.lower() == 'content-type' else default
            def read1(self, _):
                return self.chunks.pop(0) if self.chunks else b''
            def close(self):
                pass
        Connection.status = status
        self.proxy.start()
        try:
            with patch.object(p, 'provider_endpoint', return_value=('mcp.example', '/api', '8.8.8.8')), patch.object(p, 'PinnedConnection', Connection):
                url = 'http://127.0.0.1:' + str(self.proxy.server.server_port) + self.route
                with urlopen(Request(url, data=b'{}', headers=caller_headers or {})) as response:
                    output = response.read()
            return output, captured
        finally:
            self.proxy.server.shutdown()
            self.proxy.server.server_close()

    def test_exact_endpoint_protocol_semantics_and_auth_injection(self):
        output, captured = self.http([b'{"jsonrpc":"2.0","result":{}}', b''], caller_headers={'Authorization': 'Bearer attacker', 'Mcp-Session-Id': 'mcp-session', 'Mcp-Protocol-Version': '2025-03-26'})
        self.assertEqual(output, b'{"jsonrpc":"2.0","result":{}}')
        self.assertEqual(captured[0][1], '/api')
        self.assertEqual(captured[0][2]['Authorization'], 'Bearer fixture-mcp-secret')
        self.assertEqual(captured[0][2]['mcp-session-id'], 'mcp-session')

    def test_split_secret_echo_never_reaches_core(self):
        output, _ = self.http([b'fixture-mcp-', b'secret', b''])
        self.assertEqual(output, b'')

    def test_sse_complete_event_and_legacy_endpoint_rejection(self):
        packet = b'event: message\ndata: {"result":{}}\n\n'
        output, _ = self.http([packet, b''], content_type='text/event-stream')
        self.assertEqual(output, packet)
        self.proxy.server = None
        output, _ = self.http([b'event: end', b'point\ndata: https://evil.example/messages\n\n'], content_type='text/event-stream')
        self.assertEqual(output, b'')

    def test_inactive_capability_and_redirect_fail_closed(self):
        self.proxy.close_active()
        with self.assertRaises(HTTPError):
            self.http([b'{}'])
        self.proxy.server = None
        self.proxy.begin('session-one', 'run-one')
        with self.assertRaises(HTTPError):
            self.http([b'{}'], status=302)


class CancellationTests(unittest.TestCase):
    def test_blocked_lease_does_not_hold_retirement_lock(self):
        import threading
        entered, release = threading.Event(), threading.Event()
        agent = Agent()
        def outbound(*args, **kwargs):
            entered.set()
            release.wait(2)
            return agent.reply
        agent.outbound = outbound
        proxy = p.MCPProxy(agent)
        proxy.active = ('session', 'run')
        route = dict(credentialId='a' * 64, capability='mcp:tools', endpoint='https://mcp.example/api')
        errors = []
        def lease():
            try: proxy.credential(route, ('session', 'run'))
            except ValueError as error: errors.append(error)
        thread = threading.Thread(target=lease)
        thread.start()
        self.assertTrue(entered.wait(1))
        ended = threading.Event()
        retirement = threading.Thread(target=lambda: (proxy.end('session', 'run'), ended.set()))
        retirement.start()
        try:
            self.assertTrue(ended.wait(.25), 'retirement blocked behind credential network request')
        finally:
            release.set(); thread.join(2); retirement.join(2)
        self.assertTrue(errors)
        self.assertEqual(proxy.leases, {})

    def test_cancelled_connection_cannot_open_a_late_socket(self):
        connection = p.PinnedConnection('mcp.example', '8.8.8.8')
        connection.close()
        with patch.object(p.socket, 'socket') as create:
            with self.assertRaises(OSError): connection.connect()
            create.assert_not_called()


    def test_retirement_cancels_pending_tcp_without_waiting_for_connect(self):
        import threading
        entered, released = threading.Event(), threading.Event()
        class Stream:
            closed = False
            def settimeout(self, _): pass
            def connect(self, _):
                entered.set()
                released.wait(2)
                raise OSError('cancelled synthetic connect')
            def shutdown(self, _): released.set()
            def close(self): self.closed = True; released.set()
        stream = Stream()
        connection = p.PinnedConnection('mcp.example', '8.8.8.8')
        proxy = p.MCPProxy(Agent())
        proxy.active = ('session', 'run')
        proxy.connections.add(connection)
        errors = []
        def connect():
            try: connection.connect()
            except OSError as error: errors.append(error)
        with patch.object(p.socket, 'socket', return_value=stream):
            thread = threading.Thread(target=connect)
            thread.start()
            self.assertTrue(entered.wait(1))
            try:
                proxy.end('session', 'run')
                thread.join(.25)
                self.assertFalse(thread.is_alive(), 'retirement did not cancel pending TCP socket')
            finally:
                released.set(); thread.join(2)
        self.assertTrue(stream.closed)
        self.assertTrue(connection.cancelled.is_set())
        self.assertTrue(errors)
        self.assertFalse(proxy.connections)
