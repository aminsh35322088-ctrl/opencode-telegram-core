#!/usr/bin/env python3
"""Exercise the actual Telegram compiled artifact, including forbidden surfaces."""
import argparse
import json
import os
import sqlite3
from pathlib import Path
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request
from session_contract import Server, Client

BINARY = None

class TelegramSurface(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = Server(BINARY, readiness_path="/global/health")
        # The production readiness probe is legacy /global/health, not v2 /api/session.
        cls.server.__enter__()
        cls.client = Client(cls.server.base)

    @classmethod
    def tearDownClass(cls):
        cls.server.__exit__(None, None, None)

    def test_authentication_has_no_pty_ticket_or_public_ui_bypass(self):
        def configure(root, env): env['OPENCODE_SERVER_PASSWORD'] = 'compiled-auth-fixture'
        with Server(BINARY, readiness_path='/global/health', configure=configure) as server:
            for path in ['/global/health', '/config', '/session', '/event?ticket=fake']:
                with self.subTest(path=path):
                    with self.assertRaises(urllib.error.HTTPError) as caught:
                        urllib.request.urlopen(server.base + path, timeout=5)
                    self.assertEqual(caught.exception.code, 401)
            request = urllib.request.Request(server.base + '/config', headers=server.headers)
            with urllib.request.urlopen(request, timeout=15) as response: self.assertEqual(response.status, 200)

    def test_persisted_console_organization_fails_closed(self):
        with Server(BINARY, readiness_path='/global/health') as server:
            paths = list(Path(server.temp.name).rglob('opencode*.db'))
            self.assertEqual(len(paths), 1)
            with sqlite3.connect(paths[0]) as db:
                db.execute("INSERT INTO account(id,email,url,access_token,refresh_token,time_created,time_updated) VALUES('fixture','fixture@example.invalid','https://example.invalid','unused','unused',0,0)")
                db.execute("INSERT OR REPLACE INTO account_state(id,active_account_id,active_org_id) VALUES(1,'fixture','unsupported-org')")
            with self.assertRaises(urllib.error.HTTPError) as caught:
                urllib.request.urlopen(server.base + '/config', timeout=15)
            self.assertEqual(caught.exception.code, 400)
            self.assertIn('Console organization integration is unavailable', caught.exception.read().decode())

    def test_unused_process_and_server_surfaces_fail_closed(self):
        for method, path, body in [
            ('GET', '/pty', None), ('POST', '/pty', {}),
            ('GET', '/api/pty', None), ('GET', '/api/session', None),
            ('GET', '/tui/control/next', None), ('POST', '/tui/append-prompt', {'text': 'x'}),
            ('GET', '/experimental/worktree', None), ('GET', '/experimental/workspace', None),
            ('GET', '/file?path=.', None), ('GET', '/find/file?query=x', None),
            ('GET', '/provider', None), ('POST', '/global/upgrade', {}),
            ('GET', '/doc', None), ('GET', '/', None), ('GET', '/lsp', None),
            ('POST', '/mcp/nonexistent/auth/authenticate', {}),
            ('GET', '/session/unused/execution', None), ('POST', '/session/unused/pause', {'runId': 'unused'}),
            ('POST', '/session/unused/resume', {'runId': 'unused'}),
        ]:
            with self.subTest(method=method, path=path):
                data = None if body is None else json.dumps(body).encode()
                request = urllib.request.Request(self.server.base + path, data=data, method=method,
                                                 headers={'content-type': 'application/json'})
                with self.assertRaises(urllib.error.HTTPError) as caught:
                    urllib.request.urlopen(request, timeout=10)
                self.assertEqual(caught.exception.code, 404)

    def test_required_catalog_and_interaction_routes_exist(self):
        for path in ['/global/health', '/config', '/config/providers', '/path', '/project',
                     '/agent', '/skill', '/command', '/mcp', '/permission', '/question']:
            with self.subTest(path=path):
                self.assertIsNotNone(self.client.request('GET', path, timeout=15))

    def test_topic_sessions_and_execution_control_survive(self):
        one = self.client.request('POST', '/session', {'title': 'Telegram topic one'})
        two = self.client.request('POST', '/session', {'title': 'Telegram topic two'})
        self.assertNotEqual(one['id'], two['id'])
        for session in [one, two]:
            sid = session['id']
            self.assertEqual(self.client.request('GET', '/session/' + sid)['title'], session['title'])
            self.assertEqual(self.client.request('GET', '/session/' + sid + '/message'), [])
            self.assertEqual(self.client.request('POST', '/session/' + sid + '/abort'), True)
            self.assertEqual(self.client.request('DELETE', '/session/' + sid), True)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--binary', required=True)
    args, rest = parser.parse_known_args()
    BINARY = args.binary
    unittest.main(argv=[__file__, *rest])
