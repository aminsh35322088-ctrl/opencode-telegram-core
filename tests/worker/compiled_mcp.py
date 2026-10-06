"""Actual compiled Core MCP discovery/call with synthetic root-only credential.
The upstream connection is replaced by an offline fixture; TLS/DNS enforcement
is tested separately. This does not claim a production provider integration.
"""
import http.client
import json
from pathlib import Path
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
sys.path[:0] = [str(Path(__file__).parents[2] / 'worker'), str(Path(__file__).parents[1] / 'compatibility')]
from node_agent import Agent, Boundary, digest
import mcp_proxy
from production_execution import Model, plugin_registry

requests = []
class Peer(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass
    def do_GET(self):
        self.send_response(405)
        self.send_header('Content-Length', '0')
        self.end_headers()
    def do_DELETE(self):
        self.send_response(204)
        self.end_headers()
    def do_POST(self):
        assert self.path == '/mcp'
        assert self.headers['Authorization'] == 'Bearer fixture-root-mcp-secret'
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        method = body.get('method')
        requests.append(method)
        if 'id' not in body:
            self.send_response(202)
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        result = {}
        if method == 'initialize':
            result = {'protocolVersion': '2025-03-26', 'capabilities': {'tools': {}}, 'serverInfo': {'name': 'fixture', 'version': '1'}}
        elif method == 'tools/list':
            result = {'tools': [{'name': 'probe', 'description': 'Offline MCP probe', 'inputSchema': {'type': 'object', 'properties': {}}}]}
        elif method == 'tools/call':
            assert body['params']['name'] == 'probe'
            result = {'content': [{'type': 'text', 'text': 'root MCP owned result'}]}
        output = json.dumps({'jsonrpc': '2.0', 'id': body['id'], 'result': result}).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Mcp-Session-Id', 'fixture-session')
        self.send_header('Content-Length', str(len(output)))
        self.end_headers()
        self.wfile.write(output)

peer = ThreadingHTTPServer(('127.0.0.1', 0), Peer)
threading.Thread(target=peer.serve_forever, daemon=True).start()
class OfflineConnection(http.client.HTTPConnection):
    def __init__(self, host, address):
        super().__init__('127.0.0.1', peer.server_port, timeout=15)
mcp_proxy.PinnedConnection = OfflineConnection
mcp_proxy.provider_endpoint = lambda endpoint: ('mcp.example', '/mcp', '8.8.8.8')
provider = ThreadingHTTPServer(('127.0.0.1', 0), Model)
provider.tool = 'tools_probe'
threading.Thread(target=provider.serve_forever, daemon=True).start()
registry = plugin_registry()
root = Path('/data')
root.mkdir(exist_ok=True)
boundary = Boundary(root / 'agent', 'compiled-mcp-fixture-secret' * 2,
                    dict(nodeId='mcp-fixture', generation=1, chatId=-1, threadId=2))
(root / 'agent').chmod(0o700)
runtime = {'model': 'fixture/fixture', 'permission': 'allow',
    'mcp': {'tools': {'type': 'remote', 'url': 'https://mcp.example/mcp', 'enabled': True}},
    'provider': {'fixture': {'npm': '@ai-sdk/openai-compatible', 'name': 'Fixture',
        'options': {'baseURL': f'http://127.0.0.1:{provider.server_port}/v1', 'apiKey': 'fixture'},
        'models': {'fixture': {'name': 'Fixture', 'limit': {'context': 32000, 'output': 2048}}}}}}
snapshot = dict(version=1, revision=1, configuration={'runtime': runtime}, skills=[], actions=[], catalog={},
    defaults={}, credentialReferences=[{'id': 'a' * 64, 'kind': 'mcp', 'configured': True, 'capability': 'mcp:tools'}])
snapshot['hash'] = digest(snapshot)
boundary.apply(snapshot)
agent = Agent(boundary, 'https://control.invalid')
leases = []
def control(operation, payload, session=None):
    if operation == 'snapshot.get':
        return snapshot
    assert operation == 'credential.get' and payload == {'purpose': 'mcp.request', 'capability': 'mcp:tools', 'credentialId': 'a' * 64, 'endpoint': 'https://mcp.example/mcp'}
    assert session == boundary.get('session')
    leases.append(session)
    return {'headers': {'Authorization': 'Bearer fixture-root-mcp-secret'}, 'expiresAt': time.time() * 1000 + 60000}
agent.outbound = control
agent.workspace = root / 'topic'
agent.workspace.mkdir(exist_ok=True)
config = root / 'runtime' / 'opencode'
config.mkdir(parents=True, exist_ok=True)
(config / '.npmrc').write_text(f'registry=http://127.0.0.1:{registry.server_port}/\n')
try:
    agent.start_core()
    assert not requests and not leases, 'idle MCP emitted outgoing request'
    created = agent.dispatch(boundary.envelope('session.create', {}))
    session = created['sessionId']
    agent.dispatch(boundary.envelope('run', {'runId': 'mcp-run', 'parts': [{'type': 'text', 'text': 'Use the MCP probe'}]}, session))
    deadline = time.time() + 40
    while time.time() < deadline:
        history = agent.local('GET', '/session/' + session + '/message')
        if 'root MCP owned result' in json.dumps(history) and agent.mcp_proxy.active is None:
            break
        time.sleep(.1)
    else:
        raise AssertionError('compiled MCP tool did not complete: ' + str(requests))
    assert 'initialize' in requests and 'tools/list' in requests and 'tools/call' in requests
    assert len(leases) == 1 and not agent.mcp_proxy.connections and not agent.mcp_proxy.leases
    assert 'fixture-root-mcp-secret' not in (config / 'opencode.json').read_text()
    before = len(requests)
    time.sleep(.2)
    assert len(requests) == before, 'idle MCP traffic after completion'
    print(json.dumps({'compiledCoreMCPDiscovery': True, 'compiledCoreMCPToolCall': True,
                      'rootOnlySyntheticLease': True, 'idleRequests': 0, 'upstreamTransport': 'offline-fixture'}))
finally:
    agent.stop_core()
    for server in (peer, provider, registry):
        server.shutdown()
        server.server_close()
