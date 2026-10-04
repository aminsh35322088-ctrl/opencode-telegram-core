"""Unshipped boundary experiment. Only run in the disposable validation container.

HTTP crash actions require the experiment token and never select an arbitrary PID.
The heartbeat double-fork is bounded to 120s. No production supervision is added.
"""
import ctypes
import hashlib
import json
import os
from pathlib import Path
import shlex
import signal
import subprocess
import sys
import threading
import time
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TESTS = os.environ.get('BOUNDARY_TESTS', '/validation/tests')
BINARY = os.environ.get('BOUNDARY_BINARY', '/usr/local/bin/opencode')
sys.path.insert(0, TESTS)
from session_contract import Server, Client
from production_execution import Model, plugin_registry

TOKEN = os.environ['BOUNDARY_TOKEN']
WITNESS = os.environ.get('BOUNDARY_WITNESS')
BOOT = str(uuid.uuid4())
EVIDENCE = {'boot': BOOT, 'binarySha256': hashlib.sha256(Path(BINARY).read_bytes()).hexdigest(),
            'build': json.loads(subprocess.check_output([BINARY, 'debug', 'build-info'])), 'cases': {}, 'errors': []}

def emit(kind, **data):
    event = {'kind': kind, 'boot': BOOT, **data}
    print(json.dumps(event), flush=True)
    if WITNESS:
        request = urllib.request.Request(WITNESS, data=json.dumps(event).encode(),
            headers={'content-type': 'application/json', 'authorization': TOKEN})
        with urllib.request.urlopen(request, timeout=5) as response:
            assert response.status == 200

def identity(pid):
    try:
        fields = Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()
        return {'pid': pid, 'state': fields[0], 'ppid': int(fields[1]), 'group': int(fields[2]),
                'session': int(fields[3]), 'started': fields[19], 'namespace': os.readlink(f'/proc/{pid}/ns/pid')}
    except (FileNotFoundError, ProcessLookupError):
        return None

def same(current, captured):
    return current and captured and current['started'] == captured['started'] and current['pid'] == captured['pid']

def wait_for(fn, seconds=10):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        value = fn()
        if value: return value
        time.sleep(.02)
    raise AssertionError('bounded observation did not settle')

def clean(captured):
    if same(identity(captured['pid']), captured):
        try: os.kill(captured['pid'], signal.SIGKILL)
        except ProcessLookupError: pass
    # This diagnostic process is not a subreaper: reaping belongs to real tini.
    wait_for(lambda: not same(identity(captured['pid']), captured))

def environment():
    observed = {'self': identity(os.getpid()), 'init': identity(1),
        'initCmdline': Path('/proc/1/cmdline').read_bytes().replace(b'\0', b' ').decode(),
        'status': [line for line in Path('/proc/self/status').read_text().splitlines()
                   if line.startswith(('Cap', 'Seccomp', 'NoNewPrivs', 'NSpid'))],
        'cgroup': Path('/proc/self/cgroup').read_text(),
        'cgroupMounts': [line for line in Path('/proc/self/mountinfo').read_text().splitlines() if ' - cgroup' in line]}
    relative = next(line[3:] for line in observed['cgroup'].splitlines() if line.startswith('0::'))
    mount = Path('/sys/fs/cgroup').resolve()
    group = (mount / relative.lstrip('/')).resolve(); group.relative_to(mount)
    observed['cgroupAccess'] = {name: {'exists': (group / name).exists(), 'writable': os.access(group / name, os.W_OK)}
                              for name in ('cgroup.procs', 'cgroup.freeze', 'cgroup.kill')}
    directory = group / ('opencode-boundary-' + BOOT)
    try:
        directory.mkdir()
        observed['delegationMkdir'] = 'succeeded (empty fixture only; not proof of process migration)'
        directory.rmdir()
    except OSError as error:
        observed['delegationMkdir'] = {'errno': error.errno, 'type': type(error).__name__}
    # In forked helpers only. Never attempt to join a foreign namespace or escape.
    helpers = {
        'unshareUserPidMount': 'import ctypes; c=ctypes.CDLL(None,use_errno=True); r=c.unshare(0x10000000|0x20000000|0x20000); print(r,ctypes.get_errno())',
        'setnsOwnPid': 'import ctypes,os; c=ctypes.CDLL(None,use_errno=True); fd=os.open("/proc/1/ns/pid",os.O_RDONLY); r=c.setns(fd,0x20000000); print(r,ctypes.get_errno())'}
    observed['namespaceOperations'] = {key: subprocess.check_output([sys.executable, '-c', value], text=True).strip()
                                       for key, value in helpers.items()}
    return observed

