"""Validation image only: continuously exercise the actual compiled Core artifact.
The external endpoint contains health/evidence; the Core API stays loopback-only.
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import time

sys.path.insert(0, '/validation/tests')
from session_contract import Server, Client
from production_execution import Model
BINARY = '/usr/local/bin/opencode'
for test in ['headless_surface.py', 'production_execution.py']:
    subprocess.run([sys.executable, '/validation/tests/' + test, '--binary', BINARY], check=True)
provider = ThreadingHTTPServer(('127.0.0.1', 0), Model)
threading.Thread(target=provider.serve_forever, daemon=True).start()
def configure(root, env):
    env['OPENCODE_CONFIG_CONTENT'] = json.dumps({'model': 'fixture/fixture', 'permission': 'allow',
        'provider': {'fixture': {'npm': '@ai-sdk/openai-compatible', 'name': 'Fixture',
        'options': {'baseURL': f'http://127.0.0.1:{provider.server_port}/v1', 'apiKey': 'fixture'},
        'models': {'fixture': {'name': 'Fixture', 'limit': {'context': 32000, 'output': 2048}}}}}})
server = Server(BINARY, readiness_path='/global/health', configure=configure).__enter__()
client = Client(server.base)
evidence = {'build': json.loads(Path('/validation/build-info.json').read_text()),
    'sha256': hashlib.sha256(Path(BINARY).read_bytes()).hexdigest(), 'runtimeBytes': Path(BINARY).stat().st_size,
    'runtimePID': server.process.pid, 'completedWorkloads': 0, 'failures': [], 'rssKiB': [], 'descendantCounts': [], 'threadCounts': [], 'started': time.time()}
lock = threading.Lock()
def sample():
    fields = Path(f'/proc/{server.process.pid}/status').read_text().splitlines()
    return int(next(s for s in fields if s.startswith('VmRSS:')).split()[1])
def process_sample():
    parents = {}
    for path in Path('/proc').glob('[0-9]*/status'):
        try:
            fields = path.read_text().splitlines()
            parents[int(path.parent.name)] = int(next(s for s in fields if s.startswith('PPid:')).split()[1])
        except (OSError, StopIteration): pass
    owned = {server.process.pid}
    while True:
        found = {pid for pid, parent in parents.items() if parent in owned}
        if found <= owned: break
        owned |= found
    fields = Path(f'/proc/{server.process.pid}/status').read_text().splitlines()
    threads = int(next(s for s in fields if s.startswith('Threads:')).split()[1])
    return len(owned) - 1, threads

def workload():
    while True:
        try:
            if server.process.poll() is not None: raise RuntimeError('compiled runtime exited')
            sessions = [client.request('POST', '/session', {'title': f'compiled-soak-{i}'}) for i in range(2)]
            for session in sessions:
                sid = session['id']
                client.request('POST', f'/session/{sid}/message', {'parts': [{'type': 'text', 'text': 'Run the shell probe'}],
                    'model': {'providerID': 'fixture', 'modelID': 'fixture'}}, timeout=30)
                history = json.dumps(client.request('GET', f'/session/{sid}/message'))
                if 'telegram-owned-shell' not in history or 'Telegram compiled execution complete' not in history:
                    raise RuntimeError('missing model/tool result')
                if sid in client.request('GET', '/session/status'): raise RuntimeError('run remained active')
                if not client.request('POST', f'/session/{sid}/abort'): raise RuntimeError('idle abort failed')
                client.request('DELETE', f'/session/{sid}')
            client.request('POST', '/global/dispose')
            with lock:
                evidence['completedWorkloads'] += 1
                evidence['rssKiB'].append(sample())
                descendants, threads = process_sample()
                evidence['descendantCounts'].append(descendants)
                evidence['threadCounts'].append(threads)
                print(json.dumps({'compiledRuntimeSoak': evidence['completedWorkloads'], 'rssKiB': evidence['rssKiB'][-1],
                                  'runtimePID': server.process.pid, 'descendants': descendants, 'threads': threads}), flush=True)
        except Exception as error:
            with lock: evidence['failures'].append(repr(error))
            print(json.dumps({'compiledRuntimeFailure': repr(error)}), flush=True)
            break
        time.sleep(15)
threading.Thread(target=workload, daemon=True).start()
class Health(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_GET(self):
        with lock:
            response = dict(evidence)
            response['alive'] = server.process.poll() is None
            response['healthy'] = response['alive'] and not response['failures'] and response['completedWorkloads'] > 0
        raw = json.dumps(response).encode()
        self.send_response(200 if response['healthy'] else 503)
        self.send_header('content-type', 'application/json'); self.send_header('content-length', str(len(raw)))
        self.end_headers(); self.wfile.write(raw)
http = ThreadingHTTPServer(('0.0.0.0', int(os.environ.get('PORT', '3000'))), Health)
def stop(*_):
    server.close(); provider.shutdown()
    print(json.dumps({'compiledRuntimeStopped': True, 'exitCode': server.process.returncode}), flush=True)
    os._exit(0 if server.process.returncode == 0 else 1)
signal.signal(signal.SIGTERM, stop); signal.signal(signal.SIGINT, stop)
http.serve_forever()
