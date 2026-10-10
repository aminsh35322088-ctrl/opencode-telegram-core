"""Root-only, request-scoped credential injection. No credential leaves this process."""
import http.client
import ipaddress
import json
import secrets
import socket
import ssl
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
from credential_transport import LeaseTransport

MAX_REQUEST = 10 * 1024 * 1024
ALLOWED_PATHS = {'/chat/completions', '/completions', '/responses', '/messages', '/models'}


def provider_endpoint(url):
    parsed = urlsplit(url)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.port not in (None, 443):
        raise ValueError('provider endpoint must be clean HTTPS on port 443')
    host = parsed.hostname
    if host.lower() in ('localhost',) or host.lower().endswith(('.localhost', '.local', '.internal')):
        raise ValueError('private provider endpoint forbidden')
    addresses = {record[4][0] for record in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)}
    if not addresses or any(not ipaddress.ip_address(address).is_global or ipaddress.ip_address(address).is_multicast or ipaddress.ip_address(address).is_reserved for address in addresses):
        raise ValueError('nonpublic provider address forbidden')
    return host, parsed.path.rstrip('/'), sorted(addresses)[0]


class PinnedConnection(http.client.HTTPSConnection):
    """Retirement cancels both pending TCP/TLS establishment and established I/O."""
    def __init__(self, host, address):
        super().__init__(host, 443, timeout=55, context=ssl.create_default_context())
        self.address = address
        self.response_socket = None
        self.response = None
        self.receiving_headers = False
        self.header_thread = None
        self.cancelled = threading.Event()
        self.socket_lock = threading.RLock()
        self.pending_socket = None

    def connect(self):
        if self.cancelled.is_set():
            raise OSError('credential connection cancelled')
        stream = socket.socket(socket.AF_INET6 if ':' in self.address else socket.AF_INET, socket.SOCK_STREAM)
        stream.settimeout(self.timeout)
        with self.socket_lock:
            if self.cancelled.is_set():
                stream.close()
                raise OSError('credential connection cancelled')
            self.pending_socket = stream
        try:
            stream.connect((self.address, 443))
            secure = self._context.wrap_socket(stream, server_hostname=self.host, do_handshake_on_connect=False)
            with self.socket_lock:
                if self.cancelled.is_set():
                    secure.close()
                    raise OSError('credential connection cancelled')
                self.pending_socket = secure
            secure.do_handshake()
            with self.socket_lock:
                if self.cancelled.is_set():
                    secure.close()
                    raise OSError('credential connection cancelled')
                self.sock = secure
                self.pending_socket = None
        except BaseException:
            self.close()
            raise

    def getresponse(self):
        self.receiving_headers = True
        self.header_thread = threading.get_ident()
        self.response_socket = self.sock
        try:
            self.response = super().getresponse()
            return self.response
        finally:self.receiving_headers = False;self.header_thread = None

    def close(self):
        # http.client detaches a Connection: close socket once headers arrive;
        # its response still owns a file reference until body consumption ends.
        if self.receiving_headers and self.header_thread == threading.get_ident():
            super().close();return
        self.cancelled.set()
        with self.socket_lock:
            sockets = [self.pending_socket, self.sock, self.response_socket]
            self.pending_socket = None
            self.sock = None
            self.response_socket = None
        for stream in sockets:
            if stream is not None:
                try:
                    stream.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
                stream.close()
        super().close()
        self._buffer.clear()
        response, self.response = self.response, None
        if response is not None:response.close()