provider = ThreadingHTTPServer(('127.0.0.1', 0), Model)
threading.Thread(target=provider.serve_forever, daemon=True).start()
registry = plugin_registry()
roots = []
MODE = 'shell'

def configure(root, env):
    roots.append(root)
    provider.tool = 'bash' if MODE == 'shell' else 'core_probe'
    provider.command = 'echo $$ > ' + shlex.quote(str(root / 'owned-pid')) + '; exec sleep 120'
    config = root / '.opencode'; tools = config / 'tools'; tools.mkdir(parents=True)
    if MODE == 'escape':
        # The governed launcher waits for the double-fork grandchild's ready marker.
        # The child setsid, forks again and exits; the grandchild has another group.
        child = ('import os,time,pathlib; os.setsid(); p=os.fork(); '
                 '\nif p: os._exit(0)\n'
                 f'pathlib.Path({str(root / "owned-pid")!r}).write_text(str(os.getpid())); '
                 f'pathlib.Path({str(root / "ready")!r}).write_text("ready"); time.sleep(120)')
        launcher = ('import subprocess,pathlib,time; '
                    f'p=subprocess.Popen([{sys.executable!r},"-c",{child!r}],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); '
                    f'\nwhile not pathlib.Path({str(root / "ready")!r}).exists(): time.sleep(.01)\n'
                    'p.wait(timeout=10); print("boundary-escaped-success")')
        (tools / 'core_probe.ts').write_text(
            'export default {description:"Boundary diagnostic",args:{},async execute(args,context){'
            'const r=await context.process.execFile(' + json.dumps(sys.executable) + ',["-c",' + json.dumps(launcher) + ']);return r.stdout}}')
    (config / '.npmrc').write_text(f'registry=http://127.0.0.1:{registry.server_port}/\n')
    env['NPM_CONFIG_REGISTRY'] = f'http://127.0.0.1:{registry.server_port}/'
    env['OPENCODE_CONFIG_DIR'] = str(config)
    env['OPENCODE_CONFIG_CONTENT'] = json.dumps({'model': 'fixture/fixture', 'permission': 'allow',
        'provider': {'fixture': {'npm': '@ai-sdk/openai-compatible', 'name': 'Fixture',
        'options': {'baseURL': f'http://127.0.0.1:{provider.server_port}/v1', 'apiKey': 'fixture'},
        'models': {'fixture': {'name': 'Fixture', 'limit': {'context': 32000, 'output': 2048}}}}}})

def paused_server():
    global MODE
    MODE = 'shell'
    server = Server(BINARY, readiness_path='/global/health', configure=configure).__enter__()
    try:
        client = Client(server.base); sid = client.request('POST', '/session', {})['id']
        client.request('POST', f'/session/{sid}/prompt_async', {'parts': [{'type': 'text', 'text': 'fixture'}],
                       'model': {'providerID': 'fixture', 'modelID': 'fixture'}})
        marker = roots[-1] / 'owned-pid'; wait_for(marker.exists)
        captured = identity(int(marker.read_text()))
        execution = client.request('GET', f'/session/{sid}/execution')
        owner = {key: execution[key] for key in ('runId', 'generation') if key in execution}
        paused = client.request('POST', f'/session/{sid}/pause', owner)
        assert paused['paused']
        wait_for(lambda: (identity(captured['pid']) or {}).get('state') == 'T')
        return server, captured
    except BaseException:
        server.close(); raise

LIVE = None
CAPTURED = None
HEARTBEAT = None

