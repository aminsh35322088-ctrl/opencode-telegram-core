import http.client
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from urllib.request import urlopen
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).parents[2] / 'worker'))
from github_proxy import GitHubProxy, github_request, forward_chunk
from credential_broker import CredentialBroker
from provider_proxy import PinnedConnection


class GitHubProxyTests(unittest.TestCase):
    def test_default_github_listener_leaves_actual_core_port_available(self):
        import socket
        from node_agent import Agent,Boundary
        with tempfile.TemporaryDirectory() as d:
            boundary=Boundary(Path(d)/'agent','fixture-boundary-secret'*2,dict(nodeId='worker',generation=1,chatId=-100,threadId=42))
            agent=Agent(boundary,'https://control.invalid')
            agent.github.start()
            core=socket.socket()
            try:
                core.bind(('127.0.0.1',agent.core_port))
                self.assertNotEqual(agent.github.server.server_port,agent.core_port)
            finally:core.close();agent.github.close();boundary.db.close()

    def test_revocation_during_blocking_input_never_forwards_bytes(self):
        authorized = True
        forwarded = []
        def active():
            if not authorized:
                raise ValueError('retired')
        def read():
            nonlocal authorized
            authorized = False
            return b'push data'
        with self.assertRaises(ValueError):
            forward_chunk(read, forwarded.append, active)
        self.assertEqual(forwarded, [])

    def test_retirement_closes_transports_and_fences_the_epoch(self):
        proxy = GitHubProxy(SimpleNamespace())
        closed = []
        class Transport:
            def shutdown(self, _): closed.append('shutdown')
            def close(self): closed.append('close')
        transport = Transport()
        epoch = proxy.epoch
        proxy.register(transport, None, epoch)
        proxy.close_active()
        self.assertGreater(proxy.epoch, epoch)
        self.assertIn('shutdown', closed)
        with self.assertRaises(ValueError):
            proxy.register(transport, None, epoch)

    def test_repository_and_service_routes_are_exact(self):
        self.assertEqual(github_request('/github/owner/repository.git/info/refs?service=git-upload-pack', 'GET'),
                         ('owner/repository', 'repo.read', '/owner/repository.git/info/refs?service=git-upload-pack'))
        self.assertEqual(github_request('/github/owner/repository.git/git-receive-pack', 'POST')[1], 'repo.write')
        self.assertEqual(github_request('/github/owner/repository/info/refs?service=git-upload-pack', 'GET'),
                         ('owner/repository', 'repo.read', '/owner/repository.git/info/refs?service=git-upload-pack'))
        for path, method in [('/github/../repository.git/git-upload-pack', 'POST'),
                             ('/github/owner/repository.git/info/refs?service=git-receive-pack&token=x', 'GET'),
                             ('/github/owner/repository.git/git-upload-pack', 'GET'),
                             ('https://evil.example', 'GET')]:
            with self.assertRaises(ValueError):
                github_request(path, method)

    def test_http_route_reauthorizes_and_does_not_echo_secret_failures(self):
        calls = []
        class Broker:
            def acquire(self, request):
                calls.append(request)
                raise ValueError('fixture-private-token')
        snapshot = {'credentialReferences': [{'integrationId': 'github', 'credentialId': 'credential-one', 'configured': True}]}
        agent = SimpleNamespace(ready=True, retired=False,
            boundary=SimpleNamespace(unbound=False, snapshot=snapshot), credentials=Broker())
        proxy = GitHubProxy(agent, port=0)
        proxy.start()
        self.addCleanup(proxy.close)
        port = proxy.server.server_port
        for _ in range(2):
            with self.assertRaises(HTTPError) as error:
                urlopen(f'http://127.0.0.1:{port}/github/owner/repository.git/info/refs?service=git-upload-pack', timeout=5)
            body = error.exception.read()
            self.assertNotIn(b'fixture-private-token', body)
            self.assertEqual(error.exception.code, 403)
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0], {'integrationId': 'github', 'credentialId': 'credential-one',
            'capability': 'repo.read', 'resource': 'owner/repository', 'scopes': ['repo.read']})

    def test_unbound_worker_never_requests_a_credential(self):
        agent = SimpleNamespace(ready=True, retired=False,
            boundary=SimpleNamespace(unbound=True, snapshot={}),
            credentials=SimpleNamespace(acquire=lambda _: self.fail('unbound acquisition')))
        proxy = GitHubProxy(agent, port=0)
        proxy.start()
        self.addCleanup(proxy.close)
        with self.assertRaises(HTTPError):
            urlopen(f'http://127.0.0.1:{proxy.server.server_port}/github/owner/repository.git/info/refs?service=git-upload-pack', timeout=5)

    def test_retired_pending_connect_cannot_send_authorization(self):
        import time
        from unittest.mock import patch
        import github_proxy as module
        entered,resume=threading.Event(),threading.Event()
        received=[]
        class Backend(BaseHTTPRequestHandler):
            def log_message(self,*_):pass
            def do_GET(self):
                received.append(self.headers.get('Authorization'))
                self.send_response(200);self.send_header('Content-Type','application/x-git-upload-pack-advertisement')
                self.send_header('Content-Length','0');self.end_headers()
        backend=ThreadingHTTPServer(('127.0.0.1',0),Backend)
        threading.Thread(target=backend.serve_forever,daemon=True).start()
        class UnsafeDelayed(http.client.HTTPConnection):
            def __init__(self,*a,**kw):super().__init__(*backend.server_address,timeout=1)
            def connect(self):entered.set();resume.wait(2);super().connect()
        class SafeDelayed(PinnedConnection):
            def connect(self):
                entered.set();resume.wait(2)
                if self.cancelled.is_set():raise OSError('retired connect')
                stream=__import__('socket').create_connection(backend.server_address,timeout=1)
                with self.socket_lock:
                    if self.cancelled.is_set():stream.close();raise OSError('retired connect')
                    self.sock=stream
        identity=dict(nodeId='worker',generation=1,chatId=-100,threadId=42)
        boundary=SimpleNamespace(unbound=False,identity=identity,get=lambda _:'session',
            snapshot={'credentialReferences':[dict(integrationId='github',credentialId='cid',configured=True)]})
        agent=SimpleNamespace(ready=True,retired=False,boundary=boundary)
        agent.outbound=lambda operation,*a,**kw:dict(value='fixture-private-token',leaseId='lease',expiresAt=(time.time()+1)*1000) if operation=='credential.acquire' else dict(valid=True)
        agent.credentials=CredentialBroker(agent)
        errors=[]
        from contextlib import ExitStack
        legacy = not hasattr(module,'PinnedConnection')
        with ExitStack() as patches:
            if legacy:patches.enter_context(patch.object(module.http.client,'HTTPSConnection',UnsafeDelayed))
            patches.enter_context(patch.object(module,'PinnedConnection',SafeDelayed,create=True))
            proxy=GitHubProxy(agent,port=0);proxy.start()
            def request():
                try:urlopen(f'http://127.0.0.1:{proxy.server.server_port}/github/owner/repository.git/info/refs?service=git-upload-pack',timeout=2).read()
                except Exception as error:errors.append(error)
            thread=threading.Thread(target=request);thread.start()
            try:
                self.assertTrue(entered.wait(1))
                began=time.monotonic();proxy.close_active()
                self.assertLess(time.monotonic()-began,.25,'retirement blocked behind pending connect')
                agent.ready=False;resume.set();thread.join(1)
                self.assertFalse(thread.is_alive())
                time.sleep(.05)
                self.assertEqual(received,[],'Authorization sent after epoch retirement')
            finally:resume.set();thread.join(2);proxy.close();backend.shutdown();backend.server_close()

    def test_real_git_clone_fetch_and_push_through_scoped_broker_transport(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bare = root / 'owner/repository.git'
            bare.parent.mkdir()
            def git(*arguments, cwd=None):
                return subprocess.check_output(['/usr/bin/git', *arguments], cwd=cwd, stderr=subprocess.STDOUT,
                    env={**os.environ, 'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_CONFIG_NOSYSTEM': '1'}, timeout=15).decode()
            git('init', '--bare', '--initial-branch=main', str(bare))
            source = root / 'source'
            git('init', '--initial-branch=main', str(source))
            git('config', 'user.name', 'Fixture', cwd=source)
            git('config', 'user.email', 'fixture@example.invalid', cwd=source)
            (source / 'README.md').write_text('fixture\n')
            git('add', 'README.md', cwd=source)
            git('commit', '-m', 'fixture', cwd=source)
            git('push', str(bare), 'main', cwd=source)
            class Backend(BaseHTTPRequestHandler):
                def log_message(self, *_):
                    pass
                def do_GET(self): self.forward()
                def do_POST(self): self.forward()
                def forward(self):
                    route, _, query = self.path.partition('?')
                    length = int(self.headers.get('Content-Length', '0'))
                    raw = subprocess.check_output(['/usr/bin/git', 'http-backend'], input=self.rfile.read(length), timeout=10,
                        env={**os.environ, 'GIT_PROJECT_ROOT': str(root), 'GIT_HTTP_EXPORT_ALL': '1',
                            'PATH_INFO': route, 'QUERY_STRING': query, 'REQUEST_METHOD': self.command,
                            'CONTENT_TYPE': self.headers.get('Content-Type', ''), 'CONTENT_LENGTH': str(length),
                            'REMOTE_USER': 'capability'})
                    headers, body = raw.split(b'\r\n\r\n', 1)
                    self.send_response(200)
                    for line in headers.decode().split('\r\n'):
                        name, value = line.split(':', 1)
                        self.send_header(name, value.strip())
                    self.send_header('Content-Length', str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
            backend = ThreadingHTTPServer(('127.0.0.1', 0), Backend)
            threading.Thread(target=backend.serve_forever, daemon=True).start()
            calls = []
            identity = dict(nodeId='fixture', generation=1, chatId=-100, threadId=42)
            agent = SimpleNamespace(ready=True, retired=False,
                boundary=SimpleNamespace(unbound=False, identity=identity, get=lambda _: 'session',
                    snapshot={'credentialReferences': [{'integrationId': 'github', 'credentialId': 'reference', 'configured': True}]}))
            def outbound(operation, payload, session=None):
                calls.append((operation, payload))
                return {'leaseId': 'fixture-lease', 'expiresAt': ( __import__('time').time() + 55) * 1000,
                        'value': 'fixture-private-token'} if operation == 'credential.acquire' else {'valid': True}
            agent.outbound = outbound
            agent.credentials = CredentialBroker(agent)
            class LocalConnection(PinnedConnection):
                def __init__(self):super().__init__('local','127.0.0.1')
                def connect(self):
                    if self.cancelled.is_set():raise OSError('retired')
                    stream=__import__('socket').create_connection(backend.server_address,timeout=5)
                    with self.socket_lock:
                        if self.cancelled.is_set():stream.close();raise OSError('retired')
                        self.sock=stream
            proxy = GitHubProxy(agent, port=0, connection=LocalConnection)
            proxy.start()
            try:
                clone = root / 'clone'
                git('clone', f'http://127.0.0.1:{proxy.server.server_port}/github/owner/repository.git', str(clone))
                self.assertEqual((clone / 'README.md').read_text(), 'fixture\n')
                git('fetch', cwd=clone)
                git('config', 'user.name', 'Fixture', cwd=clone)
                git('config', 'user.email', 'fixture@example.invalid', cwd=clone)
                git('checkout', '-b', 'capability-test', cwd=clone)
                (clone / 'README.md').write_text('updated\n')
                git('commit', '-am', 'capability update', cwd=clone)
                git('push', 'origin', 'capability-test', cwd=clone)
                self.assertEqual(git('show', 'capability-test:README.md', cwd=bare), 'updated\n')
                self.assertNotIn('fixture-private-token', (clone / '.git/config').read_text())
                acquired = [request for operation, request in calls if operation == 'credential.acquire']
                self.assertTrue(any(request['capability'] == 'repo.read' for request in acquired))
                self.assertTrue(any(request['capability'] == 'repo.write' for request in acquired))
                self.assertTrue(all(request['resource'] == 'owner/repository' for request in acquired))
            finally:
                proxy.close()
                backend.shutdown()
                backend.server_close()
