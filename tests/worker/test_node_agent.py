import importlib.util
import hashlib
import json
import tempfile
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parents[2] / 'worker'))

spec = importlib.util.spec_from_file_location('node_agent', Path(__file__).parents[2] / 'worker/node_agent.py')
a = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a)


class SecurityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.identity = dict(nodeId='n', generation=1, chatId=-12, threadId=4)
        self.b = a.Boundary(self.temp.name, 's' * 32, self.identity)

    def tearDown(self):
        self.b.db.close()
        self.temp.cleanup()

    def signed(self, **changes):
        value = self.b.envelope('status', {})
        value.update(changes)
        raw = a.canonical(value)
        return raw, self.b.signature(raw)

    def test_raw_body_tamper_and_identity(self):
        raw, signature = self.signed()
        with self.assertRaises(ValueError):
            self.b.authenticate(raw + b' ', signature)
        for changes in (dict(generation=2), dict(chatId=10), dict(nodeId='foreign'), dict(timestamp=0)):
            with self.assertRaises(ValueError):
                self.b.authenticate(*self.signed(**changes))

    def test_replay_durable_across_restart(self):
        signed = self.signed()
        self.b.authenticate(*signed)
        self.b.db.close()
        self.b = a.Boundary(self.temp.name, 's' * 32, self.identity)
        with self.assertRaises(Exception):
            self.b.authenticate(*signed)

    def test_replay_ledger_full_fails_closed(self):
        import time
        with self.b.db:
            self.b.db.executemany('INSERT INTO replay VALUES (?, ?)', [(str(i), time.time() + 120) for i in range(4096)])
        with self.assertRaises(ValueError):
            self.b.authenticate(*self.signed())

    def snapshot(self, revision=1):
        value = dict(version=1, revision=revision, configuration={}, skills=[dict(name='safe', content='hello', hash=hashlib.sha256(b'hello').hexdigest())], actions=[], catalog={}, defaults={}, credentialReferences=[])
        value['hash'] = a.digest(value)
        return value

    def test_snapshot_activation_restore_and_conflicts(self):
        snapshot = self.snapshot()
        self.b.apply(snapshot)
        self.assertEqual(self.b.restore(), snapshot)
        with self.assertRaises(ValueError):
            self.b.apply(self.snapshot(0))
        changed = self.snapshot()
        changed['defaults'] = {'changed': True}
        changed['hash'] = a.digest({k: v for k, v in changed.items() if k != 'hash'})
        with self.assertRaises(ValueError):
            self.b.apply(changed)
        self.assertEqual(self.b.restore(), snapshot)

    def test_invalid_skill_and_hash_never_activate(self):
        snapshot = self.snapshot()
        snapshot['skills'][0]['name'] = '../escape'
        snapshot['hash'] = a.digest({k: v for k, v in snapshot.items() if k != 'hash'})
        with self.assertRaises(ValueError):
            self.b.apply(snapshot)
        self.assertFalse((Path(self.temp.name) / 'active.json').exists())

    def test_environment_is_allowlisted(self):
        env = a.child_environment({'PATH': '/bin', 'RAILWAY_TOKEN': 'fixture', 'RAILWAY_API_TOKEN': 'fixture', 'TELEGRAM_BOT_TOKEN': 'fixture', 'NODE_SHARED_SECRET': 'fixture', 'AWS_SECRET_ACCESS_KEY': 'fixture'})
        self.assertEqual(env['OPENCODE_TELEGRAM_PROCESS_BUDGET'], '1')
        self.assertFalse(any('TOKEN' in key or 'SECRET' in key for key in env))

    def test_outbound_requires_https(self):
        with self.assertRaises(ValueError):
            a.Agent(self.b, 'http://example.invalid')


