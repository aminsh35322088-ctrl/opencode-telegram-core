"""Loopback OAuth/PKCE and MCP HTTP peer for actual compiled runtime probes."""
import base64
import hashlib
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def reply(self, payload=None, status=200, headers=None):
        raw = b'' if payload is None else json.dumps(payload).encode()
        self.send_response(status)
        self.send_header('content-type', 'application/json')
        self.send_header('content-length', str(len(raw)))
        for name, value in (headers or {}).items(): self.send_header(name, value)
        try:
            self.end_headers()
            self.wfile.write(raw)
        except (BrokenPipeError, ConnectionResetError): pass
    def do_GET(self):
        origin = self.server.peer.origin
        path = urlparse(self.path).path
        if path.startswith('/.well-known/oauth-protected-resource'):
            return self.reply({'resource': origin + '/mcp', 'authorization_servers': [origin]})
        if path == '/.well-known/oauth-authorization-server':
            return self.reply({'issuer': origin, 'authorization_endpoint': origin + '/authorize',
                'token_endpoint': origin + '/token', 'registration_endpoint': origin + '/register',
                'response_types_supported': ['code'], 'grant_types_supported': ['authorization_code'],
                'token_endpoint_auth_methods_supported': ['none'], 'code_challenge_methods_supported': ['S256']})
        self.reply(status=405)
    def do_POST(self):
        peer = self.server.peer
        raw = self.rfile.read(int(self.headers.get('content-length', '0')))
        if self.path == '/register':
            peer.registrations.append(self.path)
            return self.reply({**json.loads(raw), 'client_id': 'compiled-fixture'}, 201)
        if self.path == '/token':
            body = parse_qs(raw.decode()); code = body.get('code', [''])[0]
            peer.exchanges.append(code); peer.entered.set()
            if peer.gate is not None and not peer.gate.wait(15):
                return self.reply({'error': 'fixture_gate_timeout'}, 500)
            digest = hashlib.sha256(body.get('code_verifier', [''])[0].encode()).digest()
            if peer.challenges.get(code) != base64.urlsafe_b64encode(digest).decode().rstrip('='):
                return self.reply({'error': 'invalid_grant'}, 400)
            return self.reply({'access_token': 'compiled-fixture-token', 'token_type': 'Bearer'})
        if self.path != '/mcp': return self.reply(status=404)
        if self.headers.get('authorization') != 'Bearer compiled-fixture-token':
            return self.reply(status=401, headers={'WWW-Authenticate': 'Bearer resource_metadata="' + peer.origin + '/.well-known/oauth-protected-resource"'})
        body = json.loads(raw)
        if 'id' not in body: return self.reply(status=202)
        result = {'protocolVersion': body.get('params', {}).get('protocolVersion', '2025-11-25'),
            'capabilities': {}, 'serverInfo': {'name': 'compiled-oauth', 'version': '1'}}
        self.reply({'jsonrpc': '2.0', 'id': body['id'], 'result': result})

class OAuthPeer:
    def __init__(self):
        self.challenges = {}; self.exchanges = []; self.registrations = []; self.entered = threading.Event(); self.gate = None
        self.http = ThreadingHTTPServer(('127.0.0.1', 0), Handler); self.http.peer = self
        self.origin = f'http://127.0.0.1:{self.http.server_port}'; self.url = self.origin + '/mcp'
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
    def __enter__(self): self.thread.start(); return self
    def authorize(self, flow, code):
        self.challenges[code] = parse_qs(urlparse(flow['authorizationUrl']).query)['code_challenge'][0]
    def __exit__(self, *args):
        if self.gate: self.gate.set()
        self.http.shutdown(); self.http.server_close(); self.thread.join(3)
