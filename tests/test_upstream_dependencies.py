"""Locked runtime installs must not fetch retired workspace preview packages."""
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

ROOT = Path(__file__).resolve().parents[1]

class UpstreamDependencyTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which('bun'), 'Bun is required')
    def test_locked_install_retains_transitive_runtime_and_sdk_without_unused_preview(self):
        requests = []; expired = False
        class Peer(BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def do_GET(self):
                requests.append(self.path)
                if expired and self.path == '/unused.tgz':
                    self.send_error(404); return
                name = {'/unused.tgz': 'fixture-unused', '/retained.tgz': 'fixture-retained',
                        '/sdk.tgz': 'fixture-sdk-dependency'}[self.path]
                blob = io.BytesIO()
                with tarfile.open(fileobj=blob, mode='w:gz') as archive:
                    for file, content in {'package/package.json': json.dumps({'name': name, 'version': '1.0.0',
                            'type': 'module', 'exports': './index.js'}), 'package/index.js': 'export const value=42'}.items():
                        raw = content.encode(); info = tarfile.TarInfo(file); info.size = len(raw)
                        archive.addfile(info, io.BytesIO(raw))
                raw = blob.getvalue(); self.send_response(200)
                self.send_header('content-length', str(len(raw))); self.end_headers(); self.wfile.write(raw)
        peer = HTTPServer(('127.0.0.1', 0), Peer)
        thread = threading.Thread(target=peer.serve_forever, daemon=True); thread.start()
        try:
            with tempfile.TemporaryDirectory(prefix='core-locked-install-') as tmp:
                root = Path(tmp); base = f'http://127.0.0.1:{peer.server_port}'
                packages = {
                    '': {'name': 'fixture-root', 'private': True, 'workspaces': ['packages/*', 'packages/sdk/js']},
                    'packages/opencode': {'name': 'fixture-runtime', 'version': '1.0.0',
                        'dependencies': {'fixture-helper': 'workspace:*'}},
                    'packages/helper': {'name': 'fixture-helper', 'version': '1.0.0', 'type': 'module',
                        'exports': './index.js', 'dependencies': {'fixture-retained': base + '/retained.tgz'}},
                    'packages/sdk/js': {'name': 'fixture-sdk', 'version': '1.0.0', 'type': 'module',
                        'exports': './index.js', 'dependencies': {'fixture-sdk-dependency': base + '/sdk.tgz'}},
                    'packages/console': {'name': 'fixture-console', 'version': '1.0.0',
                        'dependencies': {'fixture-unused': base + '/unused.tgz'}},
                }
                for folder, pkg in packages.items():
                    directory = root / folder; directory.mkdir(parents=True, exist_ok=True)
                    (directory / 'package.json').write_text(json.dumps(pkg))
                (root / 'packages/helper/index.js').write_text('export {value} from "fixture-retained"')
                (root / 'packages/sdk/js/index.js').write_text('export {value} from "fixture-sdk-dependency"')
                bun = shutil.which('bun')
                initial = subprocess.run([bun, 'install', '--cache-dir', str(root / 'initial-cache')],
                    cwd=root, text=True, capture_output=True, timeout=30)
                self.assertEqual(initial.returncode, 0, initial.stderr)
                locked = (root / 'bun.lock').read_bytes()
                # This is disposable fixture output, never a repository cleanup.
                for folder in packages:
                    modules = root / folder / 'node_modules'
                    if modules.exists(): shutil.rmtree(modules)
                expired = True; requests.clear()
                env = dict(os.environ, BUN_INSTALL_CACHE_DIR=str(root / 'filtered-cache'))
                installed = subprocess.run(['bash', '-c', 'source "$1"; install_upstream_dependencies "$2" "$3"',
                    'fixture', str(ROOT / 'scripts/common.sh'), str(root), bun],
                    cwd=root, env=env, text=True, capture_output=True, timeout=30)
                self.assertEqual(installed.returncode, 0, installed.stderr)
                self.assertNotIn('/unused.tgz', requests)
                self.assertIn('/retained.tgz', requests)
                self.assertIn('/sdk.tgz', requests)
                self.assertEqual((root / 'bun.lock').read_bytes(), locked)
                for directory, module in [('packages/opencode', 'fixture-helper'),
                                          ('packages/opencode', 'fixture-sdk'),
                                          ('packages/sdk/js', 'fixture-sdk-dependency')]:
                    consumed = subprocess.run([bun, '-e', f'import {{value}} from "{module}"; console.log(value)'],
                        cwd=root / directory, text=True, capture_output=True, timeout=15)
                    self.assertEqual(consumed.returncode, 0, consumed.stderr)
                    self.assertEqual(consumed.stdout.strip(), '42')
        finally:
            peer.shutdown(); peer.server_close(); thread.join(3)
