"""Root-only authenticated identity bootstrap. Never sends session/global authority."""
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import stat
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

LIMIT = 16 * 1024
SAFE_INTEGER = 9007199254740991


def _validate(identity):
    if not isinstance(identity, dict) or set(identity) != {'nodeId', 'generation', 'chatId', 'threadId'}:
        raise ValueError('invalid bootstrap identity')
    if not isinstance(identity['nodeId'], str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', identity['nodeId']):
        raise ValueError('invalid bootstrap identity')
    if any(type(identity[key]) is not int or abs(identity[key]) > SAFE_INTEGER for key in ('generation', 'chatId', 'threadId')) or identity['generation'] < 1:
        raise ValueError('invalid bootstrap identity')
    if (identity['chatId'], identity['threadId']) != (0, 0) and (identity['chatId'] == 0 or identity['threadId'] <= 1):
        raise ValueError('invalid bootstrap identity')


def _regular(path):
    metadata = path.lstat()
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != os.getuid():
        raise ValueError('invalid bootstrap durable file')


def _known(root):
    ledger = root / 'agent.sqlite'
    cache = root / 'bootstrap-identity.json'
    ledger_identity = None
    if ledger.exists() or ledger.is_symlink():
        _regular(ledger)
        # Existing WAL is read through SQLite; never copy an open database.
        with sqlite3.connect(ledger.as_uri() + '?mode=ro', uri=True) as db:
            rows = dict(db.execute("SELECT key,value FROM state WHERE key IN ('identity','secretFingerprint','retired')"))
        if rows:
            ledger_identity = {'identity': json.loads(rows.get('identity', 'null')),
                              'secretFingerprint': json.loads(rows.get('secretFingerprint', 'null')),
                              'retired': json.loads(rows.get('retired', 'false'))}
            _validate(ledger_identity['identity'])
            if not isinstance(ledger_identity['secretFingerprint'], str) or not re.fullmatch('[a-f0-9]{64}', ledger_identity['secretFingerprint']) or type(ledger_identity['retired']) is not bool:
                raise ValueError('invalid bootstrap durable state')
    if ledger_identity is not None:
        return ledger_identity
    cached = None
    if cache.exists() or cache.is_symlink():
        _regular(cache)
        if cache.stat().st_size > LIMIT:
            raise ValueError('invalid bootstrap cache')
        cached = json.loads(cache.read_text())
        if not isinstance(cached, dict) or set(cached) != {'version', 'identity', 'secretFingerprint'} or cached['version'] != 1:
            raise ValueError('invalid bootstrap cache')
        _validate(cached['identity'])
        if not isinstance(cached['secretFingerprint'], str) or not re.fullmatch('[a-f0-9]{64}', cached['secretFingerprint']):
            raise ValueError('invalid bootstrap cache')
    # The runtime ledger owns retirement and the live identity; stale cache never overrides it.
    return ledger_identity or ({**cached, 'retired': False} if cached else None)


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('bootstrap redirect rejected')


def _request(raw, signature, endpoint):
    request = Request(endpoint, data=raw, headers={'Content-Type': 'application/json', 'x-node-signature': signature}, method='POST')
    with build_opener(_NoRedirect()).open(request, timeout=5) as response:
        if response.status != 200:
            raise ValueError('bootstrap response rejected')
        body = response.read(LIMIT + 1)
        if len(body) > LIMIT:
            raise ValueError('bootstrap response too large')
        return {'body': body.decode('utf-8'), 'signature': response.headers.get('x-node-signature', '')}


def _save(root, identity, fingerprint):
    target = root / 'bootstrap-identity.json'
    temporary = root / ('.bootstrap-' + secrets.token_hex(16))
    raw = json.dumps({'version': 1, 'identity': identity, 'secretFingerprint': fingerprint}, separators=(',', ':')).encode()
    descriptor = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        with os.fdopen(descriptor, 'wb') as file:
            file.write(raw)
            file.flush()
            os.fsync(file.fileno())
        os.replace(temporary, target)
        directory = os.open(root, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if temporary.exists():
            temporary.unlink()


def resolve_bootstrap_identity(root, node_id, generation, secret, control_url, *, transport=_request, now=time.time):
    provisional = dict(nodeId=node_id, generation=generation, chatId=0, threadId=0)
    _validate(provisional)
    if not isinstance(secret, str) or len(secret.encode()) < 32:
        raise ValueError('invalid bootstrap signing identity')
    endpoint = urlsplit(control_url)
    if endpoint.scheme != 'https' or not endpoint.hostname or not endpoint.hostname.endswith('.up.railway.app') or endpoint.username or endpoint.password or endpoint.port not in (None, 443) or endpoint.path not in ('', '/') or endpoint.query or endpoint.fragment:
        raise ValueError('invalid bootstrap control endpoint')
    root = Path(root).absolute()
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    metadata = root.lstat()
    if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != os.getuid() or metadata.st_mode & 0o022:
        raise ValueError('invalid bootstrap root')
    os.chmod(root, 0o700)
    known = _known(root)
    fingerprint = hashlib.sha256(secret.encode()).hexdigest()
    request = dict(version=1, **provisional, operation='bootstrap.get', payload={}, timestamp=int(now() * 1000), nonce=secrets.token_hex(24))
    raw = json.dumps(request, separators=(',', ':')).encode()
    signature = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    try:
        response = transport(raw, signature, control_url.rstrip('/') + '/node-control')
    except (HTTPError, URLError, TimeoutError, ConnectionError, OSError) as error:
        if isinstance(error, HTTPError) and not 500 <= error.code <= 599:
            raise
        if not known or known['retired'] or known['identity']['nodeId'] != node_id or known['identity']['generation'] != generation or not hmac.compare_digest(known['secretFingerprint'], fingerprint):
            raise ValueError('no matching known identity during bootstrap outage') from None
        return dict(known['identity'])
    if not isinstance(response, dict) or set(response) != {'body', 'signature'} or not isinstance(response['body'], str) or len(response['body'].encode()) > LIMIT or not isinstance(response['signature'], str) or not re.fullmatch('[a-f0-9]{64}', response['signature']):
        raise ValueError('invalid bootstrap signature response')
    expected = hmac.new(secret.encode(), response['body'].encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, response['signature']):
        raise ValueError('invalid bootstrap signature')
    envelope = json.loads(response['body'])
    if not isinstance(envelope, dict) or set(envelope) != set(request) or any(envelope[key] != request[key] or type(envelope[key]) is not type(request[key]) for key in ('version', 'nodeId', 'generation', 'chatId', 'threadId', 'operation', 'nonce')) or type(envelope['timestamp']) is not int or abs(envelope['timestamp'] - int(now() * 1000)) > 60_000:
        raise ValueError('invalid bootstrap response envelope')
    payload = envelope['payload']
    if not isinstance(payload, dict) or set(payload) != {'ok', 'result'} or payload['ok'] is not True:
        raise ValueError('bootstrap authority rejected')
    identity = payload['result']
    _validate(identity)
    if identity['nodeId'] != node_id or identity['generation'] != generation:
        raise ValueError('foreign bootstrap identity')
    if known:
        identical = known['identity'] == identity and hmac.compare_digest(known['secretFingerprint'], fingerprint) and not known['retired']
        prior = known['identity']
        upgrade = prior['nodeId'] == node_id and prior['chatId'] == 0 and prior['threadId'] == 0 and identity['chatId'] != 0 and identity['threadId'] > 1 and generation == prior['generation'] + 1 and known['retired'] and not hmac.compare_digest(known['secretFingerprint'], fingerprint)
        if not identical and not upgrade:
            raise ValueError('bootstrap identity transition requires retired generation and rotated secret')
    _save(root, identity, fingerprint)
    return dict(identity)
