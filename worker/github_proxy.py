"""Worker-local Git transport. PAT material stays in the privileged broker process."""
import base64
import http.client
import re
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler
from credential_transport import LeaseTransport
from provider_proxy import PinnedConnection

MAX_TRANSFER = 64 * 1024 * 1024


def forward_chunk(read, send, active):
    active()
    data = read()
    active()  # Input may have blocked while the Worker or credential was retired.
    if not data:
        raise ValueError('truncated Git request')
    send(data)
    return data


def github_request(path, method):
    match = re.fullmatch(r'/github/([A-Za-z0-9][A-Za-z0-9-]{0,38})/([A-Za-z0-9][A-Za-z0-9._-]{0,99}?)(?:\.git)?/(info/refs\?service=git-(upload|receive)-pack|git-(upload|receive)-pack)', path)
    if not match:
        raise ValueError('invalid GitHub repository route')
    suffix = match.group(3)
    if (method == 'GET') != suffix.startswith('info/refs?') or method not in ('GET', 'POST'):
        raise ValueError('invalid GitHub transport method')
    repository = match.group(1) + '/' + match.group(2)
    if match.group(2).endswith('.git'):
        raise ValueError('invalid GitHub repository route')
    return repository, 'repo.write' if 'receive' in suffix else 'repo.read', '/' + repository + '.git/' + suffix


