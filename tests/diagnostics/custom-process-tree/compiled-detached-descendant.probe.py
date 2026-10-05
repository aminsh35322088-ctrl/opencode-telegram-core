"""Causal escaped-descendant probe against the actual compiled Core tool path.
Run beneath the test-only Linux subreaper. Failure is expected until tree ownership
is implemented; the captured fixture identity is cleaned before returning.
"""
import json
import os
from pathlib import Path
import shlex
import signal
import sys
import threading
from http.server import ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tests/compatibility'))
from session_contract import Server, Client
from production_execution import Model, plugin_registry

provider = ThreadingHTTPServer(('127.0.0.1', 0), Model)
provider.tool = 'core_probe'
thread = threading.Thread(target=provider.serve_forever, daemon=True)
thread.start()
registry = plugin_registry()
roots = []

def identity(pid):
    try:
        fields = Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()
        return {'state': fields[0], 'ppid': int(fields[1]), 'group': int(fields[2]), 'started': fields[19]}
    except FileNotFoundError:
        return None

def configure(root, env):
    roots.append(root)
    config = root / '.opencode'
    tools = config / 'tools'; tools.mkdir(parents=True)
    marker = shlex.quote(str(root / 'escaped-pid'))
    fifo = shlex.quote(str(root / 'ready'))
    # FIFO handshake is causal: the descendant publishes only after setsid.
    # No sleeps/retries or scheduler-dependent escape opportunity.
    body = f'echo $$ > {marker}; printf ready > {fifo}; exec sleep 60'
    command = f'mkfifo {fifo}; setsid /bin/bash -c {shlex.quote(body)} </dev/null >/dev/null 2>&1 & read -r ready < {fifo}; printf core-escaped-probe'
    # read accepts the FIFO's EOF as readiness; no newline is required.
    (tools / 'core_probe.ts').write_text(
        "export default {description:'Compiled ownership diagnostic',args:{},async execute(args,context){"
        "const result=await context.process.execFile('/bin/bash',['-c'," + json.dumps(command) + "]);"
        "return result.stdout}}\n")
    (config / '.npmrc').write_text(f'registry=http://127.0.0.1:{registry.server_port}/\n')
    env['NPM_CONFIG_REGISTRY'] = f'http://127.0.0.1:{registry.server_port}/'
    env['OPENCODE_CONFIG_DIR'] = str(config)
    env['OPENCODE_CONFIG_CONTENT'] = json.dumps({'model': 'fixture/fixture', 'permission': 'allow',
        'provider': {'fixture': {'npm': '@ai-sdk/openai-compatible', 'name': 'Fixture',
        'options': {'baseURL': f'http://127.0.0.1:{provider.server_port}/v1', 'apiKey': 'fixture'},
        'models': {'fixture': {'name': 'Fixture', 'limit': {'context': 32000, 'output': 2048}}}}}})

captured = None; pid = None
try:
    with Server(str(ROOT / 'dist/runtime/opencode'), readiness_path='/global/health', configure=configure) as server:
        try:
            client = Client(server.base)
            sid = client.request('POST', '/session', {})['id']
            client.request('POST', f'/session/{sid}/message', {'parts': [{'type': 'text', 'text': 'Run custom diagnostic'}],
                'model': {'providerID': 'fixture', 'modelID': 'fixture'}}, timeout=45)
            history = json.dumps(client.request('GET', f'/session/{sid}/message'))
            if 'core-escaped-probe' not in history or '"status": "error"' in history:
                raise AssertionError('custom process did not complete successfully: ' + history)
            pid = int((roots[0] / 'escaped-pid').read_text())
            captured = identity(pid)
            disposed = client.request('POST', '/global/dispose', timeout=15)
            after = identity(pid)
            print(json.dumps({'compiledSource': json.loads((ROOT / 'dist/build-info.json').read_text())['telegramCoreCommit'],
                'toolSucceeded': True, 'workspaceDisposed': disposed, 'captured': captured, 'after': after}), flush=True)
            if after and captured and after['started'] == captured['started'] and after['state'] != 'Z':
                raise AssertionError('compiled Core acknowledged workspace retirement with escaped descendant alive')
        finally:
            # Also recover fixture identity on an earlier request assertion.
            marker = roots[0] / 'escaped-pid'
            if pid is None and marker.exists():
                pid = int(marker.read_text()); captured = identity(pid)
            current = identity(pid) if pid else None
            if current and captured and current['started'] == captured['started']:
                try: os.kill(pid, signal.SIGKILL)
                except ProcessLookupError: pass
finally:
    provider.shutdown(); provider.server_close(); thread.join(3)
    registry.shutdown(); registry.server_close()
