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

    def test_stream_sequences_are_request_bound_and_independent_of_cursor(self):
        import io
        events = [{'type': 'message.updated', 'durable': {'aggregateID': 'ses_owned', 'seq': 71}},
                  {'type': 'session.idle', 'durable': {'aggregateID': 'ses_owned', 'seq': 74}}]
        raw = b''.join(b'data: ' + a.canonical(event) + b'\n\n' for event in events)
        frames = [json.loads(frame)['envelope'] for frame in self.agent.stream_frames(io.BytesIO(raw), 'ses_owned', 'run_owned', 70, 'signed-rpc-nonce')]
        self.assertEqual([frame['payload']['sequence'] for frame in frames], [1, 2])
        self.assertEqual([frame['payload']['streamNonce'] for frame in frames], ['signed-rpc-nonce', 'signed-rpc-nonce'])
        replacement = list(self.agent.stream_frames(io.BytesIO(raw), 'ses_owned', 'run_owned', 70, 'replacement-rpc-nonce'))
        self.assertEqual(json.loads(replacement[0])['envelope']['payload']['sequence'], 1)
        self.assertEqual(json.loads(replacement[0])['envelope']['payload']['streamNonce'], 'replacement-rpc-nonce')

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
        self.assertIsNone(self.b.restore())
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
        self.assertIsNone(self.b.restore())


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


class ProcessSupervisorTests(SecurityTests):
    def fake_process(self):
        import threading
        class Process:
            pid = 123456
            def __init__(self):
                self.exited = threading.Event()
            def wait(self, timeout=None):
                if not self.exited.wait(timeout):
                    raise a.subprocess.TimeoutExpired('fixture', timeout)
                return self.exit_code
            exit_code = -9
            def poll(self):
                return self.exit_code if self.exited.is_set() else None
        return Process()

    def agent(self):
        import threading
        self.exit_called = threading.Event()
        self.exit_codes = []
        def exit_callback(code):
            self.exit_codes.append(code)
            self.exit_called.set()
        return a.Agent(self.b, 'https://control.invalid', exit_on_crash=exit_callback)

    def test_unexpected_exit_marks_unready_and_requests_nonzero_agent_exit(self):
        agent = self.agent()
        process = self.fake_process()
        watcher = agent.supervise_core(process)
        agent.ready = True
        process.exited.set()
        watcher.join(1)
        self.assertTrue(self.exit_called.is_set())
        self.assertEqual(self.exit_codes, [1])
        self.assertFalse(agent.ready)

    def test_unexpected_normal_exit_is_not_permission_for_local_restart(self):
        agent = self.agent()
        process = self.fake_process()
        process.exit_code = 0
        watcher = agent.supervise_core(process)
        process.exited.set()
        watcher.join(1)
        self.assertEqual(self.exit_codes, [1])
        with self.assertRaises(RuntimeError):
            agent.start_core()

    def test_exit_zero_before_stop_intent_cannot_be_reclassified_as_reload(self):
        import threading
        agent = self.agent()
        process = self.fake_process()
        release_callback = threading.Event()
        original_wait = process.wait
        def delayed_wait(timeout=None):
            code = original_wait(timeout)
            release_callback.wait()
            return code
        process.wait = delayed_wait
        watcher = agent.supervise_core(process)
        process.exit_code = 0
        process.exited.set()
        with self.assertRaises(RuntimeError):
            agent.stop_core()
        self.assertEqual(self.exit_codes, [1])
        self.assertFalse(agent.process_lease['intentional'])
        release_callback.set()
        watcher.join(1)
        self.assertEqual(self.exit_codes, [1])

    def test_wait_authority_failure_retires_agent(self):
        agent = self.agent()
        process = self.fake_process()
        def lost_wait():
            raise OSError('fixture lost wait authority')
        process.wait = lost_wait
        watcher = agent.supervise_core(process)
        watcher.join(1)
        self.assertEqual(self.exit_codes, [1])

    def test_controlled_stop_invalidates_watcher_before_dispose_and_kill(self):
        from unittest.mock import patch
        agent = self.agent()
        process = self.fake_process()
        watcher = agent.supervise_core(process)
        agent.ready = True
        def dispose(*args, **kwargs):
            process.exit_code = 0
            process.exited.set()
        agent.local = dispose
        with patch.object(a.os, 'killpg'):
            agent.stop_core()
        watcher.join(1)
        self.assertEqual(self.exit_codes, [])
        self.assertIsNone(agent.process)
        self.assertFalse(agent.ready)

    def test_joined_old_generation_callback_cannot_exit_replacement(self):
        from unittest.mock import patch
        agent = self.agent()
        import threading
        old, replacement = self.fake_process(), self.fake_process()
        release_old_callback = threading.Event()
        original_wait = old.wait
        def delayed_wait(timeout=None):
            code = original_wait(timeout)
            if timeout is None:
                release_old_callback.wait()
            return code
        old.wait = delayed_wait
        old_watcher = agent.supervise_core(old)
        def dispose(*args, **kwargs):
            old.exit_code = 0
            old.exited.set()
        agent.local = dispose
        with patch.object(a.os, 'killpg'):
            agent.stop_core()
        replacement_watcher = agent.supervise_core(replacement)
        agent.ready = True
        release_old_callback.set()
        old_watcher.join(1)
        self.assertEqual(self.exit_codes, [])
        self.assertTrue(agent.ready)
        replacement.exited.set()
        replacement_watcher.join(1)
        self.assertEqual(self.exit_codes, [1])

    def test_nonzero_exit_during_planned_retirement_is_fatal(self):
        agent = self.agent()
        process = self.fake_process()
        watcher = agent.supervise_core(process)
        def dispose(*args, **kwargs):
            process.exit_code = 75
            process.exited.set()
        agent.local = dispose
        with self.assertRaises(RuntimeError):
            agent.stop_core()
        watcher.join(1)
        self.assertEqual(self.exit_codes, [1])
        self.assertTrue(agent.fatal_exit_requested)

    def test_retired_agent_still_exits_on_abnormal_child_loss(self):
        agent = self.agent()
        process = self.fake_process()
        watcher = agent.supervise_core(process)
        agent.retired = True
        process.exited.set()
        watcher.join(1)
        self.assertEqual(self.exit_codes, [1])

    def test_shutdown_authority_failure_does_not_force_kill_or_reload(self):
        from unittest.mock import patch
        agent = self.agent()
        process = self.fake_process()
        watcher = agent.supervise_core(process)
        def uncertain(*args, **kwargs):
            raise OSError('fixture lost retirement authority')
        agent.local = uncertain
        with patch.object(a.os, 'killpg') as kill:
            with self.assertRaises(RuntimeError):
                agent.stop_core()
            kill.assert_not_called()
        self.assertEqual(self.exit_codes, [1])
        with self.assertRaises(RuntimeError):
            agent.start_core()
        process.exited.set()
        watcher.join(1)