class ProviderProxy:
    def __init__(self, agent, port=4097):
        self.agent = agent
        self.port = port
        self.providers = {}
        self.leases = {}
        self.lock = threading.RLock()
        self.server = None
        self.epoch = 0
        self.transports = set()
        self.connections = set()

    def close_active(self):
        with self.lock:
            self.epoch += 1
            transports, connections = list(self.transports), list(self.connections)
            self.transports.clear();self.connections.clear()
        for transport in transports:transport.close()
        for connection in connections:connection.close()

    def owner(self):
        boundary = self.agent.boundary
        return (boundary.get('session'), boundary.get('runId'), getattr(self.agent, 'process_epoch', None),
                getattr(getattr(self.agent, 'mcp_proxy', None), 'active', None))

    def live(self, epoch, owner):
        with self.lock:
            return (self.epoch == epoch and self.owner() == owner and self.agent.ready
                    and not self.agent.retired and not self.agent.boundary.unbound)

    def rewrite(self, configuration, references):
        self.close_active()
        # JSON round trip ensures no mutation of the signed snapshot.
        result = json.loads(json.dumps(configuration))
        providers = {}
        for name, provider in result.get('provider', {}).items():
            options = provider.get('options', {})
            key = options.get('apiKey')
            if not isinstance(key, str) or not key.startswith('bot-credential-proxy:'):
                continue
            parts = key[len('bot-credential-proxy:'):].rsplit(':', 1)
            if len(parts) != 2 or not parts[0] or not parts[1]:
                raise ValueError('invalid provider capability reference')
            capability, credential_id = parts
            # Credential references are metadata, never secret values.
            # Control plane remains authoritative for exact enabled capability authorization.
            if not references:
                raise ValueError('provider capability has no declared references')
            endpoint = options.get('baseURL')
            if not isinstance(endpoint, str):
                raise ValueError('provider capability requires explicit endpoint')
            parsed = urlsplit(endpoint)
            if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
                raise ValueError('provider capability endpoint invalid')
            route = secrets.token_hex(16)
            canonical = [ref for ref in references if isinstance(ref,dict) and ref.get('integrationId') == 'provider:' + name
                         and ref.get('credentialId') == credential_id and ref.get('configured') is True]
            providers[route] = dict(name=name, endpoint=endpoint, capability=capability, credentialId=credential_id,
                                    integrationId='provider:' + name if len(canonical) == 1 else None)
            options['baseURL'] = 'http://127.0.0.1:' + str(self.port) + '/proxy/' + route
            options['apiKey'] = 'local-capability'
            options.pop('headers', None)
        with self.lock:
            self.providers = providers
            self.leases = {}
        return result

    def acquire(self, provider):
        if not provider.get('integrationId'):return None
        return self.agent.credentials.acquire(dict(integrationId=provider['integrationId'],
            credentialId=provider['credentialId'], capability='provider.request', scopes=['provider.request']))

    def credential(self, provider):
        if self.agent.boundary.unbound:
            raise ValueError('unbound node authority unavailable')
        key = (provider['capability'], provider['credentialId'])
        now = time.time()
        session = self.agent.boundary.get('session')
        if not session:
            raise ValueError('bound session required for provider capability')
        reply = self.agent.outbound('credential.get', dict(capability=key[0], credentialId=key[1], purpose='provider.request'), session=session)
        expires = reply.get('expiresAt')
        value = reply.get('value')
        if not isinstance(value, str) or not value or len(value) > 16384 or '\r' in value or '\n' in value or type(expires) not in (int, float):
            raise ValueError('invalid credential lease')
        expires = expires / 1000
        if expires <= now:
            raise ValueError('credential lease expired')
        return value

    def start(self):
        if self.server is not None:
            return
        proxy = self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_GET(self):
                self.forward()

            def do_POST(self):
                self.forward()

            def forward(self):
                connection = None
                lease = None
                transport = None
                started = False
                try:
                    if proxy.agent.boundary.unbound or not proxy.agent.ready or proxy.agent.retired:
                        raise ValueError('capability unavailable')
                    parts = self.path.split('/', 3)
                    if len(parts) != 4 or parts[1] != 'proxy':
                        raise ValueError('invalid proxy route')
                    route, suffix = parts[2], '/' + parts[3]
                    with proxy.lock:
                        provider = proxy.providers.get(route)
                        epoch, owner = proxy.epoch, proxy.owner()
                    if provider is None or suffix not in ALLOWED_PATHS or (self.command == 'GET' and suffix != '/models'):
                        raise ValueError('unauthorized provider path')
                    length = int(self.headers.get('Content-Length', '0'))
                    if not 0 <= length <= MAX_REQUEST or self.headers.get('Transfer-Encoding'):
                        raise ValueError('invalid provider body')
                    self.connection.settimeout(60)
                    body = self.rfile.read(length)
                    if len(body) != length:
                        raise ValueError('truncated provider body')
                    host, prefix, address = provider_endpoint(provider['endpoint'])
                    lease = proxy.acquire(provider)
                    connection = PinnedConnection(host, address)
                    with proxy.lock:
                        if not proxy.live(epoch, owner):raise ValueError('provider owner retired')
                        proxy.connections.add(connection)
                        transport = LeaseTransport(lease, connection, lambda:proxy.live(epoch, owner), downstream=self.connection)
                        proxy.transports.add(transport)
                    credential = lease.consume(lambda value:value) if lease else proxy.credential(provider)
                    transport.forward(lambda:None)
                    headers = {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + credential,
                               'Accept': self.headers.get('Accept', 'application/json')}
                    # Anthropic's compatible API uses the same exact capability credential.
                    if suffix == '/messages':
                        headers['x-api-key'] = credential
                        headers['anthropic-version'] = '2023-06-01'
                    connection.request(self.command, prefix + suffix, body=body or None, headers=headers)
                    response = connection.getresponse()
                    if 300 <= response.status < 400:
                        raise ValueError('provider redirect rejected')
                    content_type = response.getheader('Content-Type', 'application/json')
                    if (not isinstance(content_type, str) or len(content_type) > 4096 or credential in content_type
                            or any(ord(char) < 32 or ord(char) == 127 for char in content_type)):
                        raise ValueError('unsafe provider response header')
                    def send_headers():
                        self.send_response(response.status)
                        self.send_header('Content-Type', content_type)
                        self.send_header('Connection', 'close')
                        self.end_headers()
                    transport.forward(send_headers)
                    started = True
                    pending, total = b'', 0
                    while True:
                        transport.forward(lambda:None)
                        chunk = response.read1(65536)
                        total += len(chunk)
                        if total > 32 * 1024 * 1024:raise ValueError('provider response exceeds bound')
                        transport.forward(lambda:None)
                        combined = pending + chunk
                        if credential.encode() in combined:
                            raise ValueError('provider echoed credential')
                        if not chunk:
                            transport.forward(lambda:(self.wfile.write(combined), self.wfile.flush()))
                            break
                        hold = max(0, len(credential.encode()) - 1)
                        if hold:
                            pending = combined[-hold:]
                            outgoing = combined[:-hold]
                        else:
                            pending, outgoing = b'', combined
                        transport.forward(lambda:(self.wfile.write(outgoing), self.wfile.flush()))
                except Exception:
                    if not started:
                        self.send_response(503)
                        self.send_header('Content-Type', 'application/json')
                        self.send_header('Connection', 'close')
                        self.end_headers()
                        self.wfile.write(b'{"error":"provider capability unavailable"}')
                finally:
                    credential = None
                    if 'headers' in locals():headers.clear()
                    pending = b''
                    if transport:transport.close()
                    with proxy.lock:
                        proxy.transports.discard(transport);proxy.connections.discard(connection)
                    if connection:connection.close()
                    if lease:lease.release()
        self.server = ThreadingHTTPServer(('127.0.0.1', self.port), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
