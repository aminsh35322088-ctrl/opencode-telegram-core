import hashlib
import json
import socket
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
import sys
sys.path.insert(0, str(Path(__file__).parents[2] / 'worker'))
import node_agent as a


class BoundaryResourceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.boundary = a.Boundary(self.temp.name, 's' * 32, dict(nodeId='n', generation=1, chatId=-1, threadId=2))

    def tearDown(self):
        self.boundary.db.close()
        self.temp.cleanup()

    def test_callback_write_cannot_commit_or_observe_another_thread_transaction(self):
        started, done = threading.Event(), threading.Event()
        errors = []
        def callback():
            started.set()
            try:
                self.boundary.set('callbackPending', {'runId': 'owned'})
            except BaseException as error:
                errors.append(error)
            finally:
                done.set()
        thread = threading.Thread(target=callback)
        try:
            with self.boundary.lock:
                with self.assertRaisesRegex(RuntimeError, 'rollback admission'):
                    with self.boundary.db:
                        self.boundary.db.execute('INSERT INTO state VALUES (?,?)', ('uncommitted', 'true'))
                        thread.start()
                        self.assertTrue(started.wait(1))
                        self.assertFalse(done.wait(.05), 'callback committed the in-flight admission transaction')
                        raise RuntimeError('rollback admission')
        finally:
            if thread.ident is not None:
                thread.join(1)
        self.assertFalse(thread.is_alive())
        self.assertEqual(errors, [])
        self.assertIsNone(self.boundary.get('uncommitted'))
        self.assertEqual(self.boundary.get('callbackPending'), {'runId': 'owned'})

    def snapshot(self, revision):
        value = dict(version=1, revision=revision, configuration={'runtime': {}}, skills=[], actions=[], catalog={}, defaults={}, credentialReferences=[])
        value['hash'] = a.digest(value)
        return value

    def test_corrupt_current_never_restores_below_highwater(self):
        self.boundary.apply(self.snapshot(1))
        directory = self.boundary.apply(self.snapshot(2))
        (directory / 'snapshot.json').write_text('{}')
        self.assertIsNone(self.boundary.restore())
        self.boundary.db.close()
        self.boundary = a.Boundary(self.temp.name, 's' * 32, self.boundary.identity)
        self.assertIsNone(self.boundary.snapshot)
        self.boundary.apply(self.snapshot(2))
        self.assertEqual(self.boundary.restore()['revision'], 2)

    def test_failed_new_core_start_rolls_back_only_known_good_configuration(self):
        previous, latest = self.snapshot(1), self.snapshot(2)
        self.boundary.apply(previous)
        agent = a.Agent(self.boundary, 'https://control.invalid')
        agent.outbound = lambda *args: latest
        agent.stop_core = lambda: setattr(agent, 'ready', False)
        starts = []
        def start():
            starts.append(self.boundary.snapshot['revision'])
            if self.boundary.snapshot['revision'] == 2:
                raise RuntimeError('new configuration rejected')
            agent.ready = True
        agent.start_core = start
        with self.assertRaises(RuntimeError):
            agent.refresh_snapshot()
        self.assertEqual(starts, [2, 1])
        self.assertEqual(self.boundary.restore()['revision'], 1)
        self.assertTrue(agent.ready)

    def test_retry_same_verified_candidate_requires_readiness_before_activation(self):
        candidate = self.snapshot(1)
        self.boundary.apply(candidate, activate=False)
        agent = a.Agent(self.boundary, 'https://control.invalid')
        agent.outbound = lambda *args: candidate
        starts = []
        def start():
            starts.append(True)
            agent.ready = True
        agent.start_core = start
        agent.refresh_snapshot()
        self.assertEqual(starts, [True])
        self.assertEqual(self.boundary.get('activatedSnapshotHighwater'), {'revision': 1, 'hash': candidate['hash']})

    def test_materialization_quota_rejects_before_writing_new_version(self):
        self.boundary.apply(self.snapshot(1))
        value = self.snapshot(2)
        value['skills'] = [dict(name='skill'+str(i), content='', hash=hashlib.sha256(b'').hexdigest()) for i in range(100)]
        value['hash'] = a.digest({k: v for k, v in value.items() if k != 'hash'})
        with patch.object(a, 'MAX_SNAPSHOT_DISK', 64 * 1024):
            with self.assertRaisesRegex(ValueError, 'quota'):
                self.boundary.apply(value)
        self.assertEqual(self.boundary.restore()['revision'], 1)
        self.assertEqual(len(list((self.boundary.root / 'versions').iterdir())), 1)

    def test_staged_candidate_crash_keeps_last_activated_snapshot(self):
        self.boundary.apply(self.snapshot(1))
        original = a.atomic
        def crash(path, data):
            if path.name == 'active.json':
                raise OSError('fixture crash')
            original(path, data)
        with patch.object(a, 'atomic', crash), self.assertRaises(OSError):
            self.boundary.apply(self.snapshot(2), activate=False)
        self.assertEqual(self.boundary.restore()['revision'], 1)

    def test_corrupt_known_good_cache_cannot_authorize_failed_activation_rollback(self):
        previous = self.snapshot(1)
        directory = self.boundary.apply(previous)
        self.boundary.apply(self.snapshot(2), activate=False)
        (directory / 'snapshot.json').write_text('{}')
        with self.assertRaises(ValueError):
            self.boundary.rollback_failed_activation(previous)
        self.assertEqual(self.boundary.snapshot['revision'], 2)

    def test_successful_activation_fences_any_old_rollback(self):
        previous = self.snapshot(1)
        self.boundary.apply(previous)
        self.boundary.apply(self.snapshot(2), activate=False)
        self.boundary.confirm_activation()
        with self.assertRaises(ValueError):
            self.boundary.rollback_failed_activation(previous)

    def test_partial_materialization_debris_is_removed_before_next_attempt(self):
        self.boundary.apply(self.snapshot(1))
        versions = self.boundary.root / 'versions'
        debris = versions / '.repair-interrupted'
        debris.mkdir()
        (debris / 'partial').write_bytes(b'fixture')
        original = a.atomic
        def check_before_writing(path, data):
            if path.name == 'snapshot.json':
                self.assertFalse(debris.exists())
            original(path, data)
        with patch.object(a, 'atomic', check_before_writing):
            self.boundary.apply(self.snapshot(2))
        self.assertFalse(debris.exists())


