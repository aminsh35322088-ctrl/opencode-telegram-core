#!/usr/bin/env python3
"""Real compiled custom-tool browser API. Requires the deployment's pinned CLI/Chromium.
No mock browser or process identity; bounded HTTP barriers make active pause causal.
"""
import argparse, io, json, os, sys, threading, time
from pathlib import Path
from urllib.parse import quote
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
    daemons = [p for p in table.values() if p['cmd'].split() and
        Path(p['cmd'].split()[0]).name in ('node', 'nodejs') and 'cliDaemon.js core-' in p['cmd']]
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

def memory_observation():
    # Preserve the capacity failure's physical accounting before fixture teardown.
    group = Path('/sys/fs/cgroup')
    try:
        stat = dict(line.split() for line in (group / 'memory.stat').read_text().splitlines())
        current = int((group / 'memory.current').read_text())
        inactive = int(stat.get('inactive_file', '0'))
        return {'current': current, 'maximum': (group / 'memory.max').read_text().strip(),
            'inactiveFile': inactive, 'workingSet': current - inactive if 0 <= inactive < current else current,
            'anon': int(stat.get('anon', '0')), 'file': int(stat.get('file', '0'))}
    except (OSError, ValueError): return {'unavailable': True}

def run(binary):
    provider = ThreadingHTTPServer(('127.0.0.1', 0), CurrentTurnModel); provider.tool = 'core_probe'
    page = ThreadingHTTPServer(('127.0.0.1', 0), BarrierPage)
    for server in (provider, page): threading.Thread(target=server.serve_forever, daemon=True).start()
    registry = plugin_registry(); roots = []
    def configure(root, env):
        roots.append(root)
        # Server isolates HOME/cache; explicitly pass the image's required
        # immutable browser installation rather than silently using its empty HOME.
        env['PLAYWRIGHT_BROWSERS_PATH'] = os.environ['PLAYWRIGHT_BROWSERS_PATH']
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
    captured = []; private_directories = set()
    try:
        with Server(binary, readiness_path='/global/health', configure=configure) as runtime:
            class WorkspaceClient(Client):
                def request(self, method, path, body=None, timeout=5):
                    return super().request(method, path + ('&' if '?' in path else '?') +
                        'directory=' + quote(str(roots[0]), safe=''), body, timeout)
            client = WorkspaceClient(runtime.base)
            a,b = [client.request('POST','/session',{})['id'] for _ in range(2)]
            def prompt(sid, request, asynchronous=False, expected_error=None):
                (roots[0] / (sid+'.json')).write_text(json.dumps(request))
                result = client.request('POST', f'/session/{sid}/'+('prompt_async' if asynchronous else 'message'),
                    {'parts':[{'type':'text','text':'Run browser probe'}], 'model':{'providerID':'fixture','modelID':'fixture'}}, timeout=45)
                if not asynchronous:
                    history = client.request('GET', f'/session/{sid}/message')
                    tools = [part for message in history for part in message.get('parts', []) if part.get('type') == 'tool']
                    assert tools, json.dumps(history)
                    state = tools[-1]['state']
                    if expected_error:
                        assert state['status']=='error' and expected_error in state['error'],json.dumps(state)
                        return state['error']
                    if state['status'] != 'completed':
                        print('BROWSER_CAPACITY ' + json.dumps({'browserFailure': state, 'memory': memory_observation(),
                            'trees': {pid: len(children) for pid, children in browser_tree().items()}}), flush=True)
                    assert state['status'] == 'completed', json.dumps(state)
                    return state['output']
            assert 'topic-a' in prompt(a, {'action':'open','args':['data:text/html,<title>topic-a</title><h1>A</h1>']})
            first = browser_tree(); assert len(first)==1, first
            assert all(p['state']=='T' for group in first.values() for p in group), first
            assert 'topic-a' in prompt(a, {'action':'snapshot'})
            assert set(browser_tree())==set(first), 'new generation changed persistent browser identity'
            assert 'topic-b' in prompt(b, {'action':'open','args':['data:text/html,<title>topic-b</title><h1>B</h1>']})
            both=browser_tree(); assert len(both)==2, both
            captured=[p for group in both.values() for p in group]
            for daemon in both:
                environment=dict(entry.split(b'=',1) for entry in Path(f'/proc/{daemon}/environ').read_bytes().split(b'\0') if b'=' in entry)
                private=Path(environment[b'TMPDIR'].decode());private_directories.add(private)
                assert private.name.startswith('oc-browser-')
                for child in both[daemon]:
                    for argument in child['cmd'].split():
                        if argument.startswith('--user-data-dir='):
                            assert Path(argument.split('=',1)[1]).is_relative_to(private),child

            prompt(a, {'action':'goto','args':[f'http://127.0.0.1:{page.server_port}/']}, True)
            assert entered.wait(15), 'active navigation did not reach barrier'
            owner=client.request('GET',f'/session/{a}/execution')
            pause=client.request('POST',f'/session/{a}/pause',{key:owner[key] for key in ('runId','generation') if key in owner})
            assert pause['paused'], pause
            wait(lambda: all(p['state']=='T' for group in browser_tree().values() for p in group))
            assert 'topic-b' in prompt(b, {'action':'snapshot'}), 'topic A pause blocked foreign browser'
            owner_keys = {key:owner[key] for key in ('runId','generation') if key in owner}
            release.set()
            assert client.request('POST',f'/session/{a}/resume',owner_keys)['paused'] is False
            wait(lambda: client.request('GET',f'/session/{a}/execution') is None)
            assert set(first) <= set(browser_tree()), 'resume replaced the persistent daemon'
            assert 'barrier-complete' in prompt(a, {'action':'snapshot'})
            entered.clear(); release.clear()
            prompt(a, {'action':'goto','args':[f'http://127.0.0.1:{page.server_port}/again']}, True)
            assert entered.wait(15)
            owner=client.request('GET',f'/session/{a}/execution')
            owner_keys = {key:owner[key] for key in ('runId','generation') if key in owner}
            assert client.request('POST',f'/session/{a}/pause',owner_keys)['paused']
            wait(lambda: all(p['state']=='T' for group in browser_tree().values() for p in group))
            a_ids=browser_tree()[next(iter(first))]
            captured += a_ids
            client.request('POST',f'/session/{a}/abort',owner_keys)
            wait(lambda: not same_alive(a_ids))
            remaining=browser_tree(); assert len(remaining)==1 and not set(remaining)&set(first), remaining
            assert 'topic-b' in prompt(b, {'action':'snapshot'})
            assert client.request('POST','/global/dispose',timeout=15)
            wait(lambda: not same_alive(captured))
            assert all(not directory.exists() for directory in private_directories), 'retirement leaked private browser files'
            prompt(b, {'action':'snapshot'}, expected_error='Browser is not open')
            assert 'replacement-workspace' in prompt(b, {'action':'open','args':['data:text/html,<title>replacement-workspace</title>']})
            replacement=browser_tree(); assert len(replacement)==1 and not set(replacement)&set(both)
            captured += [p for group in replacement.values() for p in group]
            assert client.request('POST','/global/dispose',timeout=15)
            wait(lambda:not same_alive(captured))
            print(json.dumps({'build':json.loads(os.popen(binary+' debug build-info').read()),
                'persistentGenerationHandoff':True,'idleParked':True,'exclusiveTopicPause':True,
                'activeResumeSameDaemon':True,'pausedAbortConfirmedEmpty':True,'workspaceRetirementConfirmedEmpty':True,
                'privateProfilesRetired':True,'replacementDoesNotAdoptOldBrowser':True,'browserTrees':len(both),'capturedProcesses':len(captured),'memory':memory_observation()},indent=2),flush=True)
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
