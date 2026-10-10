"""Root-owned Streamable HTTP MCP capability proxy; leases never enter Core."""
import json
import re
import secrets
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
from credential_transport import LeaseTransport
from provider_proxy import provider_endpoint, PinnedConnection as BasePinnedConnection

MAX_REQUEST = 10 * 1024 * 1024
MAX_RESPONSE = 32 * 1024 * 1024
FORBIDDEN = {'host', 'connection', 'content-length', 'transfer-encoding', 'cookie', 'set-cookie',
             'proxy-authorization', 'proxy-authenticate', 'upgrade', 'trailer', 'te'}
PROTOCOL = {'content-type', 'accept', 'mcp-session-id', 'mcp-protocol-version', 'last-event-id'}


class PinnedConnection(BasePinnedConnection):
    pass


class MCPProxy:
    def __init__(self, agent, port=4099):
        self.agent, self.port = agent, port
        self.routes, self.leases, self.connections = {}, {}, set()
        self.lock = threading.RLock()
        self.epoch = 0
        self.transports = set()
        self.active = None
        self.unavailable = {}
        self.server = None
        self.slots = threading.BoundedSemaphore(4)

    def _detach(self):
        # Caller owns self.lock; no socket/gate joining under this lock.
        self.active = None
        self.epoch += 1
        resources = list(self.transports), list(self.connections)
        self.transports.clear();self.connections.clear();self.leases.clear()
        return resources

    @staticmethod
    def _close(resources):
        transports, connections = resources
        for transport in transports:transport.close()
        for connection in connections:
            if getattr(connection, 'sock', None):
                try:connection.sock.shutdown(socket.SHUT_RDWR)
                except OSError:pass
            connection.close()

    def close_active(self):
        with self.lock:resources = self._detach()
        self._close(resources)

    def live(self, epoch, owner):
        with self.lock:
            return (self.epoch == epoch and self.active == owner and self.agent.ready
                    and not self.agent.retired and not self.agent.boundary.unbound)

    def begin(self, session, run_id):
        if self.agent.boundary.unbound:
            raise ValueError('unbound node authority unavailable')
        self.close_active()
        with self.lock:
            self.active = (session, run_id)

    def end(self, session, run_id):
        with self.lock:
            if self.active != (session, run_id):return
            resources = self._detach()
        self._close(resources)

    def rewrite(self, configuration, references):
        self.close_active()
        result = json.loads(json.dumps(configuration))
        routes, unavailable = {}, {}
        for name, server in result.get('mcp', {}).items():
            if not isinstance(server, dict) or server.get('type') != 'remote':
                continue
            route = secrets.token_hex(16)
            endpoint = server.get('url')
            try:
                parsed = urlsplit(endpoint if isinstance(endpoint, str) else '')
                if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.port not in (None, 443):
                    raise ValueError('MCP endpoint must be clean HTTPS')
                refs = [ref for ref in references if isinstance(ref, dict) and ref.get('configured') is True and
                        (ref.get('integrationId') == 'mcp:' + name or (ref.get('kind') == 'mcp' and ref.get('capability') == 'mcp:' + name))]
                if len(refs) > 1 or (refs and not isinstance(refs[0].get('credentialId',refs[0].get('id')),str)):
                    raise ValueError('invalid MCP credential reference')
                routes['/mcp/' + route] = {'endpoint': endpoint, 'capability': 'mcp:' + name,
                                         'credentialId': refs[0].get('credentialId',refs[0].get('id')) if refs else None,
                                         'integrationId': 'mcp:' + name if refs and refs[0].get('integrationId') == 'mcp:' + name else None,
                                         'enabled': server.get('enabled', True) is True}
            except ValueError:
                # This is a transient runtime admission failure, not a canonical
                # per-Topic enabled setting. Ordinary AI remains available.
                server['enabled'] = False
                unavailable[name] = 'MCP transport unavailable'
            server['url'] = 'http://127.0.0.1:' + str(self.port) + '/mcp/' + route
            server['oauth'] = False
            server.pop('headers', None)
        with self.lock:
            self.routes = routes
            self.unavailable = unavailable
        return result

    def acquire(self, route, owner):
        with self.lock:
            if self.active != owner:raise ValueError('inactive MCP owner')
        if not route.get('integrationId'):return None
        return self.agent.credentials.acquire(dict(integrationId=route['integrationId'],
            credentialId=route['credentialId'], capability='mcp.request', scopes=['mcp.request']))

    @staticmethod
    def headers(material):
        headers = json.loads(material)
        if not isinstance(headers,dict) or not 0<len(headers)<=4:raise ValueError('invalid MCP material')
        for name,value in headers.items():
            if (not isinstance(name,str) or name.lower() not in {'authorization','x-api-key','x-goog-api-key','api-key'}
                or not isinstance(value,str) or not value or len(value)>16384
                or any(ord(c)<32 or ord(c)==127 for c in value)):raise ValueError('unsafe MCP material')
        return headers

    def credential(self, route, owner):
        if self.agent.boundary.unbound:
            raise ValueError('unbound node authority unavailable')
        if not route['credentialId']:
            return {}
        key = (owner[0], route['capability'], route['credentialId'], route['endpoint'])
        with self.lock:
            now = time.time()
            if self.active != owner:
                raise ValueError('inactive MCP owner')
        reply = self.agent.outbound('credential.get', {'purpose': 'mcp.request', 'capability': key[1],
            'credentialId': key[2], 'endpoint': key[3]}, session=owner[0])
        headers, expiry = reply.get('headers'), reply.get('expiresAt')
        now = time.time()
        if not isinstance(headers, dict) or not headers or len(headers) > 16 or type(expiry) not in (int, float) or expiry / 1000 <= now:
            raise ValueError('invalid MCP lease')
        clean = {}
        for name, value in headers.items():
            if not isinstance(name, str) or not re.fullmatch('[!#$%&\'*+.^_`|~0-9A-Za-z-]{1,128}', name) or name.lower() in FORBIDDEN | PROTOCOL or not isinstance(value, str) or not value or len(value) > 16384 or any(ord(char) < 32 or ord(char) == 127 for char in value):
                raise ValueError('unsafe MCP lease header')
            clean[name] = value
        with self.lock:
            if self.active != owner:
                raise ValueError('MCP owner retired during lease')
            return clean

    def start(self):
        if self.server:
            return
        proxy = self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass
            def do_POST(self):
                self.forward()
            def do_GET(self):
                self.forward()
            def do_DELETE(self):
                self.forward()
            def forward(self):
                connection, started, acquired, lease, transport = None, False, False, None, None
                try:
                    acquired = proxy.slots.acquire(blocking=False)
                    if not acquired:
                        raise ValueError('MCP concurrency exceeded')
                    with proxy.lock:
                        route, owner, epoch = proxy.routes.get(self.path), proxy.active, proxy.epoch
                    if not route or not route['enabled'] or not owner or not proxy.agent.ready or proxy.agent.retired:
                        raise ValueError('inactive MCP capability')
                    length = int(self.headers.get('Content-Length', '0'))
                    if not 0 <= length <= MAX_REQUEST or self.headers.get('Transfer-Encoding'):
                        raise ValueError('invalid MCP request size')
                    self.connection.settimeout(60)
                    body = self.rfile.read(length)
                    if len(body) != length:
                        raise ValueError('truncated MCP body')
                    host, _, address = provider_endpoint(route['endpoint'])
                    headers = {}
                    for name in PROTOCOL:
                        value = self.headers.get(name)
                        if value is not None:
                            if len(value) > 4096 or any(ord(char) < 32 or ord(char) == 127 for char in value):
                                raise ValueError('invalid MCP protocol header')
                            headers[name] = value
                    lease = proxy.acquire(route, owner)
                    connection = PinnedConnection(host, address)
                    with proxy.lock:
                        if not proxy.live(epoch, owner):raise ValueError('MCP owner retired')
                        proxy.connections.add(connection)
                        transport = LeaseTransport(lease, connection, lambda:proxy.live(epoch, owner), downstream=self.connection)
                        proxy.transports.add(transport)
                    leased = lease.consume(proxy.headers) if lease else proxy.credential(route, owner)
                    transport.forward(lambda:None)
                    headers.update(leased)
                    # Guard raw header values and common bearer-token echo variants.
                    needles = {value.encode() for value in leased.values()}
                    needles.update(value.split(' ', 1)[1].encode() for value in leased.values() if value.lower().startswith('bearer '))
                    # A registered cancellable connection cannot open a late socket,
                    # and network establishment never holds the retirement lock.
                    connection.request(self.command, urlsplit(route['endpoint']).path or '/', body=body or None, headers=headers)
                    response = connection.getresponse()
                    if 300 <= response.status < 400:
                        raise ValueError('MCP redirects forbidden')
                    safe_headers = []
                    for name in ('Content-Type', 'Mcp-Session-Id', 'Mcp-Protocol-Version'):
                        value = response.getheader(name)
                        if value is not None:
                            if len(value) > 4096 or any(needle in value.encode() for needle in needles) or any(ord(char) < 32 or ord(char) == 127 for char in value):
                                raise ValueError('unsafe MCP response header')
                            safe_headers.append((name, value))
                    def send_headers():
                        self.send_response(response.status)
                        for name, value in safe_headers:self.send_header(name, value)
                        self.send_header('Connection', 'close')
                        self.end_headers()
                    transport.forward(send_headers)
                    started = True
                    pending, total = b'', 0
                    hold = max([len(needle) - 1 for needle in needles] + [32])
                    is_sse = response.getheader('Content-Type', '').split(';', 1)[0].strip().lower() == 'text/event-stream'
                    while True:
                        transport.forward(lambda:None)
                        chunk = response.read1(65536)
                        transport.forward(lambda:None)
                        total += len(chunk)
                        if total > MAX_RESPONSE:
                            raise ValueError('MCP stream bound reached')
                        combined = pending + chunk
                        # Legacy SSE endpoint events could bypass the local proxy.
                        if any(needle in combined for needle in needles) or re.search(br'(?m)^event:[ \t]*endpoint[ \t]*\r?$', combined):
                            raise ValueError('unsafe MCP response')
                        if is_sse:
                            if len(combined) > MAX_REQUEST:
                                raise ValueError('MCP event exceeds bound')
                            # Complete events must reach SDK immediately even if
                            # an upstream keeps its connection open indefinitely.
                            split = list(re.finditer(br'\r?\n\r?\n', combined))
                            end = split[-1].end() if split else 0
                            outgoing, pending = combined[:end], combined[end:]
                            transport.forward(lambda:(self.wfile.write(outgoing), self.wfile.flush()))
                            if not chunk:
                                if pending.strip():
                                    raise ValueError('truncated MCP event')
                                break
                            continue
                        if not chunk:
                            transport.forward(lambda:(self.wfile.write(combined), self.wfile.flush()))
                            break
                        pending, outgoing = combined[-hold:], combined[:-hold]
                        transport.forward(lambda:(self.wfile.write(outgoing), self.wfile.flush()))
                except Exception:
                    if not started:
                        self.send_response(503)
                        self.send_header('Content-Type', 'application/json')
                        self.send_header('Connection', 'close')
                        self.end_headers()
                        self.wfile.write(b'{"error":"MCP capability unavailable"}')
                finally:
                    if 'headers' in locals():headers.clear()
                    if 'leased' in locals():leased.clear()
                    if 'needles' in locals():needles.clear()
                    pending = b''
                    if transport:transport.close()
                    with proxy.lock:proxy.transports.discard(transport)
                    if connection:
                        with proxy.lock:
                            proxy.connections.discard(connection)
                        connection.close()
                    if lease:lease.release()
                    if acquired:
                        proxy.slots.release()
        self.server = ThreadingHTTPServer(('127.0.0.1', self.port), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
