"""Compiled Core integration probe; run inside Dockerfile.worker image as root.
Uses synthetic deterministic model transport; never a real provider credential.
"""
import sys
from pathlib import Path
sys.path[:0] = [str(Path(__file__).parents[2] / 'worker'), str(Path(__file__).parents[1] / 'compatibility')]
import json
import threading
import time
from http.server import ThreadingHTTPServer
from urllib.request import Request, urlopen
from node_agent import Agent, Boundary, Handler, canonical, digest
import node_agent
from production_execution import Model, plugin_registry
generated = {}
original_popen = node_agent.subprocess.Popen
def test_popen(*args, **kwargs):
    generated.update(kwargs['env'])
    return original_popen(*args, **kwargs)
node_agent.subprocess.Popen = test_popen

class ProbeModel(Model):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['content-length'])))
        messages = body['messages']
        last_user = max((i for i, message in enumerate(messages) if message['role'] == 'user'), default=-1)
        answered = any(message['role'] == 'tool' for message in messages[last_user + 1:])
        question_mode = getattr(self.server, 'mode', 'shell') == 'question'
        if answered:
            delta = {'content': 'question compiled complete' if question_mode else 'Telegram compiled execution complete'}
            finish = 'stop'
        else:
            args = {'questions': [{'header': 'Probe', 'question': 'Continue?', 'options': [{'label': 'Approve', 'description': 'Allow fixture'}], 'multiple': False}]}
            if not question_mode:
                args = {'command': self.server.command, 'description': 'Compiled shell probe'}
            delta = {'tool_calls': [{'index': 0, 'id': 'question-probe' if question_mode else 'shell-probe', 'type': 'function', 'function': {'name': 'question' if question_mode else 'bash', 'arguments': json.dumps(args)}}]}
            finish = 'tool_calls'
        packets = [{'id':'fixture','object':'chat.completion.chunk','created':1,'model':'fixture','choices':[{'index':0,'delta':delta,'finish_reason':None}]}, {'id':'fixture','object':'chat.completion.chunk','created':1,'model':'fixture','choices':[{'index':0,'delta':{},'finish_reason':finish}]}]
        raw = (''.join('data: ' + json.dumps(packet) + '\n\n' for packet in packets) + 'data: [DONE]\n\n').encode()
        self.send_response(200)
        self.send_header('Content-Type','text/event-stream')
        self.send_header('Content-Length',str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

provider = ThreadingHTTPServer(('127.0.0.1', 0), ProbeModel)
provider.command = 'printf worker-owned-shell; sleep 2'
threading.Thread(target=provider.serve_forever, daemon=True).start()
root = Path('/data')
root.mkdir(exist_ok=True)
boundary = Boundary(root / 'agent', 'compiled-fixture-secret' * 2, dict(nodeId='compiled-probe', generation=1, chatId=-1, threadId=2))
(root / 'agent').chmod(0o700)
runtime = {'model': 'fixture/fixture', 'permission': 'allow', 'provider': {'fixture': {'npm': '@ai-sdk/openai-compatible', 'name': 'Fixture', 'options': {'baseURL': f'http://127.0.0.1:{provider.server_port}/v1', 'apiKey': 'fixture'}, 'models': {'fixture': {'name': 'Fixture', 'limit': {'context': 32000, 'output': 2048}}}}}}
snapshot = dict(version=1, revision=1, configuration={'runtime': runtime}, skills=[], actions=[], catalog={}, defaults={}, credentialReferences=[])
snapshot['hash'] = digest(snapshot)
boundary.apply(snapshot)
agent = Agent(boundary, 'https://control.invalid')
def fixture_control(operation, payload, session=None):
    if operation == 'snapshot.get':
        return snapshot
    raise ValueError('unexpected fixture control operation')
agent.outbound = fixture_control
agent.workspace = root / 'topic'
agent.workspace.mkdir(exist_ok=True)
registry = plugin_registry()
config_dir = root / 'runtime' / 'opencode'
config_dir.mkdir(parents=True, exist_ok=True)
(config_dir / '.npmrc').write_text(f'registry=http://127.0.0.1:{registry.server_port}/\n')
original_dispatch = agent.dispatch
def debug_dispatch(value):
    try:
        return original_dispatch(value)
    except Exception:
        import traceback
        traceback.print_exc()
        raise
agent.dispatch = debug_dispatch
server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
server.agent = agent
threading.Thread(target=server.serve_forever, daemon=True).start()
base = 'http://127.0.0.1:' + str(server.server_port)

def rpc(operation, payload=None, session=None):
    raw = canonical(boundary.envelope(operation, payload or {}, session))
    request = Request(base + '/rpc', data=raw, headers={'Content-Type': 'application/json', 'x-node-signature': boundary.signature(raw)})
    with urlopen(request, timeout=35) as response:
        body = response.read()
        assert boundary.signature(body) == response.headers['x-node-signature']
        envelope = json.loads(body)
        assert envelope['payload']['ok'], envelope
        return envelope['payload']['result']

try:
    agent.start_core()
    session = rpc('session.create')['sessionId']
    rpc('run.prepare', {'runId': 'compiled-real-run'}, session)
    raw = canonical(boundary.envelope('session.events', {'runId': 'compiled-real-run'}, session))
    live_stream = urlopen(Request(base + '/rpc', data=raw, headers={'x-node-signature': boundary.signature(raw)}), timeout=30)
    assert live_stream.headers['x-node-stream-ready'] == boundary.signature(raw + b'\nstream-ready')
    result = rpc('run', {'runId': 'compiled-real-run', 'parts': [{'type': 'text', 'text': 'Run the shell probe'}], 'model': {'providerID': 'fixture', 'modelID': 'fixture'}}, session)
    assert result['accepted']
    frames = []
    # Open the explicitly requested stream while actual model execution is live.
    for _ in range(40):
        status = rpc('status', {}, session)
        if status and status['continuation'] == 'live':
            break
        time.sleep(.05)
    paused = rpc('pause', {'runId': 'compiled-real-run'}, session)
    assert paused['paused'] is True
    resumed = rpc('resume', {'runId': 'compiled-real-run'}, session)
    assert resumed['paused'] is False
    with live_stream as response:
        for line in response:
            if line.startswith(b'data: '):
                frame = json.loads(line[6:])
                assert boundary.signature(frame['body'].encode()) == frame['signature']
                signed = json.loads(frame['body'])
                assert signed['sessionId'] == session and signed['payload']['runId'] == 'compiled-real-run'
                frames.append(signed)
    assert frames, 'no live signed events forwarded'
    for _ in range(100):
        history = json.dumps(rpc('session.messages', {}, session))
        if 'Telegram compiled execution complete' in history:
            break
        time.sleep(.1)
    assert 'worker-owned-shell' in history, history
    assert 'Telegram compiled execution complete' in history, history
    assert agent.process is not None
    assert generated['OPENCODE_TELEGRAM_PROCESS_BUDGET'] == '1'
    assert all(not key.startswith(('NODE_SHARED_SECRET', 'TELEGRAM_', 'RAILWAY_')) for key in generated)
    uid = Path(f'/proc/{agent.process.pid}/status').read_text().split('Uid:')[1].splitlines()[0].split()[0]
    assert uid == '1000', uid
    provider.mode = 'question'
    rpc('run', {'runId': 'compiled-question', 'text': 'Ask the probe question', 'model': {'providerID': 'fixture', 'modelID': 'fixture'}}, session)
    questions = []
    for _ in range(200):
        questions = rpc('question.list', {}, session)
        if questions:
            break
        time.sleep(.05)
    assert len(questions) == 1, questions
    rpc('question.reply', {'runId': 'compiled-question', 'requestId': questions[0]['id'], 'answers': [['Approve']]}, session)
    for _ in range(200):
        if 'question compiled complete' in json.dumps(rpc('session.messages', {}, session)):
            break
        time.sleep(.05)
    else:
        raise AssertionError('question execution did not complete')
    provider.mode = 'shell'
    provider.command = 'echo $$ > /data/topic/owned.pid; sleep 60'
    rpc('run', {'runId': 'compiled-stop', 'text': 'Run a long shell probe', 'model': {'providerID': 'fixture', 'modelID': 'fixture'}}, session)
    for _ in range(200):
        if Path('/data/topic/owned.pid').exists():
            break
        time.sleep(.05)
    pid = int(Path('/data/topic/owned.pid').read_text())
    rpc('stop', {'runId': 'compiled-stop'}, session)
    assert not Path(f'/proc/{pid}').exists(), 'stop left owned shell alive'
    agent.stop_core()
    restored = Boundary(root / 'agent', 'compiled-fixture-secret' * 2, boundary.identity)
    assert restored.snapshot == snapshot and restored.get('session') == session
    agent.start_core()
    assert rpc('session.get', {}, session)['id'] == session
    rpc('retire')
    assert agent.process is None and boundary.get('retired') is True
    print(json.dumps({'compiledCoreExecution': True, 'signedLiveEvents': len(frames), 'uid': 1000, 'processBudget': 1, 'retirement': True, 'questionReply': True, 'pauseResume': True, 'stopJoinedShell': True, 'restartSession': True, 'snapshotRestore': True}))
finally:
    agent.stop_core()
    server.shutdown()
    provider.shutdown()
    registry.shutdown()
