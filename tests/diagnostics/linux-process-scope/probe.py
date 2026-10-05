"""Real Linux process experiment. This runner is deliberately not shipped."""
import json
import os
import pathlib
import select
import signal
import socket
import subprocess
import sys
import tempfile
import time

BINARY = sys.argv[1]
SOCKET = '--socket' in sys.argv[2:]
DAEMON = r'''
import os, pathlib, time, threading
root = pathlib.Path(os.environ['PROBE_ROOT'])
def start():
    if os.fork() == 0:
        os.setsid()
        if os.fork() != 0: os._exit(0)
        (root/'pid').write_text(str(os.getpid()))
        n = 0
        while True:
            n += 1; (root/'ticks').write_text(str(n)); time.sleep(.01)
    while not (root/'ticks').exists(): time.sleep(.001)
# Exercise children created by a non-leader thread too.
t = threading.Thread(target=start); t.start(); t.join()
if os.environ.get('KEEP_ROOT') == '1':
    while True: time.sleep(1)
'''

def until(check, timeout=5):
    end = time.monotonic()+timeout
    while not check():
        if time.monotonic() > end: raise AssertionError('deterministic readiness/death deadline')
        time.sleep(.005)

def alive(pid):
    return pathlib.Path('/proc', str(pid)).exists()

class Scope:
    def __init__(self, directory, mode, keep=False):
        self.directory = pathlib.Path(directory)
        env = {**os.environ, 'PROBE_ROOT': directory, 'KEEP_ROOT': '1' if keep else '0'}
        if SOCKET:
            listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            name = str(self.directory/'control'); listener.bind(name); listener.listen(1); listener.settimeout(5)
            self.process = subprocess.Popen([BINARY, mode, name, sys.executable, '-c', DAEMON],
                env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            channel, _ = listener.accept(); listener.close()
            self.control = self.receipts = channel.detach()
        else:
            control, self.control = os.pipe()
            self.receipts, receipts = os.pipe()
            def setup():
                os.dup2(control, 3, inheritable=True)
                os.dup2(receipts, 4, inheritable=True)
                os.set_inheritable(3, True)
                os.set_inheritable(4, True)
            self.process = subprocess.Popen([BINARY, mode, sys.executable, '-c', DAEMON],
                env=env, close_fds=False, preexec_fn=setup, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            os.close(control); os.close(receipts)
        self.receipt('S')
        until(lambda: (self.directory/'pid').exists())
        self.pid = int((self.directory/'pid').read_text())

    def receipt(self, value):
        assert select.select([self.receipts], [], [], 6)[0], 'missing retirement/transition receipt'
        got = os.read(self.receipts, 1)
        assert got == value.encode(), (value, got, self.process.poll())

    def command(self, value):
        os.write(self.control, value.encode())

    def empty(self):
        self.receipt('D')
        self.process.wait(6)
        assert not alive(self.pid), 'successful retirement left a descendant'

    def close(self):
        if self.process.poll() is None:
            self.command('K'); self.empty()
        if alive(self.pid):
            os.kill(self.pid, signal.SIGKILL)
            os.waitpid(self.pid, 0)
            assert not alive(self.pid)
        os.close(self.control)
        if self.control != self.receipts: os.close(self.receipts)

def run(name, mode, exercise, keep=False):
    with tempfile.TemporaryDirectory(prefix='core-scope-') as directory:
        scope = Scope(directory, mode, keep)
        try: exercise(scope)
        finally: scope.close()
    return {'case': name, 'passed': True}

def persistent(scope):
    time.sleep(.1)
    assert alive(scope.pid) and scope.process.poll() is None
    scope.command('K'); scope.empty()

def paused(scope):
    scope.command('P'); scope.receipt('P')
    before = (scope.directory/'ticks').read_text()
    time.sleep(.15)
    assert (scope.directory/'ticks').read_text() == before
    scope.command('R'); scope.receipt('R')
    until(lambda: (scope.directory/'ticks').read_text() != before)
    scope.command('P'); scope.receipt('P')
    scope.command('K'); scope.empty()

def loss(scope):
    os.kill(scope.process.pid, signal.SIGKILL); scope.process.wait(5)
    assert os.read(scope.receipts, 1) == b'', 'authority loss must not claim retirement'
    assert alive(scope.pid), 'scope loss experiment unexpectedly contained by another boundary'
    # The production boundary must retire the container here. This local harness
    # explicitly kills/reaps the fixture; it does not pretend runner loss is safe.

if __name__ == '__main__':
    import ctypes
    assert ctypes.CDLL(None).prctl(36, 1, 0, 0, 0) == 0  # test-only outer reaper
    results = [
        run('transient success retires setsid/double-fork', 'transient', lambda s: s.empty()),
        run('persistent authority survives launcher exit', 'persistent', persistent),
        run('escaped adopted descendant pause/resume/paused abort', 'persistent', paused),
        run('non-leader-thread descendants pause and retire', 'persistent', paused, keep=True),
        run('scope SIGKILL yields EOF and leaves survivor requiring container retirement', 'persistent', loss),
    ]
    print(json.dumps(results, indent=2))
