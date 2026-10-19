"""Worker-local GitHub REST proxy. PAT material stays in the privileged broker."""
import json
import re
import socket
import threading
from http.server import BaseHTTPRequestHandler
from provider_proxy import PinnedConnection

MAX_REQUEST_BODY = 64 * 1024
MAX_RESPONSE_BODY = 2 * 1024 * 1024
API_HOST = 'api.github.com'
METHODS = ('GET', 'POST', 'PUT', 'PATCH', 'DELETE')
PATH_PATTERN = re.compile(r'^/[A-Za-z0-9][A-Za-z0-9._~\-/%]*(?:\?[A-Za-z0-9._~\-/&=%+]*)?$')


def api_request(value):
    """Validate a tool request; returns (method, path, body-bytes-or-None)."""
    if not isinstance(value, dict) or set(value) - {'method', 'path', 'body'}:
        raise ValueError('invalid GitHub API request')
    method = value.get('method', 'GET')
    path = value.get('path')
    body = value.get('body')
    if not isinstance(method, str) or method not in METHODS:
        raise ValueError('invalid GitHub API method')
    if not isinstance(path, str) or len(path) > 2048 or not PATH_PATTERN.fullmatch(path):
        raise ValueError('invalid GitHub API route')
    if body is not None:
        if method not in ('POST', 'PUT', 'PATCH') or not isinstance(body, str) or len(body) > MAX_REQUEST_BODY:
            raise ValueError('invalid GitHub API body')
        body = body.encode('utf-8')
    return method, path, body


class GitHubApiProxy:
    def __init__(self, agent, port=4102, connection=None):
        self.agent, self.port = agent, port
        self.connection = connection or (lambda: PinnedConnection(API_HOST, API_HOST))
        self.server = None
        self.slots = threading.BoundedSemaphore(4)
        self.connection_lock = threading.Lock()
        self.connections = {}
        self.epoch = 0

    def register(self, client, connection, epoch):
        with self.connection_lock:
            if self.epoch != epoch:
                raise ValueError('GitHub API request retired')
            self.connections[client] = connection

    def close_active(self):
        with self.connection_lock:
            self.epoch += 1
            active = list(self.connections.items())
            self.connections.clear()
        for client, connection in active:
            for stream in (client, getattr(connection, 'sock', None)):
                if stream:
                    try:
                        stream.shutdown(socket.SHUT_RDWR)
                    except OSError:
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

            def do_POST(self):
                started = False
                connection = None
                epoch = proxy.epoch
                admission = proxy.slots.acquire(blocking=False)
                try:
                    self.connection.settimeout(55)
                    if not admission:
                        raise ValueError('GitHub API capacity exceeded')
                    if self.path != '/':
                        raise ValueError('invalid GitHub API listener route')
                    length = int(self.headers.get('Content-Length', '0'))
                    if not 0 < length <= MAX_REQUEST_BODY:
                        raise ValueError('GitHub API request exceeds bound')
                    method, path, body = api_request(json.loads(self.rfile.read(length)))
                    proxy.register(self.connection, None, epoch)
                    reference = proxy.reference()
                    request = dict(integrationId='github', credentialId=reference,
                                   capability='session.access', scopes=['session.access'])
                    with proxy.agent.credentials.acquire(request) as lease:
                        owner = (proxy.agent.boundary.get('runId'), getattr(proxy.agent, 'process_epoch', None),
                                 getattr(getattr(proxy.agent, 'mcp_proxy', None), 'active', None))
                        def live():
                            with proxy.connection_lock:
                                return (proxy.epoch == epoch and proxy.reference() == reference and owner ==
                                    (proxy.agent.boundary.get('runId'), getattr(proxy.agent, 'process_epoch', None),
                                     getattr(getattr(proxy.agent, 'mcp_proxy', None), 'active', None)))
                        connection = proxy.connection()
                        if not isinstance(connection, PinnedConnection):
                            raise ValueError('uncancellable GitHub API transport')
                        proxy.register(self.connection, connection, epoch)
                        def authorize(material):
                            if not live():
                                raise ValueError('GitHub API request retired')
                            connection.putrequest(method, path)
                            connection.putheader('Authorization', 'Bearer ' + material)
                            connection.putheader('Accept', 'application/vnd.github+json')
                            connection.putheader('X-GitHub-Api-Version', '2022-11-28')
                            connection.putheader('User-Agent', 'OpenCodeTelegramCore/1')
                            if body is not None:
                                connection.putheader('Content-Type', 'application/json')
                                connection.putheader('Content-Length', str(len(body)))
                            connection.endheaders()
                        lease.consume(authorize)
                        if body is not None:
                            connection.send(body)
                        response = connection.getresponse()
                        if not live():
                            raise ValueError('GitHub API request retired')
                        if 300 <= response.status < 400:
                            raise ValueError('GitHub redirect rejected')
                        total = b''
                        while len(total) <= MAX_RESPONSE_BODY:
                            chunk = response.read1(65536)
                            if not chunk:
                                break
                            total += chunk
                        else:
                            raise ValueError('GitHub API response exceeds bound')
                        def output_guard(value):
                            needle = value.encode()
                            def protect(data):
                                if needle in data:
                                    raise ValueError('GitHub API echoed credential')
                            return protect
                        lease.consume(output_guard)(total)
                        try:
                            parsed = json.loads(total)
                        except ValueError:
                            parsed = total.decode('utf-8', 'replace')
                        reply = json.dumps({'status': response.status, 'body': parsed}).encode()
                        def send():
                            self.send_response(200)
                            self.send_header('Content-Type', 'application/json')
                            self.send_header('Content-Length', str(len(reply)))
                            self.send_header('Connection', 'close')
                            self.end_headers()
                            self.wfile.write(reply)
                        send()
                        started = True
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
                    if connection:
                        connection.close()
                    with proxy.connection_lock:
                        proxy.connections.pop(self.connection, None)
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
