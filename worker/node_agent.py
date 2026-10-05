"""Request-driven, authenticated boundary around the localhost-only compiled Core."""
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import subprocess
import shutil
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import quote, urlsplit, unquote
from urllib.request import Request, urlopen

MAX_BODY = 10 * 1024 * 1024


class BoundedHTTPServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, *args, **kwargs):
        self.admission = threading.BoundedSemaphore(8)
        super().__init__(*args, **kwargs)

    def process_request(self, request, address):
        if not self.admission.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, address)
        except BaseException:
            self.admission.release()
            raise

    def process_request_thread(self, request, address):
        try:
            super().process_request_thread(request, address)
        finally:
            self.admission.release()


def canonical(value):
    # Match ECMAScript JSON number spelling used by the control plane.
    import math
    from decimal import Decimal
    def encode(item):
        if isinstance(item, dict):
            if any(not isinstance(key, str) for key in item):
                raise ValueError('canonical keys must be strings')
            keys = sorted(item, key=lambda key: key.encode('utf-16-be'))
            return '{' + ','.join(encode(key) + ':' + encode(item[key]) for key in keys) + '}'
        if isinstance(item, list):
            return '[' + ','.join(encode(element) for element in item) + ']'
        if isinstance(item, float):
            if not math.isfinite(item):
                raise ValueError('nonfinite canonical number')
            if item == 0:
                return '0'
            raw = repr(item)
            if 1e-6 <= abs(item) < 1e21:
                fixed = format(Decimal(raw), 'f')
                return fixed.rstrip('0').rstrip('.') if '.' in fixed else fixed
            if 'e' in raw:
                mantissa, exponent = raw.split('e')
                mantissa = mantissa.removesuffix('.0')
                power = int(exponent)
                return mantissa + 'e' + ('+' if power >= 0 else '-') + str(abs(power))
            return raw.removesuffix('.0')
        return json.dumps(item, separators=(',', ':'), ensure_ascii=False, allow_nan=False)
    return encode(value).encode('utf-8')


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def atomic(path, data):
    temporary = path.with_name(path.name + '.tmp')
    if temporary.exists() or temporary.is_symlink():
        temporary.unlink()
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    fd = os.open(path.parent, os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def child_environment(source):
    # Allowlist rather than guessing every credential variable's name.
    allowed = {'PATH', 'LANG', 'LC_ALL', 'TZ', 'SSL_CERT_FILE', 'SSL_CERT_DIR'}
    result = {key: source[key] for key in allowed if key in source}
    result.update(HOME='/data/runtime/home', XDG_DATA_HOME='/data/topic/home/.local/share',
                  XDG_CONFIG_HOME='/data/runtime', XDG_STATE_HOME='/data/topic/home/.local/state',
                  XDG_CACHE_HOME='/tmp/core-cache', BUN_INSTALL_CACHE_DIR='/tmp/bun-cache', npm_config_cache='/tmp/npm-cache',
                  TMPDIR='/tmp', PLAYWRIGHT_BROWSERS_PATH='/tmp/playwright-cache', OPENCODE_TELEGRAM_PROCESS_BUDGET='1',
                  OPENCODE_DISABLE_MODELS_FETCH='1', OPENCODE_DISABLE_AUTOUPDATE='1',
                  OPENCODE_DISABLE_PROJECT_CONFIG='1', OPENCODE_CONFIG_DIR='/data/runtime/opencode')
    return result


class Boundary:
    def __init__(self, root, secret, identity):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.secret = secret.encode()
        if len(self.secret) < 32:
            raise ValueError('node secret must contain at least 32 bytes')
        self.identity = identity
        self.lock = threading.RLock()
        self.db = sqlite3.connect(self.root / 'agent.sqlite', check_same_thread=False)
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('PRAGMA synchronous=FULL')
        self.db.execute('CREATE TABLE IF NOT EXISTS replay (nonce TEXT PRIMARY KEY, expires REAL NOT NULL)')
        self.db.execute('CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
        persisted = self.get('identity')
        if persisted is not None and persisted != identity:
            raise ValueError('persisted node identity mismatch; retire before replacing volume')
        self.set('identity', identity)
        self.snapshot = self.restore()

    def get(self, key):
        row = self.db.execute('SELECT value FROM state WHERE key=?', (key,)).fetchone()
        return json.loads(row[0]) if row else None

    def set(self, key, value):
        with self.db:
            self.db.execute('INSERT OR REPLACE INTO state VALUES (?,?)', (key, json.dumps(value)))

    def envelope(self, operation, payload, session=None):
        value = dict(version=1, **self.identity, operation=operation, payload=payload,
                     timestamp=int(time.time() * 1000), nonce=secrets.token_hex(24))
        if session is not None:
            value['sessionId'] = session
        return value

    def signature(self, raw):
        return hmac.new(self.secret, raw, hashlib.sha256).hexdigest()

    def authenticate(self, raw, signature, now=None):
        if len(raw) > MAX_BODY or not re.fullmatch('[0-9a-f]{64}', signature or ''):
            raise ValueError('authentication failed')
        if not hmac.compare_digest(self.signature(raw), signature):
            raise ValueError('authentication failed')
        value = json.loads(raw)
        if not isinstance(value, dict) or value.get('version') != 1 or 'payload' not in value:
            raise ValueError('invalid envelope')
        if any(value.get(key) != expected or type(value.get(key)) != type(expected) for key, expected in self.identity.items()):
            raise ValueError('stale or foreign identity')
        if not isinstance(value.get('operation'), str) or not isinstance(value.get('nonce'), str) or not 16 <= len(value['nonce']) <= 128:
            raise ValueError('invalid envelope')
        now = time.time() if now is None else now
        timestamp = value.get('timestamp')
        if type(timestamp) is not int or abs(timestamp / 1000 - now) > 60:
            raise ValueError('expired envelope')
        with self.lock, self.db:
            self.db.execute('DELETE FROM replay WHERE expires < ?', (now,))
            if self.db.execute('SELECT count(*) FROM replay').fetchone()[0] >= 4096:
                raise ValueError('replay ledger full')
            self.db.execute('INSERT INTO replay VALUES (?,?)', (value['nonce'], now + 120))
        return value

    def verify_snapshot(self, value):
        required = {'version', 'revision', 'hash', 'configuration', 'skills', 'actions', 'catalog', 'defaults', 'credentialReferences'}
        if not isinstance(value, dict) or not required.issubset(value) or value['version'] != 1:
            raise ValueError('invalid snapshot')
        if type(value['revision']) is not int or value['revision'] < 0 or not isinstance(value['configuration'], dict) or not isinstance(value['defaults'], dict):
            raise ValueError('invalid snapshot')
        if any(not isinstance(value[key], list) for key in ('skills', 'actions', 'credentialReferences')):
            raise ValueError('invalid snapshot')
        raw = canonical(value)
        if len(raw) > MAX_BODY or value['hash'] != digest({key: item for key, item in value.items() if key != 'hash'}):
            raise ValueError('snapshot hash mismatch')
        names = set()
        for skill in value['skills']:
            if not isinstance(skill, dict) or not re.fullmatch('[A-Za-z0-9_-]{1,100}', skill.get('name', '')) or not isinstance(skill.get('content'), str):
                raise ValueError('invalid skill')
            if skill['name'] in names or hashlib.sha256(skill['content'].encode()).hexdigest() != skill.get('hash'):
                raise ValueError('skill hash mismatch')
            names.add(skill['name'])
        return raw

    def restore(self):
        current = self.root / 'active.json'
        if not current.exists():
            return None
        for candidate in (current, self.root / 'previous.json'):
            try:
                marker = json.loads(candidate.read_bytes())
                if not re.fullmatch(r'[0-9]+-[0-9a-f]{64}', marker['directory']):
                    raise ValueError('invalid snapshot marker')
                value = json.loads((self.root / 'versions' / marker['directory'] / 'snapshot.json').read_bytes())
                self.verify_snapshot(value)
                if value['hash'] != marker['hash']:
                    raise ValueError('active snapshot corrupt')
                if candidate != current:
                    atomic(current, canonical(marker))
                return value
            except (OSError, ValueError, KeyError, TypeError):
                continue
        raise ValueError('no valid persisted snapshot')

    def apply(self, value):
        raw = self.verify_snapshot(value)
        with self.lock:
            previous = self.snapshot
            highest = self.get('snapshotHighwater')
            if highest and (value['revision'] < highest['revision'] or (value['revision'] == highest['revision'] and value['hash'] != highest['hash'])):
                raise ValueError('snapshot highwater conflict')
            if previous and (value['revision'] < previous['revision'] or (value['revision'] == previous['revision'] and value['hash'] != previous['hash'])):
                raise ValueError('snapshot revision conflict')
            versions = self.root / 'versions'
            versions.mkdir(exist_ok=True)
            name = str(value['revision']) + '-' + value['hash']
            directory = versions / name
            if not directory.exists():
                directory.mkdir()
                atomic(directory / 'snapshot.json', raw)
                atomic(directory / 'opencode.json', canonical(value['configuration'].get('runtime', {})))
                for skill in value['skills']:
                    target = directory / 'skills' / skill['name']
                    target.mkdir(parents=True)
                    atomic(target / 'SKILL.md', skill['content'].encode())
            else:
                stored = json.loads((directory / 'snapshot.json').read_bytes())
                if self.verify_snapshot(stored) != raw:
                    raise ValueError('immutable snapshot conflict')
            current = self.root / 'active.json'
            if current.exists() and previous and previous['hash'] != value['hash']:
                atomic(self.root / 'previous.json', current.read_bytes())
            atomic(current, canonical(dict(directory=name, hash=value['hash'])))
            self.set('snapshotHighwater', {'revision': value['revision'], 'hash': value['hash']})
            self.snapshot = value
            # Disposable immutable cache retains current and rollback only. Durable
            # sessions remain outside this root-owned artifact directory.
            retained = {name}
            rollback = self.root / 'previous.json'
            if rollback.exists():
                retained.add(json.loads(rollback.read_bytes())['directory'])
            for cached in versions.iterdir():
                if cached.name not in retained and cached.is_dir() and not cached.is_symlink():
                    shutil.rmtree(cached)
            return directory


class Agent:
    def __init__(self, boundary, control_plane, binary='/usr/local/bin/opencode', core_port=4096):
        endpoint = urlsplit(control_plane)
        if endpoint.scheme != 'https' or not endpoint.hostname or endpoint.username or endpoint.password or endpoint.query or endpoint.fragment:
            raise ValueError('control plane requires HTTPS')
        self.boundary = boundary
        self.endpoint = control_plane.rstrip('/') + '/node-control'
        self.binary = binary
        self.core_port = core_port
        self.process = None
        self.ready = False
        self.lock = threading.RLock()
        self.workspace = boundary.root / 'topic'
        self.workspace.mkdir(exist_ok=True)
        self.retired = boundary.get('retired') is True
        from provider_proxy import ProviderProxy
        self.proxy = ProviderProxy(self)
        from control_bridge import ControlBridge
        self.bridge = ControlBridge(self)

    def outbound(self, operation, payload, session=None):
        raw = canonical(self.boundary.envelope(operation, payload, session))
        request = Request(self.endpoint, data=raw, headers={'Content-Type': 'application/json', 'x-node-signature': self.boundary.signature(raw)}, method='POST')
        # Never follow redirects with the node signature or secret-bearing response.
        import urllib.request
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *args):
                return None
        with urllib.request.build_opener(NoRedirect).open(request, timeout=30) as response:
            reply = response.read(MAX_BODY + 1)
            signed = self.boundary.authenticate(reply, response.headers.get('x-node-signature'))
            if signed['operation'] != operation or signed.get('sessionId') != session:
                raise ValueError('foreign control reply')
            return signed['payload']

    def bootstrap(self):
        if self.retired:
            return
        try:
            self.boundary.apply(self.outbound('snapshot.get', {}))
        except (OSError, TimeoutError):
            if self.boundary.snapshot is None:
                return
        self.start_core()

    def start_core(self):
        snapshot = self.boundary.snapshot
        if snapshot is None:
            raise ValueError('snapshot unavailable')
        # Core sees only config/skills, not the agent ledger or shared secret.
        home = self.workspace / 'home'
        for location in (home, home / '.config', home / '.config' / 'opencode'):
            if location.is_symlink():
                raise ValueError('runtime configuration directories cannot be symlinks')
        home.mkdir(exist_ok=True)
        runtime_root = self.boundary.root.parent / 'runtime'
        if runtime_root.is_symlink():
            raise ValueError('canonical runtime root cannot be symlink')
        runtime_root.mkdir(exist_ok=True)
        (runtime_root / 'home').mkdir(exist_ok=True)
        config = runtime_root / 'opencode'
        if config.is_symlink():
            raise ValueError('canonical config cannot be symlink')
        config.mkdir(parents=True, exist_ok=True)
        import shutil
        ephemeral = Path('/tmp/core-runtime')
        if ephemeral.is_symlink():
            raise ValueError('ephemeral runtime root cannot be symlink')
        ephemeral.mkdir(exist_ok=True)
        modules = ephemeral / 'node_modules'
        if modules.is_symlink():
            raise ValueError('ephemeral modules cannot be symlink')
        modules.mkdir(exist_ok=True)
        os.chown(modules, 1000, 1000)
        configured_modules = config / 'node_modules'
        if configured_modules.is_symlink():
            configured_modules.unlink()
        elif configured_modules.exists():
            shutil.rmtree(configured_modules)
        configured_modules.symlink_to(modules)
        runtime_config = snapshot['configuration'].get('runtime')
        if not isinstance(runtime_config, dict):
            raise ValueError('snapshot missing verified runtime configuration projection')
        runtime_config = self.proxy.rewrite(runtime_config, snapshot['credentialReferences'])
        self.proxy.start()
        self.bridge.start()
        tools = config / 'tools'
        if tools.is_symlink():
            raise ValueError('runtime tool directory cannot be symlink')
        tools.mkdir(exist_ok=True)
        atomic(tools / 'bot.ts', self.bridge.tool_source().encode())
        atomic(config / 'opencode.json', canonical(runtime_config))
        atomic(runtime_root / 'global-snapshot.json', canonical(snapshot))
        skills = config / 'skills'
        if skills.is_symlink():
            skills.unlink()
        elif skills.exists():
            shutil.rmtree(skills)
        skills.mkdir()
        for skill in snapshot['skills']:
            target = skills / skill['name']
            target.mkdir()
            atomic(target / 'SKILL.md', skill['content'].encode())
        atomic(config / '.gitignore', b'node_modules\npackage.json\nbun.lock\n')
        if os.getuid() == 0:
            for base, dirs, files in os.walk(runtime_root):
                os.chown(base, 0, 0, follow_symlinks=False)
                os.chmod(base, 0o755)
                for name in files:
                    location = Path(base) / name
                    if location.is_symlink():
                        raise ValueError('canonical runtime file cannot be symlink')
                    os.chown(location, 0, 0, follow_symlinks=False)
                    os.chmod(location, 0o644)
            for base, dirs, files in os.walk(self.workspace):
                os.chown(base, 1000, 1000, follow_symlinks=False)
                for name in files:
                    os.chown(Path(base) / name, 1000, 1000, follow_symlinks=False)
            def demote():
                os.setgroups([])
                os.setgid(1000)
                os.setuid(1000)
        else:
            raise RuntimeError('production agent requires root to demote Core')
        self.process = subprocess.Popen([self.binary, 'serve', '--hostname', '127.0.0.1', '--port', str(self.core_port)], cwd=self.workspace,
                                       env=child_environment(os.environ), preexec_fn=demote, start_new_session=True)
        # Bounded startup checks only; no background polling or idle traffic.
        for _ in range(100):
            if self.process.poll() is not None:
                raise RuntimeError('Core exited during startup')
            try:
                self.local('GET', '/global/health')
                self.ready = True
                return
            except Exception:
                time.sleep(.1)
        self.stop_core()
        raise RuntimeError('Core startup timeout')

    def stop_core(self):
        self.ready = False
        if self.process and self.process.poll() is None:
            try:
                self.local('POST', '/global/dispose', {}, timeout=10)
            except Exception:
                pass
            import signal
            os.killpg(self.process.pid, signal.SIGTERM)
            try:
                self.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(self.process.pid, signal.SIGKILL)
                self.process.wait(timeout=5)
        self.process = None

    def local(self, method, route, payload=None, timeout=30):
        request = Request('http://127.0.0.1:' + str(self.core_port) + route,
                          data=None if payload is None else canonical(payload), method=method,
                          headers={'Content-Type': 'application/json', 'x-opencode-directory': str(self.workspace)})
        with urlopen(request, timeout=timeout) as response:
            raw = response.read(MAX_BODY + 1)
            if len(raw) > MAX_BODY:
                raise ValueError('Core response exceeds limit')
            return json.loads(raw) if raw else None


    def refresh_snapshot(self):
        # Transport outage may use prior valid state; integrity errors fail closed.
        try:
            latest = self.outbound('snapshot.get', {})
        except (OSError, TimeoutError):
            if self.boundary.snapshot is None:
                raise ValueError('snapshot unavailable')
            return
        self.boundary.verify_snapshot(latest)
        current = self.boundary.snapshot
        if current and latest['hash'] == current['hash']:
            return
        self.boundary.apply(latest)
        self.stop_core()
        try:
            self.start_core()
        except Exception:
            if current:
                marker = dict(directory=str(current['revision']) + '-' + current['hash'], hash=current['hash'])
                atomic(self.boundary.root / 'active.json', canonical(marker))
                self.boundary.snapshot = current
                self.start_core()
            raise

    def dispatch(self, value):
        operation, payload = value['operation'], value['payload']
        if not isinstance(payload, dict):
            raise ValueError('payload must be object')
        with self.lock:
            if operation == 'health':
                return {'ready': self.ready and not self.retired}
            if self.retired:
                raise ValueError('node retired')
            if operation == 'retire':
                self.boundary.set('retired', True)
                self.retired = True
                self.stop_core()
                return {'retired': True}
            if operation == 'sync-global':
                session = self.boundary.get('session')
                if session:
                    execution = self.local('GET', '/session/' + quote(session, safe='') + '/execution')
                    if execution and execution.get('continuation') == 'live':
                        raise ValueError('cannot sync during active execution')
                snapshot = self.outbound('snapshot.get', {})
                previous = self.boundary.snapshot
                self.boundary.apply(snapshot)
                self.stop_core()
                try:
                    self.start_core()
                except Exception:
                    if previous:
                        marker = dict(directory=str(previous['revision']) + '-' + previous['hash'], hash=previous['hash'])
                        atomic(self.boundary.root / 'active.json', canonical(marker))
                        self.boundary.snapshot = previous
                        self.start_core()
                    raise
                return {'revision': snapshot['revision'], 'hash': snapshot['hash']}
            if not self.ready or not self.process or self.process.poll() is not None:
                raise ValueError('node not ready')
            session = self.boundary.get('session')
            if operation == 'session.create':
                if session:
                    return {'sessionId': session}
                result = self.local('POST', '/session', {})
                session = result['id']
                self.boundary.set('session', session)
                return {'sessionId': session}
            if not session or value.get('sessionId') != session:
                raise ValueError('foreign session')
            encoded = quote(session, safe='')
            run_id = self.boundary.get('runId')
            if operation == 'session.get':
                return self.local('GET', '/session/' + encoded)
            if operation == 'session.delete':
                execution = self.local('GET', '/session/' + encoded + '/execution')
                if execution:
                    raise ValueError('stop execution before deleting session')
                result = self.local('DELETE', '/session/' + encoded)
                self.boundary.set('session', None)
                self.boundary.set('runId', None)
                self.boundary.set('nativeRunId', None)
                return result
            if operation == 'run.prepare':
                run_id = payload.get('runId')
                if set(payload) != {'runId'} or not isinstance(run_id, str) or not re.fullmatch('[A-Za-z0-9_-]{1,128}', run_id):
                    raise ValueError('invalid prepared run')
                if self.local('GET', '/session/' + encoded + '/execution'):
                    raise ValueError('execution already active')
                self.refresh_snapshot()
                self.boundary.set('runId', run_id)
                self.boundary.set('runMode', 'native')
                self.boundary.set('nativeRunId', None)
                self.boundary.set('runPrepared', {'runId': run_id, 'expiresAt': time.time() + 30})
                return {'prepared': True, 'runId': run_id}
            if operation == 'session.status':
                statuses = self.local('GET', '/session/status')
                return {session: statuses[session]} if session in statuses else {}
            if operation == 'run':
                if set(payload) - {'runId', 'text', 'parts', 'model', 'variant', 'agent'}:
                    raise ValueError('unsupported prompt options')
                parts = payload.get('parts')
                if parts is None:
                    if not isinstance(payload.get('text'), str) or not payload['text']:
                        raise ValueError('text or parts required')
                    parts = [{'type': 'text', 'text': payload['text']}]
                if not isinstance(parts, list) or not 1 <= len(parts) <= 128:
                    raise ValueError('invalid parts')
                for part in parts:
                    if not isinstance(part, dict) or part.get('type') not in ('text', 'file'):
                        raise ValueError('unsupported part')
                    if part['type'] == 'text' and (not isinstance(part.get('text'), str) or set(part) - {'type', 'text'}):
                        raise ValueError('invalid text part')
                    if part['type'] == 'file':
                        if set(part) - {'type', 'mime', 'filename', 'url'} or not isinstance(part.get('mime'), str) or not isinstance(part.get('url'), str):
                            raise ValueError('invalid file part')
                        uri = urlsplit(part['url'])
                        if uri.scheme not in ('data', 'file'):
                            raise ValueError('files require inline data or owned workspace file')
                        if uri.scheme == 'file' and (uri.netloc or not Path(unquote(uri.path)).resolve().is_relative_to(self.workspace.resolve())):
                            raise ValueError('foreign file path')
                model = payload.get('model')
                if model is not None and (not isinstance(model, dict) or set(model) != {'providerID', 'modelID'} or any(not isinstance(model[key], str) or not model[key] for key in model)):
                    raise ValueError('invalid model selection')
                for key in ('variant', 'agent'):
                    if key in payload and (not isinstance(payload[key], str) or len(payload[key]) > 128):
                        raise ValueError('invalid prompt option')
                run_id = payload.get('runId')
                if not isinstance(run_id, str) or not re.fullmatch('[A-Za-z0-9_-]{1,128}', run_id):
                    raise ValueError('runId required')
                execution = self.local('GET', '/session/' + encoded + '/execution')
                if execution:
                    raise ValueError('execution already active or continuation unavailable')
                prepared = self.boundary.get('runPrepared')
                if prepared and (prepared['runId'] != run_id or prepared['expiresAt'] < time.time()):
                    raise ValueError('foreign or expired prepared run')
                if not prepared:
                    self.refresh_snapshot()
                self.boundary.set('runPrepared', None)
                self.boundary.set('runId', run_id)
                self.boundary.set('nativeRunId', None)
                self.boundary.set('runMode', 'native')
                body = {'parts': parts}
                for key in ('model', 'variant', 'agent'):
                    if key in payload:
                        body[key] = payload[key]
                self.local('POST', '/session/' + encoded + '/prompt_async', body)
                return {'accepted': True, 'runId': run_id}
            if operation in ('pause', 'resume'):
                if payload.get('runId') != run_id:
                    raise ValueError('foreign run')
                execution = self.local('GET', '/session/' + encoded + '/execution')
                if not execution or execution.get('continuation') != 'live':
                    raise ValueError('live execution unavailable')
                native_id = self.boundary.get('nativeRunId')
                if native_id is None:
                    native_id = execution['runId']
                    self.boundary.set('nativeRunId', native_id)
                if native_id != execution['runId']:
                    raise ValueError('foreign native execution')
                return self.local('POST', '/session/' + encoded + '/' + operation, {'runId': native_id})
            if operation == 'stop':
                if payload.get('runId') != run_id:
                    raise ValueError('foreign run')
                execution = self.local('GET', '/session/' + encoded + '/execution')
                if not execution:
                    self.boundary.set('runPrepared', None)
                    self.boundary.set('runId', None)
                    return None
                native_id = self.boundary.get('nativeRunId')
                if native_id is not None and execution['runId'] != native_id:
                    raise ValueError('foreign native execution')
                return self.local('POST', '/session/' + encoded + '/abort', {'runId': execution['runId']})
            if operation == 'status':
                execution = self.local('GET', '/session/' + encoded + '/execution')
                return {**execution, 'externalRunId': run_id} if execution else None
            if operation in ('question.list', 'question.reply'):
                questions = self.local('GET', '/question')
                owned = [question for question in questions if question.get('sessionID') == session]
                if operation == 'question.list':
                    return owned
                if payload.get('runId') != run_id:
                    raise ValueError('foreign run')
                request_id = payload.get('requestId')
                matches = [question for question in owned if question.get('id') == request_id]
                answers = payload.get('answers')
                if len(matches) != 1 or not isinstance(answers, list) or len(answers) != len(matches[0]['questions']) or any(not isinstance(answer, list) or any(not isinstance(label, str) or len(label) > 10000 for label in answer) for answer in answers):
                    raise ValueError('foreign question or invalid answers')
                return self.local('POST', '/question/' + quote(request_id, safe='') + '/reply', {'answers': answers})
            if operation == 'session.messages':
                return self.local('GET', '/session/' + encoded + '/message')
            if operation == 'session.query':
                after = payload.get('after', 0)
                if type(after) is not int or after < 0:
                    raise ValueError('invalid cursor')
                if after != 0:
                    raise ValueError('native message history has no durable cursor')
                return self.local('GET', '/session/' + encoded + '/message')
            raise ValueError('unsupported operation')


    def events(self, value):
        """Only an explicitly requested live-run stream; never reconnects or polls."""
        payload = value['payload']
        if not isinstance(payload, dict):
            raise ValueError('invalid stream payload')
        session = self.boundary.get('session')
        run_id = self.boundary.get('runId')
        if self.retired or not self.ready or value.get('sessionId') != session or payload.get('runId') != run_id:
            raise ValueError('foreign stream')
        after = payload.get('after', 0)
        if type(after) is not int or after < 0:
            raise ValueError('invalid cursor')
        encoded = quote(session, safe='')
        execution = self.local('GET', '/session/' + encoded + '/execution')
        prepared = self.boundary.get('runPrepared')
        valid_prepared = prepared and prepared['runId'] == run_id and prepared['expiresAt'] >= time.time()
        if (not execution or execution.get('continuation') != 'live') and not valid_prepared:
            raise ValueError('execution not live or prepared')
        native = self.boundary.get('runMode') == 'native'
        if native and after != 0:
            raise ValueError('native live events cannot replay; use session.messages')
        route = '/event' if native else '/api/session/' + encoded + '/event?after=' + str(after)
        request = Request('http://127.0.0.1:' + str(self.core_port) + route,
                          headers={'Accept': 'text/event-stream', 'x-opencode-directory': str(self.workspace)})
        response = urlopen(request, timeout=15)
        return response, session, run_id, after

    def stream_frames(self, stream, session, run_id, cursor):
        lines = []
        size = 0
        for raw_line in stream:
            if self.retired or not self.ready or self.boundary.get('runId') != run_id or self.boundary.get('session') != session:
                return
            prepared = self.boundary.get('runPrepared')
            if prepared and prepared['expiresAt'] < time.time():
                return
            size += len(raw_line)
            if size > MAX_BODY:
                raise ValueError('event exceeds bound')
            line = raw_line.decode('utf-8').rstrip('\r\n')
            if line.startswith('data:'):
                lines.append(line[5:].lstrip())
            if line:
                continue
            size = 0
            if not lines:
                continue
            event = json.loads('\n'.join(lines))
            lines = []
            if self.boundary.get('runMode') == 'native':
                props = event.get('properties', {})
                owner = props.get('sessionID') or props.get('info', {}).get('sessionID') or props.get('part', {}).get('sessionID')
                if owner != session:
                    continue
                cursor += 1
            else:
                durable = event.get('durable', {})
                seq = durable.get('seq')
                if durable.get('aggregateID') != session or type(seq) is not int or seq <= cursor:
                    raise ValueError('foreign or unordered event')
                cursor = seq
            envelope = self.boundary.envelope('session.event', {'runId': run_id, 'event': event}, session)
            raw = canonical(envelope)
            yield canonical({'envelope': envelope, 'body': raw.decode('utf-8'), 'signature': self.boundary.signature(raw)})
            properties = event.get('properties', {})
            if event.get('type') in ('session.idle', 'session.error') or (event.get('type') == 'session.status' and properties.get('status', {}).get('type') == 'idle'):
                return


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def respond(self, code, payload, signed=False):
        raw = canonical(payload)
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Connection', 'close')
        if signed:
            self.send_header('x-node-signature', self.server.agent.boundary.signature(raw))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        agent = self.server.agent
        ready = agent.ready and not agent.retired and agent.process is not None and agent.process.poll() is None
        self.respond(200 if ready else 503, {'ready': ready}) if self.path == '/health' else self.respond(404, {'error': 'not found'})

    def do_POST(self):
        if self.path != '/rpc':
            return self.respond(404, {'error': 'not found'})
        try:
            self.connection.settimeout(15)
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= MAX_BODY or self.headers.get('Transfer-Encoding'):
                raise ValueError('invalid length')
            raw = self.rfile.read(length)
            if len(raw) != length:
                raise ValueError('truncated body')
            boundary = self.server.agent.boundary
            value = boundary.authenticate(raw, self.headers.get('x-node-signature'))
        except Exception:
            return self.respond(401, {'error': 'request rejected'})
        try:
            if value['operation'] == 'session.events':
                stream, session, run_id, cursor = self.server.agent.events(value)
                self.send_response(200)
                self.send_header('Content-Type', 'text/event-stream')
                self.send_header('x-node-stream-ready', boundary.signature(raw + b'\nstream-ready'))
                self.send_header('Cache-Control', 'no-store')
                self.send_header('Connection', 'close')
                self.end_headers()
                try:
                    with stream:
                        for frame in self.server.agent.stream_frames(stream, session, run_id, cursor):
                            self.wfile.write(b'data: ' + frame + b'\n\n')
                            self.wfile.flush()
                except Exception:
                    pass
                return
            result = self.server.agent.dispatch(value)
            response = boundary.envelope(value['operation'], {'ok': True, 'result': result}, value.get('sessionId'))
            self.respond(200, response, True)
        except Exception:
            self.respond(409, boundary.envelope(value['operation'], {'ok': False, 'error': 'operation rejected'}, value.get('sessionId')), True)


def main():
    # Capture secret before spawning unprivileged Core. Never log configuration.
    secret = os.environ.pop('NODE_SHARED_SECRET')
    identity = dict(nodeId=os.environ['NODE_ID'], generation=int(os.environ['NODE_GENERATION']),
                    chatId=int(os.environ['NODE_CHAT_ID']), threadId=int(os.environ['NODE_THREAD_ID']))
    if identity['generation'] < 1:
        raise ValueError('generation must be positive')
    root = Path('/data')
    root.mkdir(exist_ok=True)
    if root.is_symlink():
        raise ValueError('data root cannot be symlink')
    os.chown(root, 0, 0)
    os.chmod(root, 0o755)
    if (root / 'agent').is_symlink() or (root / 'topic').is_symlink():
        raise ValueError('persistent root paths cannot be symlinks')
    boundary = Boundary(root / 'agent', secret, identity)
    os.chmod(boundary.root, 0o700)
    agent = Agent(boundary, os.environ['CONTROL_PLANE_URL'])
    # topic is separate from root-only ledger; immutable snapshots must be readable.
    agent.workspace = root / 'topic'
    agent.workspace.mkdir(exist_ok=True)
    server = BoundedHTTPServer(('0.0.0.0', int(os.environ.get('PORT', '3000'))), Handler)
    server.agent = agent
    threading.Thread(target=agent.bootstrap, daemon=True).start()
    try:
        server.serve_forever()
    finally:
        agent.stop_core()


if __name__ == '__main__':
    main()