class HTTPAdmissionTests(unittest.TestCase):
    def test_admission_happens_before_thread_and_limits_header_read(self):
        server = a.BoundedHTTPServer(('127.0.0.1', 0), a.Handler)
        left, right = socket.socketpair()
        try:
            with patch.object(a.ThreadingHTTPServer, 'process_request') as start:
                for _ in range(8):
                    server.process_request(left, ('local', 0))
                self.assertEqual(start.call_count, 8)
                self.assertEqual(left.gettimeout(), 15)
                with patch.object(server, 'shutdown_request') as close:
                    server.process_request(right, ('local', 0))
                    close.assert_called_once_with(right)
                self.assertEqual(start.call_count, 8)
        finally:
            left.close(); right.close(); server.server_close()

    def test_thread_failure_releases_admission(self):
        server = a.BoundedHTTPServer(('127.0.0.1', 0), a.Handler)
        left, right = socket.socketpair()
        try:
            with patch.object(a.ThreadingHTTPServer, 'process_request', side_effect=RuntimeError('fixture thread failure')):
                for _ in range(9):
                    with self.assertRaises(RuntimeError):
                        server.process_request(left, ('local', 0))
        finally:
            left.close(); right.close(); server.server_close()

class RuntimeToolTests(unittest.TestCase):
    def test_child_uses_immutable_browser_and_ephemeral_python_caches(self):
        env = a.child_environment({'PLAYWRIGHT_BROWSERS_PATH': '/data/malicious', 'PIP_CACHE_DIR': '/data/pip', 'PATH': '/usr/local/bin:/usr/bin'})
        self.assertEqual(env['PLAYWRIGHT_BROWSERS_PATH'], '/opt/ms-playwright')
        self.assertEqual(env['PIP_CACHE_DIR'], '/tmp/pip-cache')
        self.assertEqual(env['PYTHONUSERBASE'], '/tmp/python-user')
        self.assertEqual(env['PATH'], '/usr/local/bin:/usr/bin')

    def test_browser_tool_materializes_verified_image_source(self):
        with tempfile.TemporaryDirectory() as root:
            source = Path(root) / 'browser.ts'
            source.write_text('export default {}')
            source.chmod(0o644)
            tools = Path(root) / 'tools'
            tools.mkdir()
            from types import SimpleNamespace
            original = a.os.fstat
            def image_stat(fd):
                value = original(fd)
                return SimpleNamespace(st_mode=value.st_mode, st_uid=0, st_size=value.st_size)
            with patch.object(a, 'BROWSER_TOOL_SOURCE', source, create=True), patch.object(a.os, 'fstat', image_stat):
                a.materialize_browser_tool(tools)
            self.assertEqual((tools / 'browser.ts').read_text(), source.read_text())

    def test_browser_tool_rejects_writable_or_symlink_source(self):
        with tempfile.TemporaryDirectory() as root:
            source = Path(root) / 'browser.ts'
            source.write_text('export default {}')
            source.chmod(0o666)
            tools = Path(root) / 'tools'
            tools.mkdir()
            with patch.object(a, 'BROWSER_TOOL_SOURCE', source, create=True), self.assertRaises(ValueError):
                a.materialize_browser_tool(tools)
            link = Path(root) / 'link'
            link.symlink_to(source)
            with patch.object(a, 'BROWSER_TOOL_SOURCE', link, create=True), self.assertRaises(ValueError):
                a.materialize_browser_tool(tools)

    def test_browser_tool_rejects_nonroot_owned_source(self):
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as root:
            source = Path(root) / 'browser.ts'
            source.write_text('export default {}')
            source.chmod(0o644)
            tools = Path(root) / 'tools'
            tools.mkdir()
            with patch.object(a, 'BROWSER_TOOL_SOURCE', source), patch.object(a.os, 'fstat', return_value=SimpleNamespace(st_mode=0o100644, st_uid=1000, st_size=17)), self.assertRaises(ValueError):
                a.materialize_browser_tool(tools)