class LifecycleTests(SecurityTests):
    def setUp(self):
        super().setUp()
        self.agent = a.Agent(self.b, 'https://control.invalid')
        class Process:
            def poll(self):
                return None
        self.agent.ready = True
        self.agent.process = Process()
        self.b.set('session', 'ses_owned')
        self.b.set('runId', 'run_owned')

    def request(self, operation, payload=None, session='ses_owned'):
        return self.b.envelope(operation, payload or {}, session)

    def test_foreign_session_and_run_never_reach_core(self):
        def forbidden(*args):
            self.fail('foreign authority reached Core')
        self.agent.local = forbidden
        with self.assertRaises(ValueError):
            self.agent.dispatch(self.request('status', session='ses_other'))
        for op in ('pause', 'resume', 'stop'):
            with self.assertRaises(ValueError):
                self.agent.dispatch(self.request(op, {'runId': 'old_run'}))

    def test_question_reply_requires_exact_session_owner(self):
        calls = []
        def local(method, route, payload=None):
            calls.append((method, route, payload))
            return [{'id': 'q_foreign', 'sessionID': 'ses_other', 'questions': [{}]}, {'id': 'q_owned', 'sessionID': 'ses_owned', 'questions': [{}]}] if method == 'GET' else True
        self.agent.local = local
        with self.assertRaises(ValueError):
            self.agent.dispatch(self.request('question.reply', {'runId': 'run_owned', 'requestId': 'q_foreign', 'answers': [['a']]}))
        self.assertTrue(all(method == 'GET' for method, _, _ in calls))
        self.assertTrue(self.agent.dispatch(self.request('question.reply', {'runId': 'run_owned', 'requestId': 'q_owned', 'answers': [['a']]})))
        self.assertEqual(calls[-1], ('POST', '/question/q_owned/reply', {'answers': [['a']]}))

    def test_pause_uses_native_run_identity_and_fences_replacement(self):
        calls = []
        def local(method, route, payload=None):
            calls.append((method, route, payload))
            return {'runId': 'native_run', 'continuation': 'live', 'paused': method == 'POST'}
        self.agent.local = local
        self.agent.dispatch(self.request('pause', {'runId': 'run_owned'}))
        self.assertEqual(calls[-1][2], {'runId': 'native_run'})
        self.b.set('nativeRunId', 'old_native')
        with self.assertRaises(ValueError):
            self.agent.dispatch(self.request('resume', {'runId': 'run_owned'}))

    def test_signed_active_event_fenced_and_terminal_closes(self):
        import io
        event = {'type': 'session.idle', 'durable': {'aggregateID': 'ses_owned', 'seq': 1}}
        stream = io.BytesIO(b'data: ' + a.canonical(event) + b'\n\n')
        frames = list(self.agent.stream_frames(stream, 'ses_owned', 'run_owned', 0))
        self.assertEqual(len(frames), 1)
        frame = a.json.loads(frames[0])
        self.assertEqual(frame['signature'], self.b.signature(a.canonical(frame['envelope'])))
        stream.seek(0)
        self.b.set('runId', 'replacement')
        self.assertEqual(list(self.agent.stream_frames(stream, 'ses_owned', 'run_owned', 0)), [])

    def test_foreign_durable_event_fails_closed(self):
        import io
        event = {'type': 'message.updated', 'durable': {'aggregateID': 'ses_other', 'seq': 1}}
        with self.assertRaises(ValueError):
            list(self.agent.stream_frames(io.BytesIO(b'data: ' + a.canonical(event) + b'\n\n'), 'ses_owned', 'run_owned', 0))

    def test_restore_previous_valid_snapshot(self):
        first = self.snapshot(1)
        second = self.snapshot(2)
        self.b.apply(first)
        directory = self.b.apply(second)
        (directory / 'snapshot.json').write_text('{}')
        self.assertEqual(self.b.restore(), first)
        with self.assertRaises(ValueError):
            self.b.apply(first)

    def test_version_cache_is_bounded_and_keeps_rollback(self):
        for revision in range(1, 12):
            self.b.apply(self.snapshot(revision))
        versions = list((self.b.root / 'versions').iterdir())
        self.assertLessEqual(len(versions), 2)
        self.assertEqual(self.b.restore()['revision'], 11)
        current = self.b.root / 'versions' / json.loads((self.b.root / 'active.json').read_text())['directory']
        (current / 'snapshot.json').write_text('{}')
        self.assertEqual(self.b.restore()['revision'], 10)


