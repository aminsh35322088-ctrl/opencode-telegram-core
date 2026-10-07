"""Request-driven, authenticated boundary around the localhost-only compiled Core."""
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import stat
import sqlite3
import subprocess
import shutil
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import quote, urlsplit, unquote
from urllib.request import Request, urlopen

MAX_BODY = 10 * 1024 * 1024
MAX_SNAPSHOT_DISK = 32 * 1024 * 1024
SNAPSHOT_DISK_RESERVE = 16 * 1024 * 1024
MAX_SAFE_INTEGER = 9007199254740991
BROWSER_TOOL_SOURCE = Path(__file__).parent / "runtime_tools" / "browser.ts"


def runtime_identity(filename=Path('/usr/local/share/core-build-info.json')):
    # Image-owned compiled build metadata; never trust a Worker environment override.
    metadata = json.loads(Path(filename).read_text())
    fields = {key: metadata.get(key) for key in ('telegramCoreCommit', 'telegramCoreVersion', 'runtimeProfile')}
    if not isinstance(fields['telegramCoreCommit'], str) or not re.fullmatch('[a-f0-9]{40}', fields['telegramCoreCommit']) or not isinstance(fields['telegramCoreVersion'], str) or not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+-bot\.[0-9]+-pre\.[0-9]+', fields['telegramCoreVersion']) or fields['runtimeProfile'] != 'telegram-headless':
        raise ValueError('invalid immutable runtime metadata')
    return fields


def validate_identity(identity):
    if not isinstance(identity, dict) or set(identity) != {'nodeId', 'generation', 'chatId', 'threadId'}:
        raise ValueError('invalid node identity')
    if not isinstance(identity['nodeId'], str) or not re.fullmatch('[A-Za-z0-9_-]{1,128}', identity['nodeId']):
        raise ValueError('invalid node identity')
    if any(type(identity[key]) is not int or abs(identity[key]) > MAX_SAFE_INTEGER for key in ('generation', 'chatId', 'threadId')) or identity['generation'] < 1:
        raise ValueError('invalid node identity')
    if (identity['chatId'], identity['threadId']) != (0, 0) and (identity['chatId'] == 0 or identity['threadId'] <= 1):
        raise ValueError('invalid topic identity')


def validate_worker_environment(source):
    # Check names only: privileged provisioning credentials must never enter a Worker.
    if any(name in source for name in ('RAILWAY_API_TOKEN', 'RAILWAY_TOKEN', 'RAILWAY_PROJECT_TOKEN')):
        raise ValueError('privileged Railway provisioning credential present')


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
            # Bound the header read too, before allocating a handler thread.
            request.settimeout(15)
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


def materialize_browser_tool(tools):
    # Source belongs to the immutable image, never a Topic snapshot/workspace.
    try:
        fd = os.open(BROWSER_TOOL_SOURCE, os.O_RDONLY | os.O_NOFOLLOW)
    except OSError as error:
        raise ValueError('browser adapter source unavailable or unsafe') from error
    try:
        source = os.fstat(fd)
        if not stat.S_ISREG(source.st_mode) or source.st_uid != 0 or source.st_mode & 0o022 or source.st_size > 65536:
            raise ValueError('browser adapter source must be immutable root-owned image code')
        with os.fdopen(fd, 'rb', closefd=False) as stream:
            data = stream.read(65537)
        if len(data) > 65536:
            raise ValueError('browser adapter source exceeds bound')
    finally:
        os.close(fd)
    atomic(tools / 'browser.ts', data)


def child_environment(source):
    # Allowlist rather than guessing every credential variable's name.
    allowed = {'PATH', 'LANG', 'LC_ALL', 'TZ', 'SSL_CERT_FILE', 'SSL_CERT_DIR'}
    result = {key: source[key] for key in allowed if key in source}
    result.update(HOME='/data/runtime/home', XDG_DATA_HOME='/data/topic/home/.local/share',
                  XDG_CONFIG_HOME='/data/runtime', XDG_STATE_HOME='/data/topic/home/.local/state',
                  XDG_CACHE_HOME='/tmp/core-cache', BUN_INSTALL_CACHE_DIR='/tmp/bun-cache', npm_config_cache='/tmp/npm-cache',
                  PIP_CACHE_DIR='/tmp/pip-cache', PYTHONUSERBASE='/tmp/python-user',
                  TMPDIR='/tmp', PLAYWRIGHT_BROWSERS_PATH='/opt/ms-playwright', OPENCODE_TELEGRAM_PROCESS_BUDGET='1',
                  OPENCODE_DISABLE_MODELS_FETCH='1', OPENCODE_DISABLE_AUTOUPDATE='1',
                  OPENCODE_DISABLE_PROJECT_CONFIG='1', OPENCODE_CONFIG_DIR='/data/runtime/opencode')
    return result