class GitHubProxy:
    def __init__(self, agent, port=4100, connection=None):
        self.agent, self.port = agent, port
        self.connection = connection or (lambda:PinnedConnection('github.com','github.com'))
        self.server = None
        self.slots = threading.BoundedSemaphore(4)
        self.transport_lock = threading.Lock()
        self.transports = {}
        self.gates = {}
        self.epoch = 0

    def register(self, client, connection, epoch):
        with self.transport_lock:
            if self.epoch != epoch:
                raise ValueError('GitHub request retired')
            self.transports[client] = connection

    def close_active(self):
        with self.transport_lock:
            self.epoch += 1
            transports = list(self.transports.items())
            gates = list(self.gates.values())
            self.transports.clear();self.gates.clear()
        for gate in gates:gate.close()
        for client, connection in transports:
            for stream in (client, getattr(connection, 'sock', None)):
                if stream:
                    try:
                        stream.shutdown(socket.SHUT_RDWR)
                    except Exception:
                        pass
            if connection:
                connection.close()

    def reference(self):
        if self.agent.retired or not self.agent.ready or self.agent.boundary.unbound:
            raise ValueError('GitHub runtime unavailable')
        snapshot = self.agent.boundary.snapshot
        references = snapshot.get('credentialReferences', []) if isinstance(snapshot, dict) else []
        matches = [ref for ref in references if isinstance(ref, dict) and
                   ref.get('integrationId') == 'github' and ref.get('configured') is True]
        if len(matches) != 1 or not isinstance(matches[0].get('credentialId'), str):
            raise ValueError('GitHub account unavailable')
        return matches[0]['credentialId']

    def start(self):
        if self.server:
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
                started = False
                connection = None
                transport = None
                epoch = proxy.epoch
                admission = proxy.slots.acquire(blocking=False)
                try:
                    self.connection.settimeout(15)
                    if not admission:
                        raise ValueError('GitHub request capacity exceeded')
                    proxy.register(self.connection, None, epoch)
                    repository, capability, remote_path = github_request(self.path, self.command)
                    reference = proxy.reference()
                    request = dict(integrationId='github', credentialId=reference, capability=capability,
                                   resource=repository, scopes=[capability])
                    with proxy.agent.credentials.acquire(request) as lease:
                        owner = (proxy.agent.boundary.get('runId'), getattr(proxy.agent,'process_epoch',None),
                                 getattr(getattr(proxy.agent,'mcp_proxy',None),'active',None))
                        def live():
                            with proxy.transport_lock:
                                return (proxy.epoch == epoch and proxy.reference() == reference and owner ==
                                    (proxy.agent.boundary.get('runId'),getattr(proxy.agent,'process_epoch',None),
                                     getattr(getattr(proxy.agent,'mcp_proxy',None),'active',None)))
                        connection = proxy.connection()
                        if not isinstance(connection,PinnedConnection):raise ValueError('uncancellable Git transport')
                        proxy.register(self.connection, connection, epoch)
                        transport = LeaseTransport(lease,connection,live,downstream=self.connection)
                        with proxy.transport_lock:
                            if proxy.epoch != epoch:raise ValueError('Git request retired')
                            proxy.gates[self.connection] = transport
                        def active():transport.forward(lambda:None)
                        def authorize(value):
                            def inject():
                                connection.putrequest(self.command, remote_path)
                                connection.putheader('Authorization', 'Basic ' + base64.b64encode(('x-access-token:' + value).encode()).decode())
                            transport.forward(inject)
                        lease.consume(authorize)
                        connection.putheader('User-Agent', 'OpenCodeTelegramCore/1')
                        connection.putheader('Accept', '*/*')
                        if self.headers.get('Git-Protocol') == 'version=2':
                            connection.putheader('Git-Protocol', 'version=2')
                        transferred = 0
                        chunked = self.headers.get('Transfer-Encoding', '').lower() == 'chunked'
                        if self.headers.get('Transfer-Encoding') and not chunked:
                            raise ValueError('invalid Git request framing')
                        if chunked and self.headers.get('Content-Length'):
                            raise ValueError('ambiguous Git request framing')
                        if self.command == 'POST':
                            service = 'git-receive-pack' if capability == 'repo.write' else 'git-upload-pack'
                            connection.putheader('Content-Type', 'application/x-' + service + '-request')
                            if chunked:
                                connection.putheader('Transfer-Encoding', 'chunked')
                            else:
                                length = int(self.headers.get('Content-Length', '0'))
                                if not 0 <= length <= MAX_TRANSFER:
                                    raise ValueError('Git request exceeds bound')
                                connection.putheader('Content-Length', str(length))
                        elif chunked or self.headers.get('Content-Length') not in (None, '0'):
                            raise ValueError('unexpected Git read body')
                        transport.forward(connection.endheaders)
                        if self.command == 'POST':
                            remaining = None if chunked else length
                            while remaining is None or remaining:
                                active()
                                if chunked:
                                    line = self.rfile.readline(64)
                                    if not re.fullmatch(b'[0-9A-Fa-f]{1,8}\r\n', line):
                                        raise ValueError('invalid Git chunk framing')
                                    size = int(line[:-2], 16)
                                    if size == 0:
                                        if self.rfile.read(2) != b'\r\n':
                                            raise ValueError('Git trailers rejected')
                                        active()
                                        transport.forward(lambda:connection.send(b'0\r\n\r\n'))
                                        break
                                else:
                                    size = min(65536, remaining)
                                if transferred + size > MAX_TRANSFER:
                                    raise ValueError('Git request exceeds bound')
                                left = size
                                if chunked:
                                    active()
                                    transport.forward(lambda:connection.send(('%x\r\n' % size).encode()))
                                while left:
                                    active()
                                    data = forward_chunk(lambda: self.rfile.read(min(65536, left)), lambda data:transport.forward(lambda:connection.send(data)), active)
                                    left -= len(data)
                                if chunked:
                                    if self.rfile.read(2) != b'\r\n':
                                        raise ValueError('invalid Git chunk framing')
                                    active()
                                    transport.forward(lambda:connection.send(b'\r\n'))
                                else:
                                    remaining -= size
                                transferred += size
                        active()
                        response = connection.getresponse()
                        active()
                        if 300 <= response.status < 400:
                            raise ValueError('GitHub redirect rejected')
                        if response.status not in (200, 401, 403, 404):
                            raise ValueError('GitHub transport unavailable')
                        if response.status != 200:
                            raise ValueError('GitHub repository permission rejected')
                        service = 'git-receive-pack' if capability == 'repo.write' else 'git-upload-pack'
                        content_type = 'application/x-' + service + ('-advertisement' if self.command == 'GET' else '-result')
                        if response.getheader('Content-Type', '').split(';', 1)[0] != content_type:
                            raise ValueError('invalid GitHub transport response')
                        def send_headers():
                            self.send_response(200)
                            self.send_header('Content-Type',content_type)
                            self.send_header('Connection','close')
                            self.end_headers()
                        transport.forward(send_headers)
                        started = True
                        total, pending = 0, b''
                        def output_guard(value):
                            needles = (value.encode(),base64.b64encode(('x-access-token:'+value).encode()))
                            def protect(data):
                                if any(needle in data for needle in needles):
                                    raise ValueError('Git transport echoed credential')
                                return max(len(needle)-1 for needle in needles)
                            return protect
                        protect = lease.consume(output_guard)
                        # Keep only an overlap window in memory; repository packs are streamed.
                        while True:
                            active()
                            chunk = response.read1(65536)
                            active()
                            total += len(chunk)
                            if total > MAX_TRANSFER:
                                raise ValueError('Git response exceeds bound')
                            combined = pending + chunk
                            overlap = protect(combined)
                            if not chunk:
                                transport.forward(lambda:self.wfile.write(combined))
                                break
                            if len(combined) > overlap:
                                transport.forward(lambda:self.wfile.write(combined[:-overlap] if overlap else combined))
                            pending = combined[-overlap:] if overlap else b''
                except Exception:
                    try:
                        if not started:
                            body = b'GitHub capability rejected'
                            self.send_response(403)
                            self.send_header('Content-Type', 'text/plain')
                            self.send_header('Content-Length', str(len(body)))
                            self.send_header('Connection', 'close')
                            self.end_headers()
                            self.wfile.write(body)
                    except OSError:
                        pass
                    self.close_connection = True
                finally:
                    protect=None;pending=b''
                    if transport:transport.close()
                    with proxy.transport_lock:
                        proxy.transports.pop(self.connection, None)
                        proxy.gates.pop(self.connection,None)
                    if connection:
                        connection.close()
                    if admission:
                        proxy.slots.release()
        from node_agent import BoundedHTTPServer
        self.server = BoundedHTTPServer(('127.0.0.1', self.port), Handler)
        self.server.daemon_threads = True
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.close_active()
        if self.server:
            self.server.shutdown()
            self.server.server_close()
            self.server = None