if __name__ == '__main__':
    unittest.main()


class UnboundTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / 'agent'
        self.identity = dict(nodeId='slot', generation=1, chatId=0, threadId=0)
        self.b = a.Boundary(self.root, 's' * 32, self.identity)
        self.agent = a.Agent(self.b, 'https://control.invalid')

    def tearDown(self):
        self.b.db.close()
        self.temp.cleanup()

    def test_bootstrap_health_and_global_sync_without_session(self):
        snapshot = dict(version=1, revision=1, configuration={'runtime': {}}, skills=[], actions=[], catalog={}, defaults={}, credentialReferences=[])
        snapshot['hash'] = a.digest(snapshot)
        fetches = []
        self.agent.outbound = lambda op, payload: fetches.append(op) or snapshot
        self.agent.start_core = lambda: setattr(self.agent, 'ready', True)
        self.agent.bootstrap()
        self.assertEqual(fetches, ['snapshot.get'])
        self.assertEqual(self.b.snapshot, snapshot)
        self.assertEqual(self.agent.dispatch(self.b.envelope('health', {})), {'ready': True})
        self.assertFalse(self.agent.dispatch(self.b.envelope('status', {}))['bound'])
        self.assertEqual(self.agent.dispatch(self.b.envelope('sync-global', {}))['revision'], 1)
        self.assertIsNone(self.b.get('session'))
        self.assertNotIn('/data/topic', self.agent.core_environment()['XDG_DATA_HOME'])

    def test_all_unbound_execution_and_local_capability_paths_fail_closed(self):
        self.agent.ready = True
        self.b.set('session', 'malicious')
        self.b.set('runId', 'malicious')
        self.agent.local = lambda *args, **kwargs: self.fail('unbound RPC reached Core')
        for operation in ('session.create', 'session.bind', 'session.delete', 'run.prepare', 'run', 'pause', 'resume', 'stop', 'question.list', 'question.reply', 'session.get', 'credential.get', 'mutation.commit'):
            with self.subTest(operation=operation), self.assertRaises(ValueError):
                self.agent.dispatch(self.b.envelope(operation, {}))
        with self.assertRaises(ValueError): self.agent.events(self.b.envelope('session.events', {}))
        for operation in ('credential.get', 'mutation.prepare', 'mutation.commit'):
            with self.assertRaises(ValueError): self.agent.outbound(operation, {})
        with self.assertRaises(ValueError): self.agent.proxy.credential({'capability': 'p', 'credentialId': 'c'})
        with self.assertRaises(ValueError): self.agent.mcp_proxy.credential({'credentialId': None}, ('malicious', 'malicious'))
        with self.assertRaises(ValueError): self.agent.mcp_proxy.begin('malicious', 'malicious')
        with self.assertRaises(ValueError): self.agent.bridge.dispatch({'sessionId': 'malicious', 'action': 'skills.create'})

    def reopen(self, identity, secret='t' * 32):
        return a.Boundary(self.root, secret, identity)

    def test_binding_is_exact_one_way_and_rotates_secret(self):
        bound = dict(self.identity, generation=2, chatId=-12, threadId=4)
        for identity, secret in ((dict(bound, generation=1), 't'*32), (dict(bound, generation=3), 't'*32), (dict(bound, nodeId='foreign'), 't'*32), (bound, 's'*32)):
            with self.assertRaises(ValueError): self.reopen(identity, secret)
        old = self.b.envelope('health', {})
        old_signature = self.b.signature(a.canonical(old))
        self.agent.stop_core = lambda: None
        self.assertEqual(self.agent.dispatch(self.b.envelope('retire', {})), {'retired': True})
        self.b.db.close()
        self.b = self.reopen(bound)
        self.assertIsNone(self.b.get('retired'))
        self.assertFalse(a.Agent(self.b, 'https://control.invalid').retired)
        with self.assertRaises(ValueError): self.b.authenticate(a.canonical(old), old_signature)
        with self.assertRaises(ValueError): self.b.authenticate(a.canonical(old), self.b.signature(a.canonical(old)))
        for identity in (self.identity, dict(bound, generation=3), dict(bound, threadId=5)):
            with self.assertRaises(ValueError): self.reopen(identity)

    def test_session_run_and_durable_topic_state_prevent_binding(self):
        bound = dict(self.identity, generation=2, chatId=-12, threadId=4)
        self.b.set('retired', True)
        for key in ('session', 'runId', 'runPrepared', 'nativeRunId', 'execution'):
            self.b.set(key, 'durable')
            with self.assertRaises(ValueError): self.reopen(bound)
            self.b.set(key, None)
        topic = self.root.parent / 'topic'
        topic.mkdir()
        (topic / 'state.sqlite').write_bytes(b'durable')
        with self.assertRaises(ValueError): self.reopen(bound)

    def test_invalid_identity_and_privileged_environment_rejected(self):
        for changes in (dict(chatId=0, threadId=4), dict(chatId=-12, threadId=0), dict(chatId=-12, threadId=1), dict(generation=0), dict(generation=True), dict(threadId=2**53)):
            with self.assertRaises(ValueError): a.validate_identity(dict(self.identity, **changes))
        for name in ('RAILWAY_API_TOKEN', 'RAILWAY_TOKEN', 'RAILWAY_PROJECT_TOKEN'):
            with self.assertRaisesRegex(ValueError, 'provisioning credential'):
                a.validate_worker_environment({name: 'fixture'})
        a.validate_worker_environment({'RAILWAY_SERVICE_ID': 'fixture'})
        from unittest.mock import patch
        with patch.object(a.os, 'environ', {'RAILWAY_API_TOKEN': 'fixture'}):
            with self.assertRaisesRegex(ValueError, 'provisioning credential'):
                a.main()

    def test_retire_persists_handoff_proof_only_after_core_join(self):
        joined = []
        def stop():
            self.assertTrue(self.agent.retired)
            self.assertIsNone(self.b.get('retired'))
            joined.append(True)
        self.agent.stop_core = stop
        raw = a.canonical(self.b.envelope('retire', {}))
        request = self.b.authenticate(raw, self.b.signature(raw))
        self.assertEqual(self.agent.dispatch(request), {'retired': True})
        self.assertEqual(joined, [True])
        self.assertTrue(self.b.get('retired'))
        self.assertEqual(self.agent.dispatch(self.b.envelope('retire', {})), {'retired': True})
        self.assertEqual(joined, [True])
        self.assertTrue(self.agent.dispatch(self.b.envelope('status', {}))['retired'])

    def test_failed_core_join_does_not_authorize_binding(self):
        def fail():
            raise RuntimeError('join failed')
        self.agent.stop_core = fail
        with self.assertRaises(RuntimeError):
            self.agent.dispatch(self.b.envelope('retire', {}))
        self.assertIsNone(self.b.get('retired'))
        with self.assertRaises(ValueError):
            self.reopen(dict(self.identity, generation=2, chatId=-12, threadId=4))
        self.agent.stop_core = lambda: None
        self.assertEqual(self.agent.dispatch(self.b.envelope('retire', {})), {'retired': True})
        self.assertTrue(self.b.get('retired'))

    def test_retire_does_not_reuse_proof_for_unjoined_core(self):
        self.b.set('retired', True)
        self.agent.retired = True
        self.agent.process = type('Process', (), {'poll': lambda self: None})()
        self.agent.process_lease = {'process': self.agent.process, 'intentional': False, 'joined': False}
        stops = []
        def fail():
            stops.append(True)
            raise RuntimeError('join unconfirmed')
        self.agent.stop_core = fail
        with self.assertRaises(RuntimeError):
            self.agent.dispatch(self.b.envelope('retire', {}))
        self.assertEqual(stops, [True])
