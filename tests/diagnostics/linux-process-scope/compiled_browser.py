#!/usr/bin/env python3
"""Real compiled custom-tool browser API. Requires the deployment's pinned CLI/Chromium.
No mock browser or process identity; bounded HTTP barriers make active pause causal.
"""
import argparse, io, json, os, sys, threading, time
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
sys.path.insert(0, os.environ.get('COMPILED_FIXTURE_TESTS', str(Path(__file__).resolve().parents[2] / 'compatibility')))
from session_contract import Server, Client
from production_execution import Model, plugin_registry

class CurrentTurnModel(Model):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['content-length'])))
        # The fixture chooses one tool in each current user turn, not just once
        # in the entire persistent session history.
        messages = body['messages']
        latest = max(i for i, message in enumerate(messages) if message['role'] == 'user')
        body['messages'] = messages[latest:]
        raw = json.dumps(body).encode()
        self.rfile = io.BytesIO(raw)
        self.headers.replace_header('content-length', str(len(raw)))
        super().do_POST()

entered = threading.Event(); release = threading.Event()
class BarrierPage(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_GET(self):
        entered.set()
        assert release.wait(20), 'browser barrier not released'
        raw = b'<title>barrier-complete</title>'
        self.send_response(200); self.send_header('content-length', str(len(raw))); self.end_headers()
        try: self.wfile.write(raw)
        except (BrokenPipeError, ConnectionResetError): pass

def wait(fn, seconds=15):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        result = fn()
        if result: return result
        time.sleep(.02)
    raise AssertionError('bounded observation expired')

def processes():
    found = {}
    for entry in Path('/proc').iterdir():
        if not entry.name.isdigit(): continue
        try:
            stat = (entry / 'stat').read_text().rsplit(')', 1)[1].split()
            found[int(entry.name)] = {'pid': int(entry.name), 'state': stat[0], 'ppid': int(stat[1]),
                'start': stat[19], 'cmd': (entry / 'cmdline').read_bytes().replace(b'\0', b' ').decode(errors='replace')}
        except (FileNotFoundError, ProcessLookupError): pass
    return found

def browser_tree():
    table = processes()
    daemons = [p for p in table.values() if 'cliDaemon.js core-' in p['cmd']]
    result = {}
    for daemon in daemons:
        runner = daemon['ppid']; selected = {runner}
        while True:
            more = {p['pid'] for p in table.values() if p['ppid'] in selected}
            if more <= selected: break
            selected |= more
        result[daemon['pid']] = [table[pid] for pid in selected if pid != runner]
    return result

def same_alive(captured):
    current = processes()
    return [p for p in captured if current.get(p['pid'], {}).get('start') == p['start']]

def run(binary):
    provider = ThreadingHTTPServer(('127.0.0.1', 0), CurrentTurnModel); provider.tool = 'core_probe'
    page = ThreadingHTTPServer(('127.0.0.1', 0), BarrierPage)
    for server in (provider, page): threading.Thread(target=server.serve_forever, daemon=True).start()
    registry = plugin_registry(); roots = []
    def configure(root, env):
        roots.append(root)
        config = root / '.opencode'; tools = config / 'tools'; tools.mkdir(parents=True)
        (tools / 'core_probe.ts').write_text('export default {description:"Owned browser diagnostic",args:{},async execute(args,context){'+
            'const request=await Bun.file('+json.dumps(str(root))+'+"/"+context.sessionID+".json").json();'+
            'const result=await context.process.browser(request); return result.stdout}}')
        (config / '.npmrc').write_text(f'registry=http://127.0.0.1:{registry.server_port}/\n')
        env.update(OPENCODE_TELEGRAM_PROCESS_BUDGET='1', NPM_CONFIG_REGISTRY=f'http://127.0.0.1:{registry.server_port}/',
            OPENCODE_CONFIG_DIR=str(config), OPENCODE_CONFIG_CONTENT=json.dumps({'model':'fixture/fixture','permission':'allow',
            'provider':{'fixture':{'npm':'@ai-sdk/openai-compatible','name':'Fixture','options':{
                'baseURL':f'http://127.0.0.1:{provider.server_port}/v1','apiKey':'fixture'},'models':{'fixture':{
                'name':'Fixture','limit':{'context':32000,'output':2048}}}}}}))
    captured = []
    try:
        with Server(binary, readiness_path='/global/health', configure=configure) as runtime:
            client = Client(runtime.base)
            a,b = [client.request('POST','/session',{})['id'] for _ in range(2)]
            def prompt(sid, request, asynchronous=False):
                (roots[0] / (sid+'.json')).write_text(json.dumps(request))
                result = client.request('POST', f'/session/{sid}/'+('prompt_async' if asynchronous else 'message'),
                    {'parts':[{'type':'text','text':'Run browser probe'}], 'model':{'providerID':'fixture','modelID':'fixture'}}, timeout=45)
                if not asynchronous:
                    text=json.dumps(result)
                    assert '"status": "error"' not in text, text
                    return text
            assert 'topic-a' in prompt(a, {'action':'open','args':['data:text/html,<title>topic-a</title><h1>A</h1>']})
            first = browser_tree(); assert len(first)==1, first
            assert all(p['state']=='T' for group in first.values() for p in group), first
            assert 'topic-a' in prompt(a, {'action':'snapshot'})
            assert set(browser_tree())==set(first), 'new generation changed persistent browser identity'
            assert 'topic-b' in prompt(b, {'action':'open','args':['data:text/html,<title>topic-b</title><h1>B</h1>']})
            both=browser_tree(); assert len(both)==2, both
            captured=[p for group in both.values() for p in group]
            prompt(a, {'action':'goto','args':[f'http://127.0.0.1:{page.server_port}/']}, True)
            assert entered.wait(15), 'active navigation did not reach barrier'
            owner=client.request('GET',f'/session/{a}/execution')
            pause=client.request('POST',f'/session/{a}/pause',{key:owner[key] for key in ('runId','generation') if key in owner})
            assert pause['paused'], pause
            wait(lambda: all(p['state']=='T' for group in browser_tree().values() for p in group))
            assert 'topic-b' in prompt(b, {'action':'snapshot'}), 'topic A pause blocked foreign browser'
            client.request('POST',f'/session/{a}/abort',{})
            a_ids=list(first.values())[0]
            wait(lambda: not same_alive(a_ids))
            remaining=browser_tree(); assert len(remaining)==1 and not set(remaining)&set(first), remaining
            assert 'topic-b' in prompt(b, {'action':'snapshot'})
            assert client.request('POST','/global/dispose',timeout=15)
            wait(lambda: not same_alive(captured))
            print(json.dumps({'build':json.loads(os.popen(binary+' debug build-info').read()),
                'persistentGenerationHandoff':True,'idleParked':True,'exclusiveTopicPause':True,
                'pausedAbortConfirmedEmpty':True,'workspaceRetirementConfirmedEmpty':True,
                'browserTrees':len(both),'capturedProcesses':len(captured)},indent=2),flush=True)
    finally:
        release.set()
        for server in (provider,page,registry): server.shutdown(); server.server_close()
        alive=same_alive(captured)
        for p in alive:
            try: os.kill(p['pid'],9)
            except ProcessLookupError: pass
        assert not alive, 'diagnostic had to clean browser survivors'

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--binary',required=True);args=parser.parse_args();run(str(Path(args.binary).resolve()))
