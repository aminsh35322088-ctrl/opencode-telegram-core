"""Exercise real HTTP response sockets through both root consumers."""
import json
import socket
import sys
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).parents[2] / 'worker'))
import credential_transport
import provider_proxy
import mcp_proxy
import github_proxy
from credential_broker import CredentialBroker


class StreamFenceTests(unittest.TestCase):
    def exercise(self, kind, failure):
        first = b'data: allowed-' + b'x'*128 + b'\n\n'
        release, closed, validation_entered = threading.Event(), threading.Event(), threading.Event()
        errors, calls = [], []
        class Upstream(BaseHTTPRequestHandler):
            def log_message(self,*_):pass
            def do_GET(self):self.do_POST()
            def do_POST(self):
                self.rfile.read(int(self.headers.get('Content-Length','0')))
                self.send_response(200);self.send_header('Content-Type','application/x-git-upload-pack-advertisement' if kind=='github' else 'text/event-stream')
                self.send_header('Connection','close');self.end_headers()
                self.wfile.write(first);self.wfile.flush()
                release.wait(2)
                try:self.wfile.write(b'data: stale-after-fence\n\n');self.wfile.flush()
                except OSError:pass
        upstream=ThreadingHTTPServer(('127.0.0.1',0),Upstream)
        threading.Thread(target=upstream.serve_forever,daemon=True).start()
        boundary=SimpleNamespace(unbound=False,identity=dict(nodeId='worker',chatId=-100,threadId=42,generation=3),get=lambda key:'session' if key=='session' else 'run')
        agent=SimpleNamespace(ready=True,retired=False,boundary=boundary)
        valid=[True]; block=[False]; expiry=.18 if failure=='expiry' else 1
        def outbound(operation,payload,session=None):
            calls.append(operation)
            if operation=='credential.acquire':
                material='fixture-private-token' if kind in ('provider','github') else json.dumps({'Authorization':'Bearer fixture-private-token'})
                return dict(value=material,leaseId='lease',expiresAt=(time.time()+expiry)*1000)
            if operation=='credential.validate':
                if block[0]:validation_entered.set();release.wait(2)
                return dict(valid=valid[0])
            return {}
        agent.outbound=outbound;agent.credentials=CredentialBroker(agent)
        module=provider_proxy if kind=='provider' else github_proxy if kind=='github' else mcp_proxy
        proxy=module.ProviderProxy(agent,port=0) if kind=='provider' else module.GitHubProxy(agent,port=0) if kind=='github' else module.MCPProxy(agent,port=0)
        if kind=='provider':
            proxy.rewrite({'provider':{'p':{'options':{'apiKey':'bot-credential-proxy:model-provider:p:cid','baseURL':'https://upstream.example/v1'}}}},[dict(integrationId='provider:p',credentialId='cid',configured=True)])
            route='/proxy/'+next(iter(proxy.providers))+'/chat/completions'
        elif kind=='github':
            boundary.snapshot={'credentialReferences':[dict(integrationId='github',credentialId='cid',configured=True)]}
            route='/github/owner/repository.git/info/refs?service=git-upload-pack'
        else:
            proxy.rewrite({'mcp':{'p':{'type':'remote','url':'https://upstream.example/api'}}},[dict(integrationId='mcp:p',credentialId='cid',configured=True)])
            proxy.begin('session','run');route=next(iter(proxy.routes))
        class Connection(module.PinnedConnection):
            def connect(self):
                # Actual local HTTP socket, fixed endpoint selected by this test.
                self.sock=socket.create_connection(upstream.server_address,timeout=1)
            def close(self):
                retiring=not self.receiving_headers
                super().close()
                if retiring:closed.set()
        proxy.start()
        try:
            with patch.object(module,'provider_endpoint',return_value=('upstream.example','/v1','8.8.8.8'),create=True), patch.object(module,'PinnedConnection',Connection), patch.object(credential_transport,'VALIDATE_SECONDS',.05), patch.object(credential_transport,'VALIDATE_TIMEOUT',.08), patch.object(credential_transport,'TOTAL_SECONDS',.18 if failure=='deadline' else 1):
                response=urlopen(Request('http://127.0.0.1:'+str(proxy.server.server_port)+route,data=None if kind=='github' else b'{}'),timeout=2)
                self.assertEqual(response.read(1),first[:1], 'safe first bytes were not forwarded')
                if failure=='revoke':valid[0]=False
                elif failure=='blocked':block[0]=True;self.assertTrue(validation_entered.wait(.5))
                elif failure=='retire':proxy.close_active()
                elif failure=='generation':boundary.identity['generation']=4
                elif failure=='run':
                    if kind=='mcp':proxy.begin('session','replacement')
                    else:boundary.get=lambda key:'session' if key=='session' else 'replacement'
                self.assertTrue(closed.wait(.7), 'blocked upstream survived its fence')
                release.set()
                output=response.read();response.close()
                self.assertNotIn(b'stale-after-fence',output)
                self.assertNotIn(b'fixture-private-token',output)
                if failure in ('revoke','blocked'):self.assertGreaterEqual(calls.count('credential.validate'),2)
                deadline=time.monotonic()+.5
                while proxy.transports and time.monotonic()<deadline:time.sleep(.01)
                self.assertFalse(proxy.transports)
                self.assertFalse(proxy.gates if kind=='github' else proxy.connections)
                self.assertIn('credential.release',calls)
        finally:
            release.set();proxy.close_active();proxy.server.shutdown();proxy.server.server_close()
            upstream.shutdown();upstream.server_close()

    def test_provider_real_stream_fences(self):
        for failure in ('revoke','blocked','retire','generation','run','deadline','expiry'):
            with self.subTest(failure=failure):self.exercise('provider',failure)

    def test_mcp_real_stream_fences(self):
        for failure in ('revoke','blocked','retire','generation','run','deadline','expiry'):
            with self.subTest(failure=failure):self.exercise('mcp',failure)

    def test_github_real_stream_fences(self):
        for failure in ('revoke','blocked','retire','generation','run','deadline','expiry'):
            with self.subTest(failure=failure):self.exercise('github',failure)