class DeferredSyncTests(LifecycleTests):
    def test_prepared_run_does_not_refresh_during_control_outage(self):
        calls = []
        self.agent.local = lambda method, route, payload=None: calls.append((method, route)) or None
        refreshes = []
        self.agent.refresh_snapshot = lambda: refreshes.append('snapshot')
        self.agent.dispatch(self.request('run.prepare', {'runId': 'reserved'}))
        self.assertEqual(refreshes, ['snapshot'])
        def outage(*args, **kwargs):
            self.fail('prepared admission contacted unavailable control plane')
        self.agent.refresh_snapshot = outage
        result = self.agent.dispatch(self.request('run', {'runId': 'reserved', 'text': 'execute'}))
        self.assertTrue(result['accepted'])
        self.assertIn(('POST', '/session/ses_owned/prompt_async'), calls)

    def test_wrong_or_expired_prepared_run_cannot_dispatch_prompt(self):
        from unittest.mock import patch
        self.agent.local = lambda *args: None
        self.agent.refresh_snapshot = lambda: None
        with patch.object(a.time, 'time', return_value=100):
            self.agent.dispatch(self.request('run.prepare', {'runId': 'reserved'}))
        for run, now in [('other', 101), ('reserved', 131)]:
            with patch.object(a.time, 'time', return_value=now):
                with self.assertRaises(ValueError):
                    self.agent.dispatch(self.request('run', {'runId': run, 'text': 'execute'}))

    def test_busy_sync_defers_and_idle_completion_fetches_once(self):
        snapshot = self.snapshot()
        self.b.apply(snapshot)
        state = {'busy': True}
        self.agent.local = lambda *args, **kwargs: {'continuation': 'live', 'runId': 'native'} if state['busy'] else None
        watchers = []
        self.agent.ensure_sync_watcher = lambda: watchers.append('active-only')
        result = self.agent.dispatch(self.request('sync-global'))
        self.assertTrue(result['deferred'])
        self.assertTrue(self.b.get('pendingGlobalSync'))
        self.assertEqual(watchers, ['active-only'])
        fetches = []
        self.agent.outbound = lambda *args: fetches.append('snapshot') or snapshot
        state['busy'] = False
        self.assertTrue(self.agent.converge_pending_sync())
        self.assertFalse(self.b.get('pendingGlobalSync'))
        self.agent.converge_pending_sync()
        self.assertEqual(fetches, ['snapshot'])

    def test_deferred_claim_survives_outage_without_background_retry(self):
        self.b.apply(self.snapshot())
        self.b.set('pendingGlobalSync', True)
        self.agent.local = lambda *args: None
        calls = []
        def unavailable(*args):
            calls.append('snapshot')
            raise OSError('fixture outage')
        self.agent.outbound = unavailable
        with self.assertRaises(OSError):
            self.agent.converge_pending_sync()
        self.assertEqual(calls, ['snapshot'])
        self.assertTrue(self.b.get('pendingGlobalSync'))

    def test_corrupt_same_revision_repairs_only_verified_bytes(self):
        snapshot = self.snapshot()
        directory = self.b.apply(snapshot)
        (directory / 'snapshot.json').write_text('{}')
        (directory / 'skills' / 'safe' / 'SKILL.md').write_text('corrupt')
        self.b.db.close()
        self.b = a.Boundary(self.temp.name, 's' * 32, self.identity)
        self.assertIsNone(self.b.snapshot)
        self.b.apply(snapshot)
        self.assertEqual(self.b.restore(), snapshot)
        self.assertEqual((directory / 'skills' / 'safe' / 'SKILL.md').read_text(), 'hello')
        conflicting = self.snapshot()
        conflicting['defaults'] = {'changed': True}
        conflicting['hash'] = a.digest({key: value for key, value in conflicting.items() if key != 'hash'})
        with self.assertRaises(ValueError):
            self.b.apply(conflicting)
        self.assertEqual(self.b.restore(), snapshot)


if __name__ == '__main__':
    unittest.main()
