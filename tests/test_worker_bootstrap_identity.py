import hashlib
import hmac
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'worker'))
from bootstrap_identity import resolve_bootstrap_identity, _request

SECRET = 'synthetic-node-key-' + 'x' * 48
IDENTITY = dict(nodeId='node-test', generation=2, chatId=-100, threadId=3)

def signed_reply(raw, secret=SECRET, identity=IDENTITY):
    request = json.loads(raw)
    value = {**request, 'payload': {'ok': True, 'result': identity}}
    body = json.dumps(value, separators=(',', ':'))
    return {'body': body, 'signature': hmac.new(secret.encode(), body.encode(), hashlib.sha256).hexdigest()}

class BootstrapIdentityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'agent'
    def resolve(self, transport, secret=SECRET, generation=2):
        return resolve_bootstrap_identity(self.root, 'node-test', generation, secret,
            'https://control.up.railway.app', transport=transport, now=lambda: 1000)
    def online(self, raw, signature, url):
        request = json.loads(raw)
        self.assertEqual((request['chatId'], request['threadId']), (0, 0))
        self.assertEqual(request['payload'], {})
        self.assertEqual(request['operation'], 'bootstrap.get')
        self.assertEqual(url, 'https://control.up.railway.app/node-control')
        self.assertEqual(signature, hmac.new(SECRET.encode(), raw, hashlib.sha256).hexdigest())
        return signed_reply(raw)
    def ledger(self, identity=IDENTITY, secret=SECRET, retired=False):
        self.root.mkdir(mode=0o700, exist_ok=True)
        with sqlite3.connect(self.root / 'agent.sqlite') as db:
            db.execute('CREATE TABLE state (key TEXT PRIMARY KEY,value TEXT NOT NULL)')
            for key, value in [('identity', identity), ('secretFingerprint', hashlib.sha256(secret.encode()).hexdigest()), ('retired', retired)]:
                db.execute('INSERT INTO state VALUES (?,?)', (key,json.dumps(value)))
    def test_wire_uses_exact_signed_body_and_signature_header(self):
        class Response:
            status = 200
            headers = {'x-node-signature':'signature-header'}
            def __enter__(self):return self
            def __exit__(self,*_):pass
            def read(self,limit):return b'{"bare":"envelope"}'
        class Opener:
            def open(self,request,timeout):
                self.request=request;self.timeout=timeout;return Response()
        with patch('bootstrap_identity.build_opener',return_value=Opener()):
            self.assertEqual(_request(b'{}','synthetic-signature','https://control.up.railway.app/node-control'),{'body':'{"bare":"envelope"}','signature':'signature-header'})
    def test_online_discloses_only_authenticated_canonical_tuple(self):
        self.assertEqual(self.resolve(self.online), IDENTITY)
        cache = (self.root / 'bootstrap-identity.json').read_text()
        self.assertNotIn(SECRET, cache)
        self.assertEqual(json.loads(cache)['identity'], IDENTITY)
    def test_new_node_requires_online_authority(self):
        with self.assertRaisesRegex(ValueError, 'known identity'):
            self.resolve(lambda *_: (_ for _ in ()).throw(URLError('offline')))
    def test_restart_uses_matching_durable_identity_during_transport_outage(self):
        self.resolve(self.online)
        self.ledger()
        self.assertEqual(self.resolve(lambda *_: (_ for _ in ()).throw(URLError('offline'))), IDENTITY)
    def test_authorization_or_bad_signature_never_uses_cache(self):
        self.resolve(self.online)
        for code in [401,403,409]:
            with self.assertRaises(HTTPError):
                self.resolve(lambda *_: (_ for _ in ()).throw(HTTPError('url',code,'denied',{},None)))
        def tampered(raw, *_):
            value=signed_reply(raw);value['signature']='0'*64;return value
        with self.assertRaisesRegex(ValueError,'signature'):
            self.resolve(tampered)
    def test_server_outage_fallback_uses_existing_known_identity(self):
        self.resolve(self.online)
        self.assertEqual(self.resolve(lambda *_: (_ for _ in ()).throw(HTTPError('url',503,'offline',{},None))), IDENTITY)
    def test_runtime_ledger_supersedes_corrupt_disposable_bootstrap_cache(self):
        self.ledger()
        (self.root / 'bootstrap-identity.json').write_text('corrupt')
        self.assertEqual(self.resolve(self.online), IDENTITY)
    def test_canonical_unbound_tuple_is_supported_without_env_topic_defaults(self):
        unbound = {**IDENTITY, 'chatId':0, 'threadId':0}
        self.assertEqual(self.resolve(lambda raw,*_:signed_reply(raw,identity=unbound)),unbound)
    def test_secret_or_generation_change_cannot_reuse_outage_cache(self):
        self.resolve(self.online)
        offline=lambda *_: (_ for _ in ()).throw(URLError('offline'))
        with self.assertRaises(ValueError):self.resolve(offline, generation=3)
        with self.assertRaises(ValueError):self.resolve(offline,secret='different-'+'y'*48)
    def test_replayed_nonce_and_foreign_signed_identity_rejected(self):
        def wrong(raw, *_):
            envelope=json.loads(raw);envelope['nonce']='oldnonce'*8
            return signed_reply(json.dumps(envelope).encode())
        with self.assertRaisesRegex(ValueError,'envelope'):self.resolve(wrong)
        with self.assertRaisesRegex(ValueError,'identity'):self.resolve(lambda raw,*_:signed_reply(raw,identity={**IDENTITY,'nodeId':'foreign'}))
    def test_retired_ledger_cannot_restart_offline_or_same_generation(self):
        self.ledger(retired=True)
        with self.assertRaises(ValueError):self.resolve(self.online)
        with self.assertRaises(ValueError):self.resolve(lambda *_: (_ for _ in ()).throw(URLError('offline')))
    def test_empty_retired_unbound_ledger_allows_online_next_generation_rotated_secret(self):
        self.ledger(identity={**IDENTITY,'generation':1,'chatId':0,'threadId':0},secret='old-'+'z'*48,retired=True)
        self.assertEqual(self.resolve(self.online), IDENTITY)
    def test_same_generation_secret_rotation_rejected_even_with_signed_response(self):
        self.ledger(secret='old-'+'z'*48)
        with self.assertRaisesRegex(ValueError,'transition'):self.resolve(self.online)

if __name__=='__main__':unittest.main()
