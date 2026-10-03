#!/usr/bin/env python3
"""Real compiled legacy agent execution using a deterministic local model transport."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import os
import shlex
import sys
import queue
import io
import tarfile
import hashlib
import base64
import urllib.request
import threading
import time
import unittest
from session_contract import Server, Client

BINARY = None
class Model(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, *args): pass
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['content-length'])))
        has_tool = any(m['role'] == 'tool' for m in body['messages'])
        if has_tool:
            delta = {'content': 'Telegram compiled execution complete'}
            finish = 'stop'
        else:
            tool_name = getattr(self.server, 'tool', 'bash')
            arguments = {'command': getattr(self.server, 'command', 'printf telegram-owned-shell'), 'description': 'Compiled production probe'} if tool_name == 'bash' else {}
            delta = {'tool_calls': [{'index': 0, 'id': 'compile-probe', 'type': 'function',
                     'function': {'name': tool_name, 'arguments': json.dumps(arguments)}}]}
            finish = 'tool_calls'
        packets = [{'id': 'fixture', 'object': 'chat.completion.chunk', 'created': 1, 'model': 'fixture',
                    'choices': [{'index': 0, 'delta': delta, 'finish_reason': None}]},
                   {'id': 'fixture', 'object': 'chat.completion.chunk', 'created': 1, 'model': 'fixture',
                    'choices': [{'index': 0, 'delta': {}, 'finish_reason': finish}],
                    'usage': {'prompt_tokens': 20, 'completion_tokens': 5, 'total_tokens': 25}}]
        output = ''.join('data: ' + json.dumps(p) + '\n\n' for p in packets) + 'data: [DONE]\n\n'
        self.send_response(200)
        self.send_header('content-type', 'text/event-stream')
        self.send_header('content-length', str(len(output.encode())))
        self.end_headers()
        self.wfile.write(output.encode())

class Registry(BaseHTTPRequestHandler):
    """Minimal offline plugin package; the tool fixture needs no SDK imports."""
    def log_message(self, *args): pass
    def do_GET(self):
        if self.path.endswith('.tgz'):
            raw = self.server.package; mime = 'application/octet-stream'
        else:
            package = {'name': '@opencode-ai/plugin', 'version': '1.18.33', 'type': 'module', 'main': 'index.js',
                'dist': {'tarball': f'http://127.0.0.1:{self.server.server_port}/plugin.tgz',
                         'integrity': 'sha512-' + base64.b64encode(hashlib.sha512(self.server.package).digest()).decode()}}
            raw = json.dumps({'name': '@opencode-ai/plugin', 'dist-tags': {'latest': '1.18.33'},
                              'versions': {'1.18.33': package}}).encode(); mime = 'application/json'
        self.send_response(200); self.send_header('content-type', mime); self.send_header('content-length', str(len(raw)))
        self.end_headers(); self.wfile.write(raw)

def plugin_registry():
    blob = io.BytesIO()
    with tarfile.open(fileobj=blob, mode='w:gz') as archive:
        for name, content in {'package/package.json': json.dumps({'name': '@opencode-ai/plugin', 'version': '1.18.33',
                                     'type': 'module', 'main': 'index.js'}), 'package/index.js': 'export {};\n'}.items():
            raw = content.encode(); info = tarfile.TarInfo(name); info.size = len(raw); archive.addfile(info, io.BytesIO(raw))
    registry = ThreadingHTTPServer(('127.0.0.1', 0), Registry); registry.package = blob.getvalue()
    threading.Thread(target=registry.serve_forever, daemon=True).start()
    return registry

class ProductionExecution(unittest.TestCase):
    def test_compiled_custom_tool_uses_captured_process_capability(self):
        provider = ThreadingHTTPServer(('127.0.0.1', 0), Model); provider.tool = 'core_probe'
        thread = threading.Thread(target=provider.serve_forever, daemon=True); thread.start()
        registry = plugin_registry()
        def configure(root, env):
            config_dir = root / '.opencode'; tools = config_dir / 'tools'; tools.mkdir(parents=True)
            (tools / 'core_probe.ts').write_text("export default { description: 'Compiled custom process probe', args: {}, async execute(args, context) { const result = await context.process.execFile('/bin/bash', ['-c', 'printf core-custom-owned']); return result.stdout } }\n")
            (config_dir / '.npmrc').write_text(f'registry=http://127.0.0.1:{registry.server_port}/\n')
            env['OPENCODE_TELEGRAM_PROCESS_BUDGET'] = '1'
            env['NPM_CONFIG_REGISTRY'] = f'http://127.0.0.1:{registry.server_port}/'
            env['OPENCODE_CONFIG_DIR'] = str(config_dir)
            env['OPENCODE_CONFIG_CONTENT'] = json.dumps({'model': 'fixture/fixture', 'permission': 'allow',
                'provider': {'fixture': {'npm': '@ai-sdk/openai-compatible', 'name': 'Fixture',
                'options': {'baseURL': f'http://127.0.0.1:{provider.server_port}/v1', 'apiKey': 'fixture'},
                'models': {'fixture': {'name': 'Fixture', 'limit': {'context': 32000, 'output': 2048}}}}}})
        try:
            with Server(BINARY, readiness_path='/global/health', configure=configure) as server:
                c = Client(server.base); sid = c.request('POST', '/session', {})['id']
                c.request('POST', f'/session/{sid}/message', {'parts': [{'type': 'text', 'text': 'Run custom probe'}],
                    'model': {'providerID': 'fixture', 'modelID': 'fixture'}}, timeout=45)
                history = json.dumps(c.request('GET', f'/session/{sid}/message'))
                self.assertIn('core-custom-owned', history, history)
                self.assertNotIn('"status": "error"', history, history)
                self.assertTrue(c.request('POST', '/global/dispose'))
        finally:
            provider.shutdown(); provider.server_close(); thread.join(3)
            registry.shutdown(); registry.server_close()

    def test_compiled_mcp_stdio_owns_descendants_and_disconnect(self):
        root_holder = []
        def configure(root, env): root_holder.append(root)
        with Server(BINARY, readiness_path='/global/health', configure=configure) as server:
            c = Client(server.base); pid_file = root_holder[0] / 'mcp-pids.json'
            result = c.request('POST', '/mcp', {'name': 'compiled-probe', 'config': {'type': 'local',
                'command': [sys.executable, str(Path(__file__).with_name('mcp_fixture.py').resolve()), str(pid_file)],
                'timeout': 5000}}, timeout=15)
            self.assertEqual(result['compiled-probe']['status'], 'connected', result)
            pids = json.loads(pid_file.read_text())
            self.assertTrue(all(Path(f'/proc/{pid}').exists() for pid in pids))
            c.request('POST', '/mcp/compiled-probe/disconnect', timeout=15)
            self.assertTrue(all(not Path(f'/proc/{pid}').exists() for pid in pids), 'disconnect returned before group retirement')
            self.assertEqual(c.request('GET', '/mcp')['compiled-probe']['status'], 'disabled')

    def test_physical_pause_resume_abort_and_stale_run_fencing(self):
        self._exercise_paused_retirement(workspace=False)

    def test_paused_workspace_retirement_joins_group_cleanup_before_replacement(self):
        self._exercise_paused_retirement(workspace=True)

    def _exercise_paused_retirement(self, workspace):
        provider = ThreadingHTTPServer(('127.0.0.1', 0), Model)
        thread = threading.Thread(target=provider.serve_forever, daemon=True); thread.start()
        pid_file = None
        def configure(root, env):
            nonlocal pid_file
            pid_file = root / 'shell.pid'
            # Full CLI is debug tooling and does not enforce the production governor itself.
            env['OPENCODE_TELEGRAM_PROCESS_BUDGET'] = '1'
            provider.command = 'echo $$ > ' + shlex.quote(str(pid_file)) + '; sleep 60'
            env['OPENCODE_CONFIG_CONTENT'] = json.dumps({'model': 'fixture/fixture', 'permission': 'allow',
                'provider': {'fixture': {'npm': '@ai-sdk/openai-compatible', 'name': 'Fixture',
                'options': {'baseURL': f'http://127.0.0.1:{provider.server_port}/v1', 'apiKey': 'fixture'},
                'models': {'fixture': {'name': 'Fixture', 'limit': {'context': 32000, 'output': 2048}}}}}})
        try:
            with Server(BINARY, readiness_path='/global/health', configure=configure) as server:
                c = Client(server.base); sid = c.request('POST', '/session', {})['id']
                c.request('POST', f'/session/{sid}/prompt_async', {'parts': [{'type': 'text', 'text': 'Run probe'}],
                    'model': {'providerID': 'fixture', 'modelID': 'fixture'}})
                deadline = time.monotonic() + 15
                while not pid_file.exists() and time.monotonic() < deadline: time.sleep(.05)
                self.assertTrue(pid_file.exists(), 'actual agent shell never started')
                pid = int(pid_file.read_text().strip())
                control = c.request('GET', f'/session/{sid}/execution')
                owner = {'runId': control['runId']}
                paused = c.request('POST', f'/session/{sid}/pause', owner)
                self.assertTrue(paused['paused']); self.assertEqual(paused['continuation'], 'live')
                # SIGSTOP delivery is asynchronous to the HTTP acknowledgment.
                # Observe the same physical PID within the existing Linux test bound.
                stopped_by = time.monotonic() + 1
                while Path(f'/proc/{pid}/stat').read_text().split(') ', 1)[1][0] != 'T':
                    self.assertLess(time.monotonic(), stopped_by, 'owned shell did not physically stop')
                    time.sleep(.005)
                resumed = c.request('POST', f'/session/{sid}/resume', owner)
                self.assertFalse(resumed['paused']); self.assertEqual(resumed['runId'], owner['runId'])
                c.request('POST', f'/session/{sid}/pause', owner)
                retire_path = '/global/dispose' if workspace else f'/session/{sid}/abort'
                self.assertTrue(c.request('POST', retire_path, None if workspace else owner, timeout=15))
                self.assertFalse(Path(f'/proc/{pid}').exists(), 'cancel returned with owned shell alive')
                if not workspace:
                    self.assertIsNone(c.request('GET', f'/session/{sid}/execution'))
                with self.assertRaises(Exception) as caught:
                    c.request('POST', f'/session/{sid}/resume', owner)
                self.assertIn('409', str(caught.exception))
                if workspace:
                    replacement = c.request('POST', '/session', {})['id']
                    result = c.request('POST', f'/session/{replacement}/shell',
                                       {'command': 'printf replacement-owned', 'agent': 'build'}, timeout=15)
                    self.assertIn('replacement-owned', json.dumps(result))
                    self.assertTrue(c.request('POST', '/global/dispose'))
        finally:
            provider.shutdown(); provider.server_close(); thread.join(3)

    def test_compiled_model_shell_result_history_and_workspace_cleanup(self):
        provider = ThreadingHTTPServer(('127.0.0.1', 0), Model)
        thread = threading.Thread(target=provider.serve_forever, daemon=True)
        thread.start()
        def configure(root, env):
            env['OPENCODE_CONFIG_CONTENT'] = json.dumps({'model': 'fixture/fixture', 'permission': 'allow',
                'provider': {'fixture': {'npm': '@ai-sdk/openai-compatible', 'name': 'Fixture',
                'options': {'baseURL': f'http://127.0.0.1:{provider.server_port}/v1', 'apiKey': 'fixture'},
                'models': {'fixture': {'name': 'Fixture', 'limit': {'context': 32000, 'output': 2048}}}}}})
        try:
            with Server(BINARY, readiness_path='/global/health', configure=configure) as server:
                c = Client(server.base)
                session = c.request('POST', '/session', {})
                sid = session['id']
                ready = threading.Event(); observed = queue.Queue()
                def receive():
                    try:
                        with urllib.request.urlopen(server.base + '/event', timeout=15) as stream:
                            data = []
                            while True:
                                line = stream.readline().decode().rstrip('\r\n')
                                if line.startswith('data:'): data.append(line[5:].strip())
                                elif not line and data:
                                    event = json.loads('\n'.join(data)); data = []; ready.set()
                                    origin = event.get('metadata', {}).get('telegramExecution', {})
                                    if origin.get('root', {}).get('sessionId') == sid:
                                        observed.put(origin); break
                    except Exception as error: observed.put(error); ready.set()
                events = threading.Thread(target=receive, daemon=True); events.start()
                self.assertTrue(ready.wait(5), 'compiled SSE never connected')
                answer = c.request('POST', f'/session/{sid}/message', {'parts': [{'type': 'text', 'text': 'Run the shell probe'}],
                           'model': {'providerID': 'fixture', 'modelID': 'fixture'}}, timeout=30)
                origin = observed.get(timeout=5)
                self.assertIsInstance(origin, dict, origin)
                self.assertEqual(origin['root']['sessionId'], sid)
                self.assertEqual(origin['producer']['sessionId'], sid)
                self.assertTrue(origin['root']['runId'])
                events.join(5); self.assertFalse(events.is_alive())
                history = c.request('GET', f'/session/{sid}/message', timeout=10)
                serialized = json.dumps(history)
                self.assertIn('telegram-owned-shell', serialized, serialized)
                self.assertIn('Telegram compiled execution complete', serialized, serialized)
                self.assertTrue(any(p.get('type') == 'tool' and p.get('state', {}).get('status') == 'completed'
                                 for m in history for p in m['parts']))
                self.assertNotIn(sid, c.request('GET', '/session/status'))
                self.assertTrue(c.request('POST', f'/session/{sid}/abort'))
                self.assertTrue(c.request('POST', '/global/dispose'))
        finally:
            provider.shutdown(); provider.server_close(); thread.join(3)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--binary', required=True)
    args, rest = parser.parse_known_args(); BINARY = args.binary
    unittest.main(argv=[__file__, *rest])
