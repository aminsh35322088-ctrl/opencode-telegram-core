"""Pinned real Playwright foreground daemon under the candidate scope runner."""
import ctypes
import json
import os
from pathlib import Path
import select
import signal
import socket
import subprocess
import sys
import tempfile
import time

scope_binary, package_root, browsers = map(Path, sys.argv[1:])
assert ctypes.CDLL(None).prctl(36, 1, 0, 0, 0) == 0  # outer test reaper only

def identity(pid):
    try:
        fields = Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()
        return {'pid': pid, 'state': fields[0], 'ppid': int(fields[1]), 'start': fields[19]}
    except FileNotFoundError: return None

def tree(parent):
    processes = {int(p.name): identity(int(p.name)) for p in Path('/proc').iterdir() if p.name.isdigit()}
    descendants = {parent}
    while True:
        added = {p for p, v in processes.items() if v and v['ppid'] in descendants}
        if added <= descendants: break
        descendants |= added
    return [processes[p] for p in sorted(descendants-{parent}) if processes[p]]

def until(check, timeout=10):
    end = time.monotonic()+timeout
    while not check():
        assert time.monotonic() < end, 'readiness/identity deadline'
        time.sleep(.005)

with tempfile.TemporaryDirectory(prefix='core-browser-scope-') as directory:
    root = Path(directory); (root/'.playwright').mkdir()
    env = {**os.environ, 'PLAYWRIGHT_BROWSERS_PATH': str(browsers.resolve()),
        'XDG_CACHE_HOME': str(root/'cache'), 'HOME': str(root/'home')}
    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    name = str(root/'control'); listener.bind(name); listener.listen(1); listener.settimeout(10)
    session = 'scope-real-browser'
    daemon = package_root/'playwright-core/lib/entry/cliDaemon.js'
    cli = package_root/'@playwright/cli/playwright-cli.js'
    proc = subprocess.Popen([str(scope_binary), 'transient', name, 'node', str(daemon), session, '--browser', 'chromium'],
        env=env, cwd=root, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    channel, _ = listener.accept(); listener.close()
    control = receipts = channel.detach()
    captured = []
    def receipt(value):
        assert select.select([receipts], [], [], 10)[0], 'missing scope receipt'
        assert os.read(receipts, 1) == value.encode()
    try:
        receipt('S')
        assert select.select([proc.stdout], [], [], 20)[0], 'daemon startup deadline'
        ready = proc.stdout.readline().decode()
        assert ready.startswith('Daemon listening on '), ready
        captured = tree(proc.pid)
        assert len(captured) >= 5, captured
        crashpad = [v for v in captured if b'chrome_crashpad_handler' in Path(f"/proc/{v['pid']}/cmdline").read_bytes()]
        assert crashpad and all(v['ppid'] == proc.pid for v in crashpad), 'escaped crashpad must be adopted by scope'
        browser_pid = next(v['pid'] for v in captured if b'--remote-debugging-pipe' in Path(f"/proc/{v['pid']}/cmdline").read_bytes())
        outputs = []
        for args in [('goto', 'data:text/html,<title>owned-browser</title><h1>scope</h1>'), ('snapshot',), ('snapshot',)]:
            result = subprocess.run(['node', str(cli), '-s='+session, *args], cwd=root, env=env,
                capture_output=True, timeout=20)
            assert result.returncode == 0, result.stderr.decode()+result.stdout.decode()
            assert identity(browser_pid)['start'] == next(v['start'] for v in captured if v['pid'] == browser_pid)
            outputs.append(result.stdout.decode()[:1000])
        captured = tree(proc.pid)
        os.write(control, b'P'); receipt('P')
        assert all(identity(v['pid'])['state'] in ('T', 't') for v in captured), 'pause receipt left a running browser process'
        os.write(control, b'R'); receipt('R')
        until(lambda: all(identity(v['pid'])['state'] not in ('T', 't') for v in captured))
        os.write(control, b'P'); receipt('P')
        os.write(control, b'K'); receipt('D'); proc.wait(10)
        assert all(identity(v['pid']) is None or identity(v['pid'])['start'] != v['start'] for v in captured), 'confirmed retirement retained browser identity'
        print(json.dumps({'pinned_cli': '0.1.18', 'pinned_playwright': '1.63.0-alpha-2026-08-05',
            'processes': len(captured), 'adopted_crashpad': len(crashpad), 'persistent_calls': 3,
            'paused_all_captured_processes': True, 'paused_retirement_confirmed_empty': True,
            'captured_identities': captured, 'outputs': outputs}, indent=2))
    finally:
        if proc.poll() is None:
            try: os.write(control, b'K'); proc.wait(6)
            except (BrokenPipeError, subprocess.TimeoutExpired): proc.kill(); proc.wait(5)
        for value in captured:
            current = identity(value['pid'])
            if current and current['start'] == value['start']:
                os.kill(value['pid'], signal.SIGKILL)
        while True:
            try: os.waitpid(-1, 0)
            except ChildProcessError: break
        os.close(control)
