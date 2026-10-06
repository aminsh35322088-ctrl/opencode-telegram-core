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
    def __init__(self, host, address):
        super().__init__(host, 443, timeout=60, context=ssl.create_default_context())
        self.address = address

    def connect(self):
        stream = socket.create_connection((self.address, 443), self.timeout)
        self.sock = self._context.wrap_socket(stream, server_hostname=self.host)


class ProviderProxy:
    def __init__(self, agent, port=4097):
        self.agent = agent
        self.port = port
        self.providers = {}
        self.leases = {}
        self.lock = threading.RLock()
        self.server = None

    def rewrite(self, configuration, references):
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
            providers[route] = dict(name=name, endpoint=endpoint, capability=capability, credentialId=credential_id)
            options['baseURL'] = 'http://127.0.0.1:' + str(self.port) + '/proxy/' + route
            options['apiKey'] = 'local-capability'
            options.pop('headers', None)
        with self.lock:
            self.providers = providers
            self.leases = {}
        return result

    def credential(self, provider):
        if self.agent.boundary.unbound:
            raise ValueError('unbound node authority unavailable')
        key = (provider['capability'], provider['credentialId'])
        with self.lock:
            now = time.time()
            cached = self.leases.get(key)
            if cached and cached[1] > now:
                return cached[0]
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
            self.leases[key] = (value, min(expires, now + 60))
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
                    credential = proxy.credential(provider)
                    headers = {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + credential,
                               'Accept': self.headers.get('Accept', 'application/json')}
                    # Anthropic's compatible API uses the same exact capability credential.
                    if suffix == '/messages':
                        headers['x-api-key'] = credential
                        headers['anthropic-version'] = '2023-06-01'
                    connection = PinnedConnection(host, address)
                    connection.request(self.command, prefix + suffix, body=body or None, headers=headers)
                    response = connection.getresponse()
                    if 300 <= response.status < 400:
                        raise ValueError('provider redirect rejected')
                    self.send_response(response.status)
                    self.send_header('Content-Type', response.getheader('Content-Type', 'application/json'))
                    self.send_header('Connection', 'close')
                    self.end_headers()
                    started = True
                    pending = b''
                    while True:
                        chunk = response.read1(65536)
                        combined = pending + chunk
                        if credential.encode() in combined:
                            raise ValueError('provider echoed credential')
                        if not chunk:
                            self.wfile.write(combined)
                            self.wfile.flush()
                            break
                        hold = max(0, len(credential.encode()) - 1)
                        if hold:
                            pending = combined[-hold:]
                            outgoing = combined[:-hold]
                        else:
                            pending, outgoing = b'', combined
                        self.wfile.write(outgoing)
                        self.wfile.flush()
                except Exception:
                    if not started:
                        self.send_response(503)
                        self.send_header('Content-Type', 'application/json')
                        self.send_header('Connection', 'close')
                        self.end_headers()
                        self.wfile.write(b'{"error":"provider capability unavailable"}')
                finally:
                    if connection:
                        connection.close()
        self.server = ThreadingHTTPServer(('127.0.0.1', self.port), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
