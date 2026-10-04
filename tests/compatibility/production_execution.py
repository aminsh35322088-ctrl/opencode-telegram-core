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
from session_contract import Server, Client, HttpError
from mcp_oauth_fixture import OAuthPeer
from urllib.parse import urlencode

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
    def test_retained_plugin_sdk_can_persist_provider_credentials(self):
        roots = []; registry = plugin_registry()
        def configure(root, env):
            roots.append(root)
            config_dir = root / 'plugin-config'; config_dir.mkdir()
            plugin = config_dir / 'credential-plugin.js'
            plugin.write_text("export default async ({client}) => { const result = await client.auth.set({path:{id:'plugin-fixture'},body:{type:'api',key:'fixture'}}); if(result.error) throw Error('credential publication failed'); return {} };\n")
            (config_dir / '.npmrc').write_text(f'registry=http://127.0.0.1:{registry.server_port}/\n')
            env['NPM_CONFIG_REGISTRY'] = f'http://127.0.0.1:{registry.server_port}/'
            env['OPENCODE_CONFIG_DIR'] = str(config_dir)
            env['OPENCODE_CONFIG_CONTENT'] = json.dumps({'plugin': [plugin.as_uri()]})
        try:
            with Server(BINARY, readiness_path='/global/health', configure=configure) as server:
                c = Client(server.base); c.request('GET', '/agent', timeout=30)
                paths = list((roots[0] / 'data').rglob('auth.json'))
                self.assertEqual(len(paths), 1, 'retained plugin SDK could not publish credentials')
                self.assertIn('plugin-fixture', json.loads(paths[0].read_text()))
                self.assertTrue(c.request('POST', '/global/dispose', timeout=15))
        finally: registry.shutdown(); registry.server_close()

    def test_compiled_aws_process_credentials_fail_closed_without_launch(self):
        roots = []
        def configure(root, env):
            roots.append(root)
            helper = root / 'aws-helper.py'
            helper.write_text('import pathlib,json\npathlib.Path(' + repr(str(root / 'aws-helper-started')) + ').write_text("started")\nprint(json.dumps({"Version":1,"AccessKeyId":"fixture","SecretAccessKey":"fixture"}))\n')
            config = root / 'aws-config'
            config.write_text('[profile core-fixture]\ncredential_process = ' + shlex.quote(sys.executable) + ' ' + shlex.quote(str(helper)) + '\n')
            credentials = root / 'aws-credentials'; credentials.write_text('')
            env.update(AWS_CONFIG_FILE=str(config), AWS_SHARED_CREDENTIALS_FILE=str(credentials),
                AWS_PROFILE='core-fixture', AWS_EC2_METADATA_DISABLED='true', OPENCODE_TELEGRAM_PROCESS_BUDGET='1')
            env['OPENCODE_CONFIG_CONTENT'] = json.dumps({'permission': 'allow', 'provider': {
                'amazon-bedrock': {'options': {'profile': 'core-fixture', 'region': 'us-east-1',
                'endpoint': 'http://127.0.0.1:1'}, 'models': {'fixture': {'name': 'Fixture',
                'limit': {'context': 32000, 'output': 1024}}}}}})
        with Server(BINARY, readiness_path='/global/health', configure=configure) as server:
            c = Client(server.base); sid = c.request('POST', '/session', {})['id']
            c.request('POST', f'/session/{sid}/message', {'parts': [{'type': 'text', 'text': 'fixture'}],
                'model': {'providerID': 'amazon-bedrock', 'modelID': 'fixture'}}, timeout=15)
            history = json.dumps(c.request('GET', f'/session/{sid}/message'))
            self.assertIn('credential_process is unsupported in Telegram Core', history)
            self.assertFalse((roots[0] / 'aws-helper-started').exists())
            self.assertTrue(c.request('POST', '/global/dispose', timeout=15))

    def test_compiled_concurrent_credential_updates_preserve_all_accounts(self):
        roots = []
        with Server(BINARY, readiness_path='/global/health', configure=lambda root, env: roots.append(root)) as server:
            c = Client(server.base); failures = queue.Queue(); barrier = threading.Barrier(12)
            def update(index):
                try:
                    barrier.wait(5)
                    self.assertTrue(c.request('PUT', '/auth/compiled-fixture-' + str(index),
                        {'type': 'api', 'key': 'compiled-fixture-key'}, timeout=15))
                except Exception as error: failures.put(error)
            threads = [threading.Thread(target=update, args=(index,), daemon=True) for index in range(12)]
            for thread in threads: thread.start()
            for thread in threads: thread.join(20)
            self.assertFalse(any(thread.is_alive() for thread in threads), 'credential request did not settle')
            self.assertTrue(failures.empty(), list(failures.queue))
            paths = list((roots[0] / 'data').rglob('auth.json'))
            self.assertEqual(len(paths), 1)
            self.assertEqual(set(json.loads(paths[0].read_text())), {'compiled-fixture-' + str(i) for i in range(12)})
            self.assertTrue(c.request('DELETE', '/auth/compiled-fixture-0', timeout=15))
            self.assertEqual(len(json.loads(paths[0].read_text())), 11)

    def test_compiled_orphan_oauth_callback_does_not_bootstrap_services(self):
        with OAuthPeer() as peer:
            def configure(root, env):
                env['OPENCODE_CONFIG_CONTENT'] = json.dumps({'mcp': {'enabled-peer': {'type': 'remote', 'url': peer.url, 'timeout': 5000}}})
            with Server(BINARY, readiness_path='/global/health', configure=configure) as server:
                result = Client(server.base).request('POST', '/mcp/enabled-peer/auth/callback', {'code': 'orphaned-code', 'oauthState': 'orphaned-state'}, timeout=15)
                self.assertEqual(result['status'], 'failed', result)
                self.assertEqual(peer.registrations, [])
                self.assertEqual(peer.exchanges, [])

    def test_compiled_oauth_same_name_workspace_and_callback_fencing(self):
        directories = []
        def configure(root, env):
            for name in ('workspace-a', 'workspace-b'):
                directory = root / name; directory.mkdir(); directories.append(directory)
        with OAuthPeer() as a, OAuthPeer() as b:
            with Server(BINARY, readiness_path='/global/health', configure=configure) as server:
                c = Client(server.base)
                def request(workspace, method, path, body=None):
                    return c.request(method, path + '?' + urlencode({'directory': str(directories[workspace])}), body, timeout=15)
                for i, peer in enumerate((a, b)):
                    request(i, 'POST', '/mcp', {'name': 'shared-name', 'config': {'type': 'remote', 'url': peer.url, 'enabled': False, 'timeout': 5000}})
                first = request(0, 'POST', '/mcp/shared-name/auth')
                second = request(1, 'POST', '/mcp/shared-name/auth')
                a.authorize(first, 'code-a'); b.authorize(second, 'code-b')
                with self.assertRaisesRegex(HttpError, "-> 400:"):
                    request(0, 'POST', '/mcp/shared-name/auth/callback', {'code': 'code-a'})
                stale = request(0, 'POST', '/mcp/shared-name/auth/callback', {'code': 'code-a', 'oauthState': second['oauthState']})
                self.assertEqual(stale['status'], 'failed', stale)
                self.assertEqual(a.exchanges, []); self.assertEqual(b.exchanges, [])
                done_a = request(0, 'POST', '/mcp/shared-name/auth/callback', {'code': 'code-a', 'oauthState': first['oauthState']})
                done_b = request(1, 'POST', '/mcp/shared-name/auth/callback', {'code': 'code-b', 'oauthState': second['oauthState']})
                self.assertEqual(done_a['status'], 'connected', done_a)
                self.assertEqual(done_b['status'], 'connected', done_b)
                self.assertEqual(a.exchanges, ['code-a']); self.assertEqual(b.exchanges, ['code-b'])
                pending = request(0, 'POST', '/mcp/shared-name/auth')
                a.authorize(pending, 'retired-code')
                self.assertTrue(c.request('POST', '/global/dispose', timeout=15))
                retired = request(0, 'POST', '/mcp/shared-name/auth/callback', {'code': 'retired-code', 'oauthState': pending['oauthState']})
                self.assertEqual(retired['status'], 'failed', retired)
                self.assertNotIn('retired-code', a.exchanges)

    def test_compiled_oauth_retirement_aborts_delayed_token_without_committing(self):
        roots = []
        def configure(root, env): roots.append(root)
        with OAuthPeer() as peer:
            peer.gate = threading.Event()
            with Server(BINARY, readiness_path='/global/health', configure=configure) as server:
                c = Client(server.base); result = queue.Queue()
                c.request('POST', '/mcp', {'name': 'late-auth', 'config': {'type': 'remote', 'url': peer.url, 'enabled': False, 'timeout': 5000}})
                flow = c.request('POST', '/mcp/late-auth/auth', timeout=15)
                peer.authorize(flow, 'late-code')
                def exchange():
                    try: result.put(c.request('POST', '/mcp/late-auth/auth/callback', {'code': 'late-code', 'oauthState': flow['oauthState']}, timeout=15))
                    except HttpError as error: result.put(error)
                worker = threading.Thread(target=exchange, daemon=True); worker.start()
                try:
                    self.assertTrue(peer.entered.wait(10), 'compiled token exchange did not reach barrier')
                    self.assertTrue(c.request('POST', '/global/dispose', timeout=15))
                finally:
                    peer.gate.set(); worker.join(15)
                self.assertFalse(worker.is_alive(), 'token request survived confirmed workspace retirement')
                outcome = result.get(timeout=1)
                if isinstance(outcome, dict): self.assertEqual(outcome['status'], 'failed', outcome)
                for path in (roots[0] / 'data').rglob('mcp-auth.json'):
                    self.assertFalse(json.loads(path.read_text()).get('late-auth', {}).get('tokens'), 'retired exchange committed credentials')
                self.assertEqual(peer.exchanges, ['late-code'])

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
                    provider.command = 'printf replacement-owned'
                    result = c.request('POST', f'/session/{replacement}/message',
                                       {'parts': [{'type': 'text', 'text': 'Run replacement probe'}],
                                        'model': {'providerID': 'fixture', 'modelID': 'fixture'}}, timeout=30)
                    result = c.request('GET', f'/session/{replacement}/message')
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
