#!/usr/bin/env python3
"""Offline UID1000 image toolchain/media/Chromium smoke. No credential reads."""
import json
import argparse
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def run(*args, **kwargs):
    timeout = kwargs.pop('timeout', 90)
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=timeout, **kwargs).stdout.strip()


parser = argparse.ArgumentParser()
parser.add_argument('--tools-only', action='store_true', help='Browser process must be owned by native Core browser capability')
parser.add_argument('--online', action='store_true', help='Run the three fixed public dependency/repository network operations')
options = parser.parse_args()
if options.online and not options.tools_only:
    parser.error('--online requires --tools-only')
assert os.getuid() == 1000, 'run this smoke as the Core UID1000'
tools = ['node', 'npm', 'npx', 'python3', 'pip3', 'git', 'gcc', 'g++', 'make', 'pkg-config',
         'sqlite3', 'jq', 'rg', 'fd', 'curl', 'wget', 'zip', 'unzip', 'rsync', 'ssh', 'scp',
         'sftp', 'gh', 'ffmpeg', 'convert', 'playwright-cli', 'lsof', 'bash', 'find', 'timeout']
for tool in tools:
    assert shutil.which(tool), tool + ' missing'
assert run('node', '--version').startswith('v22.')
assert run('playwright-cli', '--version') == '0.1.18'
run('git', 'lfs', 'version')
run('gh', '--version')
run('pip3', '--version')
run('lsof', '-p', str(os.getpid()))
run('ssh', '-V')
assert not Path('/usr/local/bin/tailscaled').exists(), 'Worker must not own a VPN daemon'
assert not os.access('/opt/ms-playwright', os.W_OK), 'browser artifacts must be immutable to Core'
with tempfile.TemporaryDirectory(prefix='worker-runtime-smoke-') as tmp:
    root = Path(tmp)
    run('python3', '-m', 'venv', str(root / 'venv'))
    run(str(root / 'venv/bin/python'), '-m', 'pip', '--version')
    (root / 'probe.c').write_text('#include <sqlite3.h>\nint main(void){return sqlite3_libversion_number()<3000000;}\n')
    run('gcc', str(root / 'probe.c'), '-lsqlite3', '-o', str(root / 'probe'))
    run(str(root / 'probe'))
    (root / 'probe.cpp').write_text('#include <iostream>\nint main(){std::cout<<"cpp-ok";}\n')
    run('g++', str(root / 'probe.cpp'), '-o', str(root / 'probe-cpp'))
    assert run(str(root / 'probe-cpp')) == 'cpp-ok'
    assert run('sqlite3', str(root / 'probe.sqlite'), 'create table t(v); insert into t values(42); select v from t;') == '42'
    (root / 'package.json').write_text(json.dumps({'name': 'offline-smoke', 'version': '1.0.0',
        'scripts': {'test': 'node -e "console.log(42)"'}}))
    assert '42' in run('npm', 'test', cwd=tmp)
    run('npx', '--no-install', '--version')
    run('convert', '-size', '16x16', 'xc:blue', str(root / 'image.png'))
    assert run('identify', '-format', '%wx%h', str(root / 'image.png')) == '16x16'
    run('ffmpeg', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=16x16:d=0.1', '-threads', '1', str(root / 'media.mp4'))
    assert (root / 'media.mp4').stat().st_size > 0
    (root / 'source').mkdir()
    (root / 'source/file.txt').write_text('transfer-ok')
    repository = root / 'offline-repo'
    repository.mkdir()
    run('git', 'init', '-q', str(repository))
    (repository / 'README.md').write_text('offline-owned-commit\n')
    run('git', '-C', str(repository), 'add', 'README.md')
    run('git', '-C', str(repository), '-c', 'user.name=Worker Smoke', '-c', 'user.email=worker-smoke@example.invalid', 'commit', '-qm', 'Offline fixture')
    assert run('git', '-C', str(repository), 'show', 'HEAD:README.md') == 'offline-owned-commit'
    run('rsync', '-a', str(root / 'source') + '/', str(root / 'destination'))
    assert (root / 'destination/file.txt').read_text() == 'transfer-ok'
    run('zip', '-q', str(root / 'archive.zip'), 'file.txt', cwd=str(root / 'source'))
    run('unzip', '-q', str(root / 'archive.zip'), '-d', str(root / 'unpacked'))
    assert (root / 'unpacked/file.txt').read_text() == 'transfer-ok'
    class Peer(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass
        def do_GET(self):
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'offline-http-ok')
    peer = ThreadingHTTPServer(('127.0.0.1', 0), Peer)
    threading.Thread(target=peer.serve_forever, daemon=True).start()
    try:
        url = 'http://127.0.0.1:' + str(peer.server_port)
        assert run('curl', '-fsS', url) == 'offline-http-ok'
        assert run('wget', '-qO-', url) == 'offline-http-ok'
    finally:
        peer.shutdown()
        peer.server_close()
    # Exercise actual installed Chromium as UID1000, independent of Core routing.
    browser = '''const {createRequire} = require('module');
const r = createRequire('/usr/local/lib/node_modules/@playwright/cli/package.json');
if (r('playwright-core/package.json').version !== '1.63.0-alpha-2026-08-05') throw Error('unpinned runtime');
(async()=>{const b=await r('playwright-core').chromium.launch({headless:true,channel:'chromium'});
try {const p=await b.newPage();await p.setContent('<title>worker-smoke</title><h1>Browser works</h1>');
if(await p.title()!=='worker-smoke')throw Error('browser title mismatch');
await p.screenshot({path:process.argv[1]});}finally{await b.close();}})().catch(e=>{console.error(e.message);process.exit(1)});'''
    if not options.tools_only:
        run('node', '-e', browser, str(root / 'browser.png'))
        assert (root / 'browser.png').stat().st_size > 0
    if options.online:
        home = root / 'network-home'
        home.mkdir()
        network_env = {'PATH': '/usr/local/bin:/usr/bin:/bin', 'LANG': 'C.UTF-8', 'HOME': str(home),
            'XDG_CONFIG_HOME': str(home / 'config'), 'XDG_CACHE_HOME': str(home / 'cache'),
            'npm_config_cache': str(home / 'npm-cache'), 'npm_config_userconfig': '/dev/null',
            'npm_config_globalconfig': '/dev/null', 'npm_config_registry': 'https://registry.npmjs.org',
            'npm_config_strict_ssl': 'true', 'PIP_CONFIG_FILE': '/dev/null', 'PIP_CACHE_DIR': str(home / 'pip-cache'),
            'PIP_DISABLE_PIP_VERSION_CHECK': '1', 'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null',
            'GIT_TERMINAL_PROMPT': '0'}
        project = root / 'network-npm'
        project.mkdir()
        (project / 'package.json').write_text('{"name":"fixed-network-smoke","version":"1.0.0","private":true}')
        run('npm', 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--fetch-retries=0',
            '--fetch-timeout=10000', 'is-number@7.0.0', cwd=str(project), env=network_env, timeout=30)
        assert json.loads((project / 'node_modules/is-number/package.json').read_text())['version'] == '7.0.0'
        python = str(root / 'venv/bin/python')
        run(python, '-m', 'pip', 'install', '--no-deps', '--only-binary=:all:', '--no-input',
            '--disable-pip-version-check', '--index-url', 'https://pypi.org/simple', '--timeout', '10',
            '--retries', '0', 'six==1.17.0', env=network_env, timeout=30)
        run(python, '-c', "import six; assert six.__version__ == '1.17.0'", env=network_env)
        public_clone = root / 'public-clone'
        run('git', '-c', 'credential.helper=', '-c', 'core.askPass=', 'clone', '--depth=1',
            'https://github.com/octocat/Hello-World.git', str(public_clone), env=network_env, timeout=30)
        assert run('git', '-C', str(public_clone), 'remote', 'get-url', 'origin', env=network_env) == 'https://github.com/octocat/Hello-World.git'
        run('git', '-C', str(public_clone), 'rev-parse', '--verify', 'HEAD', env=network_env)
proof = {'version': 1, 'profile': 'network' if options.online else ('baseline' if options.tools_only else 'standalone-browser'),
                  'uid': 1000, 'node': 22, 'toolchain': True, 'pythonVenv': True, 'sqlite': True,
                  'transfer': True, 'media': True, 'chromium': not options.tools_only}
if options.online:
    proof.update(externalNetworkOperations=['npm.install', 'pip.install', 'git.clone'], npmDependency='is-number@7.0.0',
                 pipDependency='six==1.17.0', publicClone='https://github.com/octocat/Hello-World.git')
else:
    proof['externalRequests'] = 0
print(json.dumps(proof))