def cases():
    global MODE, LIVE, CAPTURED, HEARTBEAT
    try:
        EVIDENCE['environment'] = environment()
        emit('environment', observation=EVIDENCE['environment'])
        server, captured = paused_server()
        try:
            before = identity(captured['pid'])
            server.process.terminate(); server.process.wait(timeout=15)
            wait_for(lambda: not same(identity(captured['pid']), captured))
            EVIDENCE['cases']['normalTermPaused'] = {'before': before, 'after': identity(captured['pid']), 'exit': server.process.returncode}
        finally:
            clean(captured); server.close()
        server, captured = paused_server()
        try:
            before = identity(captured['pid'])
            server.process.kill(); server.process.wait(timeout=5)
            after = identity(captured['pid'])
            assert same(after, captured) and after['state'] == 'T'
            # A replacement Bun in the same container does not retire the survivor.
            with Server(BINARY, readiness_path='/global/health', configure=configure) as replacement:
                survivor = identity(captured['pid'])
                assert same(survivor, captured) and survivor['state'] == 'T'
                EVIDENCE['cases']['bunKillAndReplacement'] = {'before': before, 'after': after,
                    'replacementPID': replacement.process.pid, 'afterReplacement': survivor}
        finally:
            clean(captured); server.close()
        MODE = 'escape'
        with Server(BINARY, readiness_path='/global/health', configure=configure) as server:
            captured = None
            try:
                client = Client(server.base); sid = client.request('POST', '/session', {})['id']
                client.request('POST', f'/session/{sid}/message', {'parts': [{'type': 'text', 'text': 'fixture'}],
                    'model': {'providerID': 'fixture', 'modelID': 'fixture'}}, timeout=45)
                history = json.dumps(client.request('GET', f'/session/{sid}/message'))
                assert 'boundary-escaped-success' in history and '"status": "error"' not in history
                captured = identity(int((roots[-1] / 'owned-pid').read_text()))
                disposed = client.request('POST', '/global/dispose', timeout=15)
                after = identity(captured['pid'])
                assert same(after, captured) and after['state'] != 'Z'
                EVIDENCE['cases']['doubleForkEscape'] = {'captured': captured, 'afterDispose': after, 'disposed': disposed}
            finally:
                marker = roots[-1] / 'owned-pid'
                if captured is None and marker.exists(): captured = identity(int(marker.read_text()))
                if captured: clean(captured)
        # Retain a real physically paused compiled shell for container crash actions.
        LIVE, CAPTURED = paused_server()
        if WITNESS:
            # Independent, bounded, double-fork heartbeat survives launcher and Bun.
            child = ('import json,os,time,urllib.request; os.setsid(); p=os.fork(); '
                '\nif p: os._exit(0)\n'
                f'url={WITNESS!r}; token={TOKEN!r}; boot={BOOT!r}; end=time.monotonic()+120\n'
                'while time.monotonic()<end:\n'
                ' try:\n'
                '  data=json.dumps({"kind":"heartbeat","boot":boot,"pid":os.getpid(),"namespace":os.readlink("/proc/self/ns/pid")}).encode()\n'
                '  urllib.request.urlopen(urllib.request.Request(url,data=data,headers={"content-type":"application/json","authorization":token}),timeout=2).close()\n'
                ' except Exception: pass\n'
                ' time.sleep(.25)\n')
            launcher = subprocess.Popen([sys.executable, '-c', child], stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            launcher.wait(timeout=5)
        EVIDENCE['armed'] = {'runtime': identity(LIVE.process.pid), 'pausedShell': identity(CAPTURED['pid'])}
        emit('armed', evidence=EVIDENCE)
        EVIDENCE['ready'] = True
    except BaseException as error:
        EVIDENCE['errors'].append(repr(error))
        emit('probeError', error=repr(error))

class HTTP(BaseHTTPRequestHandler):
    def log_message(self, *_): pass
    def do_GET(self):
        raw = json.dumps(EVIDENCE).encode()
        self.send_response(200 if EVIDENCE.get('ready') else 503)
        self.end_headers(); self.wfile.write(raw)
    def do_POST(self):
        if self.headers.get('authorization') != TOKEN:
            self.send_error(403); return
        if self.path not in ('/kill-init', '/exit-wrapper', '/kill-bun') or not EVIDENCE.get('ready'):
            self.send_error(409); return
        # Refuse destructive container actions outside the known validation image.
        if self.path != '/kill-bun' and 'tini' not in EVIDENCE['environment']['initCmdline']:
            self.send_error(409); return
        emit('action', action=self.path, pausedShell=identity(CAPTURED['pid']))
        self.send_response(200); self.end_headers(); self.wfile.write(b'{}'); self.wfile.flush()
        if self.path == '/kill-init': os.kill(1, signal.SIGKILL)
        elif self.path == '/exit-wrapper': os._exit(73)
        else:
            LIVE.process.kill(); LIVE.process.wait(timeout=5)
            EVIDENCE['afterKillBun'] = identity(CAPTURED['pid'])
            emit('afterKillBun', pausedShell=EVIDENCE['afterKillBun'])

if __name__ == '__main__':
    threading.Thread(target=cases, daemon=True).start()
    ThreadingHTTPServer(('0.0.0.0', int(os.environ.get('PORT', '3000'))), HTTP).serve_forever()
