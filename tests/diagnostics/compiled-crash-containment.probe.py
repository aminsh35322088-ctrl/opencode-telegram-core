"""Diagnostic: kill compiled Core while its physically paused model shell is live.
Run through the test-only Linux subreaper; clean only the captured fixture group.
"""
import json
import os
from pathlib import Path
import shlex
import signal
import sys
import threading
import time
from http.server import ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tests/compatibility'))
from session_contract import Server, Client
from production_execution import Model

roots = []
provider = ThreadingHTTPServer(('127.0.0.1', 0), Model)
thread = threading.Thread(target=provider.serve_forever, daemon=True); thread.start()
def configure(root, env):
    roots.append(root)
    provider.command = 'echo $$ > ' + shlex.quote(str(root / 'shell-pid')) + '; exec sleep 60'
    env['OPENCODE_CONFIG_CONTENT'] = json.dumps({'permission': 'allow', 'provider': {'fixture': {
        'npm': '@ai-sdk/openai-compatible', 'options': {'baseURL': f'http://127.0.0.1:{provider.server_port}/v1', 'apiKey': 'fixture'},
        'models': {'fixture': {'name': 'Fixture', 'limit': {'context': 32000, 'output': 1024}}}}}})

def identity(pid):
    try:
        fields = Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()
        return {'state': fields[0], 'ppid': int(fields[1]), 'group': int(fields[2]), 'started': fields[19]}
    except FileNotFoundError:
        return None

pid = None; captured = None
try:
    with Server(str(ROOT / 'dist/runtime/opencode'), readiness_path='/global/health', configure=configure) as server:
        try:
            c = Client(server.base); sid = c.request('POST', '/session', {})['id']
            c.request('POST', f'/session/{sid}/prompt_async', {'parts': [{'type': 'text', 'text': 'fixture'}],
                'model': {'providerID': 'fixture', 'modelID': 'fixture'}})
            deadline = time.monotonic() + 10
            while not (roots[0] / 'shell-pid').exists():
                if time.monotonic() >= deadline: raise AssertionError('shell never started')
                time.sleep(.02)
            pid = int((roots[0] / 'shell-pid').read_text()); captured = identity(pid)
            execution = c.request('GET', f'/session/{sid}/execution')
            owner = {key: execution[key] for key in ('runId', 'generation') if key in execution}
            paused = c.request('POST', f'/session/{sid}/pause', owner)
            deadline = time.monotonic() + 5
            while True:
                before = identity(pid)
                if before and before['state'] == 'T': break
                if time.monotonic() >= deadline: raise AssertionError('acknowledged pause did not physically stop shell')
                time.sleep(.01)
            server.process.kill(); server.process.wait(timeout=5)
            after = identity(pid)
            print(json.dumps({'runtimeKilled': True, 'pauseAcknowledged': paused['paused'],
                'before': before, 'after': after, 'liveProcessSurvivesRuntimeCrash': bool(after and after['state'] != 'Z')}))
        finally:
            current = identity(pid) if pid else None
            if current and captured and current['started'] == captured['started'] and current['group'] == captured['group']:
                os.killpg(current['group'], signal.SIGKILL)
finally:
    provider.shutdown(); provider.server_close(); thread.join(3)