class Boundary:
    def __init__(self, root, secret, identity):
        validate_identity(identity)
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
        fingerprint = hashlib.sha256(self.secret).hexdigest()
        if persisted is not None and persisted != identity:
            # Serialized volume deployment is required. CP must fence the old writer
            # before rotating env/secret; this ledger cannot fence another container.
            allowed = (persisted.get('chatId') == 0 and persisted.get('threadId') == 0
                       and identity['chatId'] != 0 and identity['threadId'] > 1
                       and persisted.get('nodeId') == identity['nodeId']
                       and identity['generation'] == persisted.get('generation', 0) + 1
                       and self.get('secretFingerprint') is not None
                       and self.get('secretFingerprint') != fingerprint
                       and self.get('retired') is True)
            metadata = {'identity', 'secretFingerprint', 'snapshotHighwater', 'activatedSnapshotHighwater', 'pendingGlobalSync', 'retired'}
            durable = any(json.loads(value) not in (None, False) for key, value in self.db.execute('SELECT key, value FROM state') if key not in metadata)
            for topic in (self.root / 'topic', self.root.parent / 'topic'):
                if topic.is_symlink() or (topic.exists() and any(path.is_file() or path.is_symlink() for path in topic.rglob('*'))):
                    durable = True
            if not allowed or durable:
                self.db.close()
                raise ValueError('persisted node identity mismatch; retire before replacing volume')
        with self.db:
            if persisted is not None and persisted != identity:
                self.db.execute('DELETE FROM state WHERE key=?', ('retired',))
            self.db.executemany('INSERT OR REPLACE INTO state VALUES (?, ?)',
                                [('identity', json.dumps(identity)), ('secretFingerprint', json.dumps(fingerprint))])
        self.snapshot = self.restore()

    @property
    def unbound(self):
        return self.identity['chatId'] == 0 and self.identity['threadId'] == 0

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
                if value['hash'] != marker['hash'] or marker['directory'] != str(value['revision']) + '-' + value['hash']:
                    raise ValueError('active snapshot corrupt')
                highest = self.get('activatedSnapshotHighwater') or self.get('snapshotHighwater')
                if highest and (value['revision'] < highest['revision'] or (value['revision'] == highest['revision'] and value['hash'] != highest['hash'])):
                    raise ValueError('persisted snapshot is below highwater')
                if candidate != current:
                    atomic(current, canonical(marker))
                return value
            except (OSError, ValueError, KeyError, TypeError):
                continue
        # Leave Core unready until an authenticated bootstrap repairs the cache.
        return None

    def apply(self, value, activate=True):
        raw = self.verify_snapshot(value)
        with self.lock:
            # Include duplicated projections and filesystem allocation overhead,
            # not just the signed JSON body. Tiny skills also consume disk blocks.
            block = max(4096, os.statvfs(self.root).f_frsize)
            allocated = lambda size: max(block, ((size + block - 1) // block) * block)
            projection = canonical(value['configuration'].get('runtime', {}))
            required = allocated(len(raw)) + allocated(len(projection)) + 2 * block
            required += sum(allocated(len(skill['content'].encode())) + block for skill in value['skills'])
            if required > MAX_SNAPSHOT_DISK:
                raise ValueError('snapshot materialization quota exceeded')
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
            intact = False
            if directory.exists() and not directory.is_symlink():
                try:
                    stored = json.loads((directory / 'snapshot.json').read_bytes())
                    intact = self.verify_snapshot(stored) == raw
                    intact = intact and (directory / 'opencode.json').read_bytes() == canonical(value['configuration'].get('runtime', {}))
                    intact = intact and all((directory / 'skills' / skill['name'] / 'SKILL.md').read_bytes() == skill['content'].encode() for skill in value['skills'])
                except (OSError, ValueError, KeyError, TypeError):
                    intact = False
            if not intact:
                # Interrupted staging and obsolete versions are disposable. Prune
                # before allocating another candidate, retaining only proven markers.
                retained = set()
                for marker_path in (self.root / 'active.json', self.root / 'previous.json'):
                    try:
                        marker = json.loads(marker_path.read_bytes())
                        if not re.fullmatch(r'[0-9]+-[0-9a-f]{64}', marker['directory']):
                            continue
                        cached = json.loads((versions / marker['directory'] / 'snapshot.json').read_bytes())
                        self.verify_snapshot(cached)
                        if marker['hash'] == cached['hash'] and marker['directory'] == str(cached['revision']) + '-' + cached['hash']:
                            retained.add(marker['directory'])
                    except (OSError, ValueError, KeyError, TypeError):
                        continue
                for cached in versions.iterdir():
                    if cached.name not in retained:
                        if cached.is_symlink():
                            cached.unlink()
                        elif cached.is_dir():
                            shutil.rmtree(cached)
                        else:
                            cached.unlink()
                if shutil.disk_usage(self.root).free < required + SNAPSHOT_DISK_RESERVE:
                    raise ValueError('snapshot materialization quota has insufficient free disk')
                # Rebuild only from authenticated, fully hash-verified bytes. The
                # revision/hash highwater checks above still prohibit replacement.
                staged = versions / ('.repair-' + secrets.token_hex(12))
                staged.mkdir()
                atomic(staged / 'snapshot.json', raw)
                atomic(staged / 'opencode.json', canonical(value['configuration'].get('runtime', {})))
                for skill in value['skills']:
                    target = staged / 'skills' / skill['name']
                    target.mkdir(parents=True)
                    atomic(target / 'SKILL.md', skill['content'].encode())
                quarantine = versions / ('.corrupt-' + secrets.token_hex(12))
                if directory.exists() or directory.is_symlink():
                    os.replace(directory, quarantine)
                try:
                    os.replace(staged, directory)
                    fd = os.open(versions, os.O_DIRECTORY)
                    try:
                        os.fsync(fd)
                    finally:
                        os.close(fd)
                except Exception:
                    if quarantine.exists() or quarantine.is_symlink():
                        os.replace(quarantine, directory)
                    raise
                if quarantine.is_symlink():
                    quarantine.unlink()
                elif quarantine.exists():
                    shutil.rmtree(quarantine)
            current = self.root / 'active.json'
            if current.exists() and previous and previous['hash'] != value['hash']:
                atomic(self.root / 'previous.json', current.read_bytes())
            # Fence old configuration durably before publishing the new marker.
            # A crash between these writes remains unready until verified repair.
            self.set('snapshotHighwater', {'revision': value['revision'], 'hash': value['hash']})
            atomic(current, canonical(dict(directory=name, hash=value['hash'])))
            self.snapshot = value
            if activate:
                self.confirm_activation()
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

    def confirm_activation(self):
        with self.lock:
            if self.snapshot is None:
                raise ValueError('no snapshot to activate')
            self.verify_snapshot(self.snapshot)
            self.set('activatedSnapshotHighwater', {'revision': self.snapshot['revision'], 'hash': self.snapshot['hash']})

    def rollback_failed_activation(self, previous):
        with self.lock:
            activated = self.get('activatedSnapshotHighwater')
            if not previous or not activated or activated != {'revision': previous['revision'], 'hash': previous['hash']}:
                raise ValueError('rollback requires exact known-good activation proof')
            marker = dict(directory=str(previous['revision']) + '-' + previous['hash'], hash=previous['hash'])
            stored = json.loads((self.root / 'versions' / marker['directory'] / 'snapshot.json').read_bytes())
            if self.verify_snapshot(stored) != canonical(previous):
                raise ValueError('rollback snapshot integrity failed')
            atomic(self.root / 'active.json', canonical(marker))
            self.snapshot = previous


class Agent:
    def __init__(self, boundary, control_plane, binary='/usr/local/bin/opencode', core_port=4096, exit_on_crash=None):
        endpoint = urlsplit(control_plane)
        if endpoint.scheme != 'https' or not endpoint.hostname or endpoint.username or endpoint.password or endpoint.query or endpoint.fragment:
            raise ValueError('control plane requires HTTPS')
        self.boundary = boundary
        self.endpoint = control_plane.rstrip('/') + '/node-control'
        self.binary = binary
        self.core_port = core_port
        self.process = None
        self.process_epoch = 0
        self.process_stopping = False
        self.process_lease = None
        self.fatal_exit_requested = False
        self.process_lock = threading.RLock()
        self.lifecycle_lock = threading.RLock()
        self.exit_on_crash = os._exit if exit_on_crash is None else exit_on_crash
        self.ready = False
        self.lock = threading.RLock()
        self.sync_watcher = None
        self.runtime_selftest_owner = None
        self.runtime_selftest_stopping = False
        self.workspace = (Path('/tmp') / ('unbound-core-' + hashlib.sha256(canonical(boundary.identity)).hexdigest())
                          if boundary.unbound else boundary.root / 'topic')
        if self.workspace.is_symlink():
            raise ValueError('Core workspace cannot be symlink')
        self.workspace.mkdir(exist_ok=True)
        self.retired = boundary.get('retired') is True
        from provider_proxy import ProviderProxy
        self.proxy = ProviderProxy(self)
        from mcp_proxy import MCPProxy
        self.mcp_proxy = MCPProxy(self)
        from control_bridge import ControlBridge
        self.bridge = ControlBridge(self)

    def outbound(self, operation, payload, session=None):
        if self.boundary.unbound and (operation != 'snapshot.get' or session is not None):
            raise ValueError('unbound node authority unavailable')
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
            self.boundary.apply(self.outbound('snapshot.get', {}), activate=False)
        except (OSError, TimeoutError):
            if self.boundary.snapshot is None:
                return
        self.start_core()
        self.boundary.confirm_activation()

    def fatal_core_exit(self):
        with self.process_lock:
            if self.fatal_exit_requested:
                return
            self.fatal_exit_requested = True
            self.ready = False
            self.exit_on_crash(1)

    def supervise_core(self, process):
        with self.process_lock:
            self.process_epoch += 1
            lease = {'process': process, 'epoch': self.process_epoch, 'intentional': False,
                     'joined': False, 'stop_complete': threading.Event()}
            self.process = process
            self.process_lease = lease
            self.process_stopping = False
        def await_exit():
            try:
                code = process.wait()
            except Exception:
                self.fatal_core_exit()
                return
            # PR28's essential-child contract: signal/nonzero/75 always retires
            # the container, even during a planned stop or from an older lease.
            if code != 0:
                self.fatal_core_exit()
                return
            if lease['intentional']:
                lease['stop_complete'].wait()
            with self.process_lock:
                if lease['intentional'] and lease['joined']:
                    return
                self.fatal_core_exit()
        watcher = threading.Thread(target=await_exit, daemon=True)
        watcher.start()
        return watcher

    def start_core(self):
        with self.lifecycle_lock:
            return self._start_core()

    def _start_core(self):
        with self.process_lock:
            if self.fatal_exit_requested or self.process is not None:
                raise RuntimeError('Core lease must be intentionally joined before replacement')
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
        runtime_config = self.mcp_proxy.rewrite(runtime_config, snapshot['credentialReferences'])
        self.proxy.start()
        self.mcp_proxy.start()
        self.bridge.start()
        tools = config / 'tools'
        if tools.is_symlink():
            raise ValueError('runtime tool directory cannot be symlink')
        tools.mkdir(exist_ok=True)
        atomic(tools / 'bot.ts', self.bridge.tool_source().encode())
        atomic(tools / 'actions.ts', self.bridge.actions_tool_source().encode())
        materialize_browser_tool(tools)
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
        try:
            process = subprocess.Popen([self.binary, 'serve', '--hostname', '127.0.0.1', '--port', str(self.core_port)], cwd=self.workspace,
                                       env=self.core_environment(), preexec_fn=demote, start_new_session=True)
        except Exception:
            self.fatal_core_exit()
            raise
        self.supervise_core(process)
        # Bounded startup checks only; no background polling or idle traffic.
        for _ in range(100):
            if process.poll() is not None:
                raise RuntimeError('Core exited during startup')
            try:
                self.local('GET', '/global/health')
                with self.process_lock:
                    if self.process is not process or self.process_stopping or process.poll() is not None:
                        raise RuntimeError('Core startup lease ended')
                    self.ready = True
                    self.runtime_selftest_stopping = False
                return
            except Exception:
                time.sleep(.1)
        self.stop_core()
        raise RuntimeError('Core startup timeout')

    def core_environment(self):
        result = child_environment(os.environ)
        if self.boundary.unbound:
            # Availability boot must not create durable Topic/session/execution state.
            result['XDG_DATA_HOME'] = str(self.workspace / 'home/.local/share')
            result['XDG_STATE_HOME'] = str(self.workspace / 'home/.local/state')
            result['OPENCODE_TELEGRAM_RUNTIME_SELFTEST'] = '1'
        return result

    def stop_core(self):
        with self.lock:
            self.runtime_selftest_stopping = True
        self.cancel_runtime_selftest()
        self.mcp_proxy.close_active()
        with self.lifecycle_lock:
            with self.process_lock:
                process, lease = self.process, self.process_lease
                self.ready = False
                if process is not None and process.poll() is not None and not (lease and lease['intentional'] and lease['joined']):
                    self.fatal_core_exit()
                    raise RuntimeError('Core exited before retirement intent')
                self.process_stopping = True
                self.process_epoch += 1
                if lease:
                    lease['intentional'] = True
            if process is None:
                return
            try:
                if process.poll() is None:
                    try:
                        self.local('POST', '/global/dispose', {}, timeout=10)
                    except Exception:
                        # Disposal failure is uncertain retirement, not permission
                        # to signal/replace the owner beneath a surviving Agent.
                        self.fatal_core_exit()
                        raise RuntimeError('Core disposal could not be joined')
                    import signal
                    if process.poll() is None:
                        try:
                            os.killpg(process.pid, signal.SIGTERM)
                        except ProcessLookupError:
                            pass
                try:
                    code = process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    self.fatal_core_exit()
                    raise RuntimeError('Core retirement timed out')
                if code != 0:
                    self.fatal_core_exit()
                    raise RuntimeError('Core exited without proven retirement')
                with self.process_lock:
                    if lease:
                        lease['joined'] = True
                    if self.process is process:
                        self.process = None
                        self.process_lease = None
            finally:
                if lease:
                    lease['stop_complete'].set()

    def local(self, method, route, payload=None, timeout=30):
        request = Request('http://127.0.0.1:' + str(self.core_port) + route,
                          data=None if payload is None else canonical(payload), method=method,
                          headers={'Content-Type': 'application/json', 'x-opencode-directory': str(self.workspace)})
        with urlopen(request, timeout=timeout) as response:
            raw = response.read(MAX_BODY + 1)
            if len(raw) > MAX_BODY:
                raise ValueError('Core response exceeds limit')
            return json.loads(raw) if raw else None


    def refresh_snapshot(self, allow_offline=True):
        # Transport outage may use prior valid state; integrity errors fail closed.
        try:
            latest = self.outbound('snapshot.get', {})
        except (OSError, TimeoutError):
            if not allow_offline:
                raise
            if self.boundary.snapshot is None:
                raise ValueError('snapshot unavailable')
            return False
        self.boundary.verify_snapshot(latest)
        current = self.boundary.snapshot
        if current and latest['hash'] == current['hash']:
            self.boundary.apply(latest, activate=False)
            if not self.ready:
                self.start_core()
            self.boundary.confirm_activation()
            self.boundary.set('pendingGlobalSync', False)
            return True
        self.boundary.apply(latest, activate=False)
        self.stop_core()
        try:
            self.start_core()
            self.boundary.confirm_activation()
        except Exception:
            if current:
                self.boundary.rollback_failed_activation(current)
                self.start_core()
            raise
        self.boundary.set('pendingGlobalSync', False)
        return True

    def converge_pending_sync(self, wait=False):
        with self.lock:
            if self.retired or not self.boundary.get('pendingGlobalSync'):
                return False
            deadline = time.monotonic() + (2 if wait else 0)
            session = self.boundary.get('session')
            while True:
                prepared = self.boundary.get('runPrepared')
                preparing = prepared and prepared['expiresAt'] >= time.time()
                execution = self.local('GET', '/session/' + quote(session, safe='') + '/execution') if session else None
                if not preparing and not execution:
                    return self.refresh_snapshot(allow_offline=False)
                if time.monotonic() >= deadline:
                    return False
                time.sleep(.025)

    def ensure_sync_watcher(self, admitting=False):
        needs_mcp_join = self.mcp_proxy.active is not None and any(route['enabled'] for route in self.mcp_proxy.routes.values())
        if self.sync_watcher is not None or not (self.boundary.get('pendingGlobalSync') or needs_mcp_join):
            return
        session, run_id = self.boundary.get('session'), self.boundary.get('runId')
        request = Request('http://127.0.0.1:' + str(self.core_port) + '/event', headers={'Accept': 'text/event-stream', 'x-opencode-directory': str(self.workspace)})
        stream = urlopen(request, timeout=15)
        prepared = self.boundary.get('runPrepared')
        if not admitting and not (prepared and prepared['expiresAt'] >= time.time()) and not self.local('GET', '/session/' + quote(session, safe='') + '/execution'):
            stream.close()
            self.converge_pending_sync()
            return
        def observe():
            try:
                with stream:
                    for _ in self.stream_frames(stream, session, run_id, 0):
                        pass
                self.converge_pending_sync(wait=True)
            except Exception:
                # Keep the durable deferred claim; the next authenticated RPC
                # retries convergence. No idle reconnect or background retry.
                pass
            finally:
                self.mcp_proxy.end(session, run_id)
                with self.lock:
                    self.sync_watcher = None
        self.sync_watcher = threading.Thread(target=observe, daemon=True)
        self.sync_watcher.start()

    def runtime_selftest(self, value):
        payload = value.get('payload')
        if (not self.boundary.unbound or value.get('sessionId') is not None or not isinstance(payload, dict)
                or set(payload) != {'profile'} or payload['profile'] not in ('baseline', 'browser', 'network')):
            raise ValueError('invalid runtime selftest capability')
        with self.lock:
            if (self.retired or not self.ready or self.runtime_selftest_stopping or self.runtime_selftest_owner
                    or self.fatal_exit_requested or not self.process or self.process.poll() is not None
                    or self.boundary.get('session') or self.boundary.get('runId')):
                raise ValueError('runtime selftest unavailable')
            owner = {'runId': secrets.token_hex(24), 'profile': payload['profile'], 'done': threading.Event()}
            self.runtime_selftest_owner = owner
        try:
            result = self.local('POST', '/telegram/runtime-selftest',
                                {'runId': owner['runId'], 'profile': owner['profile']}, timeout=210)
            if not isinstance(result, dict) or result.get('runId') != owner['runId'] or result.get('profile') != owner['profile'] or result.get('joined') is not True:
                raise RuntimeError('runtime selftest has no exact join proof')
            with self.lock:
                if self.runtime_selftest_owner is owner:
                    self.runtime_selftest_owner = None
            return result
        except Exception:
            # Unknown native retirement is not permission to reuse the owner.
            self.fatal_core_exit()
            raise
        finally:
            owner['done'].set()

    def cancel_runtime_selftest(self):
        with self.lock:
            owner = self.runtime_selftest_owner
        if not owner:
            return
        try:
            result = self.local('POST', '/telegram/runtime-selftest/' + owner['runId'] + '/abort', {}, timeout=30)
            if not isinstance(result, dict) or result.get('runId') != owner['runId'] or result.get('joined') is not True:
                raise RuntimeError('runtime selftest cancellation has no exact join proof')
            if not owner['done'].wait(10):
                raise RuntimeError('runtime selftest request did not join')
            with self.lock:
                if self.runtime_selftest_owner is owner:
                    self.runtime_selftest_owner = None
        except Exception:
            self.fatal_core_exit()
            raise

    def dispatch(self, value):
        operation, payload = value['operation'], value['payload']
        if operation == 'runtime.selftest':
            return self.runtime_selftest(value)
        if operation == 'retire':
            with self.lock:
                self.retired = True
                self.runtime_selftest_stopping = True
            self.cancel_runtime_selftest()
        if not isinstance(payload, dict):
            raise ValueError('payload must be object')
        with self.lock:
            if operation == 'sync-global' and self.runtime_selftest_owner:
                raise ValueError('runtime selftest owns idle Core')
            if self.boundary.unbound and operation not in ('health', 'status', 'sync-global', 'retire'):
                raise ValueError('unbound node authority unavailable')
            if self.boundary.unbound and value.get('sessionId') is not None:
                raise ValueError('unbound node has no session')
            if self.boundary.unbound and operation == 'status':
                return {'ready': self.ready and not self.retired, 'bound': False, 'retired': self.boundary.get('retired') is True}
            if operation == 'health':
                return {'ready': self.ready and not self.retired, **({'runtime': runtime_identity()} if Path('/usr/local/share/core-build-info.json').exists() else {})}
            if operation == 'retire':
                # Gate admission immediately, but persist handoff proof only after
                # the essential Core lease has been intentionally stopped/joined.
                self.retired = True
                with self.process_lock:
                    lease = self.process_lease
                    joined = self.process is None or (lease and lease['intentional'] and lease['joined']
                                                       and lease['process'] is self.process and self.process.poll() == 0)
                if not (self.boundary.get('retired') is True and joined):
                    self.stop_core()
                    self.boundary.set('retired', True)
                return {'retired': True}
            if self.retired:
                raise ValueError('node retired')
            if operation == 'sync-global':
                self.boundary.set('pendingGlobalSync', True)
                if self.boundary.unbound:
                    self.refresh_snapshot(allow_offline=False)
                    snapshot = self.boundary.snapshot
                    return {'revision': snapshot['revision'], 'hash': snapshot['hash']}

                session = self.boundary.get('session')
                prepared = self.boundary.get('runPrepared')
                execution = self.local('GET', '/session/' + quote(session, safe='') + '/execution') if session else None
                if execution or (prepared and prepared['expiresAt'] >= time.time()):
                    self.ensure_sync_watcher()
                    snapshot = self.boundary.snapshot
                    return {'deferred': True, 'revision': snapshot['revision'], 'hash': snapshot['hash']}
                self.refresh_snapshot(allow_offline=False)
                snapshot = self.boundary.snapshot
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
            if operation in ('status', 'session.status', 'session.messages', 'session.query', 'session.get'):
                try:
                    self.converge_pending_sync()
                except OSError:
                    pass
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
                self.mcp_proxy.begin(session, run_id)
                try:
                    self.ensure_sync_watcher(admitting=True)
                    self.local('POST', '/session/' + encoded + '/prompt_async', body)
                except Exception:
                    self.mcp_proxy.end(session, run_id)
                    raise
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
                self.mcp_proxy.end(session, run_id)
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
        if self.boundary.unbound:
            raise ValueError('unbound node authority unavailable')
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

    def stream_frames(self, stream, session, run_id, cursor, stream_nonce=None):
        lines = []
        size = 0
        sequence = 0
        stream_nonce = secrets.token_hex(24) if stream_nonce is None else stream_nonce
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
            sequence += 1
            properties = event.get('properties', {})
            terminal = event.get('type') in ('session.idle', 'session.error') or (event.get('type') == 'session.status' and properties.get('status', {}).get('type') == 'idle')
            if terminal:
                self.mcp_proxy.end(session, run_id)
            envelope = self.boundary.envelope('session.event', {'runId': run_id, 'event': event, 'streamNonce': stream_nonce, 'sequence': sequence}, session)
            raw = canonical(envelope)
            yield canonical({'envelope': envelope, 'body': raw.decode('utf-8'), 'signature': self.boundary.signature(raw)})
            if terminal:
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
                        for frame in self.server.agent.stream_frames(stream, session, run_id, cursor, value['nonce']):
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
    validate_worker_environment(os.environ)
    # Capture secret before spawning unprivileged Core. Never log configuration.
    secret = os.environ.pop('NODE_SHARED_SECRET')
    root = Path('/data')
    root.mkdir(exist_ok=True)
    if root.is_symlink():
        raise ValueError('data root cannot be symlink')
    os.chown(root, 0, 0)
    os.chmod(root, 0o755)
    if (root / 'agent').is_symlink() or (root / 'topic').is_symlink():
        raise ValueError('persistent root paths cannot be symlinks')
    from bootstrap_identity import resolve_bootstrap_identity
    identity = resolve_bootstrap_identity(root / 'agent', os.environ['NODE_ID'],
                                          int(os.environ['NODE_GENERATION']), secret,
                                          os.environ['CONTROL_PLANE_URL'])
    boundary = Boundary(root / 'agent', secret, identity)
    os.chmod(boundary.root, 0o700)
    agent = Agent(boundary, os.environ['CONTROL_PLANE_URL'])
    # topic is separate from root-only ledger; immutable snapshots must be readable.
    if not boundary.unbound:
        agent.workspace = root / 'topic'
    agent.workspace.mkdir(exist_ok=True)
    server = BoundedHTTPServer(('0.0.0.0', 8080), Handler)
    server.agent = agent
    threading.Thread(target=agent.bootstrap, daemon=True).start()
    try:
        server.serve_forever()
    finally:
        agent.stop_core()


if __name__ == '__main__':
    main()
