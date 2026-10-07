"""Offline real Chromium through compiled Core's governed browser tool (UID1000)."""
import json
import os
from pathlib import Path
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
sys.path.insert(0, str(Path(__file__).parents[1] / 'compatibility'))
from production_execution import plugin_registry
from session_contract import Server, Client

assert os.getuid() == 1000
entered, release = threading.Event(), threading.Event()
class Page(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass
    def do_GET(self):
        if self.path == '/slow':
            entered.set()
            assert release.wait(30)
        raw = b'<title>Governed Worker</title><h1>governed-browser-content</h1>'
        self.send_response(200)
        self.send_header('Content-Type', 'text/html')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        try:
            self.wfile.write(raw)
        except BrokenPipeError:
            pass
page = ThreadingHTTPServer(('127.0.0.1', 0), Page)
threading.Thread(target=page.serve_forever, daemon=True).start()
steps = [{'action': 'open', 'url': f'http://127.0.0.1:{page.server_port}/slow'},
         {'action': 'snapshot'}, {'action': 'screenshot', 'filename': 'governed.png'}, {'action': 'close'}]
class Model(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        count = sum(message['role'] == 'tool' for message in body['messages'])
        if count < len(steps):
            delta = {'tool_calls': [{'index': 0, 'id': 'browser-' + str(count), 'type': 'function',
                     'function': {'name': 'browser', 'arguments': json.dumps(steps[count])}}]}
            finish = 'tool_calls'
        else:
            delta, finish = {'content': 'compiled-browser-complete'}, 'stop'
        output = ''.join('data: ' + json.dumps({'id': 'fixture', 'object': 'chat.completion.chunk', 'created': 1,
            'model': 'fixture', 'choices': [{'index': 0, 'delta': value, 'finish_reason': end}]}) + '\n\n'
            for value, end in ((delta, None), ({}, finish))) + 'data: [DONE]\n\n'
        raw = output.encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)
model = ThreadingHTTPServer(('127.0.0.1', 0), Model)
threading.Thread(target=model.serve_forever, daemon=True).start()
registry = plugin_registry()
roots = []
def configure(root, env):
    roots.append(root)
    os.chdir(root)
    tools = root / 'tools-config/tools'
    tools.mkdir(parents=True)
    (tools / 'browser.ts').write_text((Path(__file__).parents[2] / 'worker/runtime_tools/browser.ts').read_text())
    (tools.parent / '.npmrc').write_text(f'registry=http://127.0.0.1:{registry.server_port}/\n')
    env.update(OPENCODE_CONFIG_DIR=str(tools.parent), OPENCODE_TELEGRAM_PROCESS_BUDGET='1',
        PLAYWRIGHT_BROWSERS_PATH='/opt/ms-playwright', OPENCODE_DISABLE_MODELS_FETCH='1',
        OPENCODE_DISABLE_AUTOUPDATE='1', NPM_CONFIG_REGISTRY=f'http://127.0.0.1:{registry.server_port}/')
    env['OPENCODE_CONFIG_CONTENT'] = json.dumps({'model': 'fixture/fixture', 'permission': 'allow',
        'provider': {'fixture': {'npm': '@ai-sdk/openai-compatible', 'name': 'Fixture',
        'options': {'baseURL': f'http://127.0.0.1:{model.server_port}/v1', 'apiKey': 'fixture'},
        'models': {'fixture': {'name': 'Fixture', 'limit': {'context': 32000, 'output': 2048}}}}}})

def descendants(pid):
    rows = {}
    for path in Path('/proc').glob('[0-9]*/status'):
        try:
            values = dict(line.split(':', 1) for line in path.read_text().splitlines() if ':' in line)
            rows[int(path.parent.name)] = (int(values['PPid']), values['State'].strip()[0])
        except (OSError, ValueError, KeyError):
            pass
    owned = {pid}
    while True:
        expanded = owned | {child for child, (parent, _) in rows.items() if parent in owned}
        if expanded == owned:
            break
        owned = expanded
    return {child: rows[child][1] for child in owned - {pid}}

try:
    with Server('/usr/local/bin/opencode', readiness_path='/global/health', configure=configure) as server:
        client = Client(server.base)
        session = client.request('POST', '/session', {})['id']
        client.request('POST', '/session/' + session + '/prompt_async', {'parts': [{'type': 'text', 'text': 'Use the browser'}]}, timeout=15)
        if not entered.wait(30):
            history = client.request('GET', '/session/' + session + '/message')
            failures = [part.get('state', {}).get('error', '') for message in history for part in message.get('parts', []) if part.get('type') == 'tool']
            raise AssertionError('real browser did not navigate: ' + str(failures)[:2000])
        execution = client.request('GET', '/session/' + session + '/execution')
        assert execution and execution['continuation'] == 'live'
        browser_pids = []
        for pid in descendants(server.process.pid):
            try:
                if Path('/proc/' + str(pid) + '/comm').read_text().strip() == 'node' and any(
                    Path('/proc/' + str(child) + '/comm').read_text().strip().startswith('chrome')
                    for child in descendants(pid)):
                    browser_pids.append(pid)
            except OSError:
                pass
        if len(browser_pids) != 1:
            names = {pid: Path('/proc/' + str(pid) + '/comm').read_text().strip() for pid in descendants(server.process.pid)}
            raise AssertionError('expected one captured browser daemon: ' + str(names))
        browser_pid = browser_pids[0]
        browser_status = Path('/proc/' + str(browser_pid) + '/status').read_text()
        guardian_pid = int(next(line.split()[1] for line in browser_status.splitlines() if line.startswith('PPid:')))
        assert Path('/proc/' + str(guardian_pid) + '/comm').read_text().strip() == 'scope'
        client.request('POST', '/session/' + session + '/pause', {'runId': execution['runId']}, timeout=15)
        deadline = time.time() + 5
        while time.time() < deadline:
            # The retirement guardian remains awake; every browser executable
            # and Chromium child beneath it must physically stop.
            states = descendants(guardian_pid)
            if len(states) >= 3 and all(state in ('T', 'Z') for state in states.values()):
                break
            time.sleep(.05)
        else:
            raise AssertionError('browser tree was not physically paused: ' + str(states))
        release.set()
        client.request('POST', '/session/' + session + '/resume', {'runId': execution['runId']}, timeout=15)
        deadline = time.time() + 30
        while time.time() < deadline:
            history = json.dumps(client.request('GET', '/session/' + session + '/message'))
            if 'compiled-browser-complete' in history:
                break
            time.sleep(.1)
        else:
            raise AssertionError('governed browser did not complete')
        assert 'governed-browser-content' in history
        assert '"status": "error"' not in history, history
        assert any(path.stat().st_size > 0 for path in roots[0].rglob('governed.png'))
        assert client.request('POST', '/global/dispose', timeout=15)
        assert not descendants(server.process.pid), 'browser children survived confirmed disposal'
        print(json.dumps({'uid': 1000, 'compiledCoreBrowser': True, 'physicalPauseResume': True,
                          'snapshot': True, 'screenshot': True, 'joinedRetirement': True, 'externalRequests': 0}))
finally:
    os.chdir('/tmp')
    release.set()
    for peer in (page, model, registry):
        peer.shutdown()
        peer.server_close()
