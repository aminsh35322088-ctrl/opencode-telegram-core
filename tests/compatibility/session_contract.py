#!/usr/bin/env python3
import argparse
import base64
import contextlib
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request

BINARY = None


def free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class HttpError(RuntimeError):
    pass


def isolated_environment(root):
    env = {}
    for key in ("PATH", "LANG", "LC_ALL", "SHELL", "TZ"):
        value = os.environ.get(key)
        if value:
            env[key] = value
    for key, name in {
        "HOME": "home",
        "XDG_DATA_HOME": "data",
        "XDG_CONFIG_HOME": "config",
        "XDG_STATE_HOME": "state",
        "XDG_CACHE_HOME": "cache",
    }.items():
        value = root / name
        value.mkdir(parents=True, exist_ok=True)
        env[key] = str(value)
    env["NO_COLOR"] = "1"
    return env


class Server:
    def __init__(self, binary, readiness_path="/api/session", configure=None, pass_fds=()):
        self.binary = Path(binary).resolve()
        self.readiness_path = readiness_path
        self.configure = configure
        self.pass_fds = pass_fds
        self.headers = {}
        self.temp = None
        self.process = None
        self.base = None
        self.stdout = ""
        self.stderr = ""

    def __enter__(self):
        self.temp = tempfile.TemporaryDirectory(prefix="opencode-core-compat-")
        root = Path(self.temp.name)
        env = isolated_environment(root)
        if self.configure:
            self.configure(root, env)
        if env.get('OPENCODE_SERVER_PASSWORD'):
            token = base64.b64encode((env.get('OPENCODE_SERVER_USERNAME', 'opencode') + ':' + env['OPENCODE_SERVER_PASSWORD']).encode()).decode()
            self.headers['authorization'] = 'Basic ' + token
        port = free_port()
        self.base = f"http://127.0.0.1:{port}"
        self.process = subprocess.Popen(
            [str(self.binary), "serve", "--hostname", "127.0.0.1", "--port", str(port)],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=env,
            pass_fds=self.pass_fds,
        )
        deadline = time.monotonic() + 15
        last_error = None
        while time.monotonic() < deadline:
            if self.process.poll() is not None:
                break
            try:
                with urllib.request.urlopen(urllib.request.Request(self.base + self.readiness_path, headers=self.headers), timeout=0.5) as response:
                    if response.status == 200:
                        return self
            except Exception as exc:
                last_error = exc
                time.sleep(0.05)
        self.close()
        raise RuntimeError(
            f"server failed to start: {last_error}\nstdout={self.stdout}\nstderr={self.stderr}"
        )

    def close(self):
        if self.process is not None and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)
        if self.process is not None:
            out, err = self.process.communicate(timeout=1)
            self.stdout += out
            self.stderr += err
        if self.temp is not None:
            self.temp.cleanup()
            self.temp = None

    def __exit__(self, exc_type, exc, tb):
        self.close()


class Client:
    def __init__(self, base):
        self.base = base.rstrip("/")

    def request(self, method, path, body=None, timeout=5):
        data = None if body is None else json.dumps(body).encode()
        headers = {"content-type": "application/json"} if body is not None else {}
        request = urllib.request.Request(
            self.base + path,
            data=data,
            method=method,
            headers=headers,
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                raw = response.read()
                if not raw:
                    return None
                return json.loads(raw)
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode(errors="replace")
            raise HttpError(f"{method} {path} -> {exc.code}: {raw}") from exc

    def create_session(self):
        return self.request("POST", "/api/session", {})["data"]

    def list_sessions(self):
        return self.request("GET", "/api/session")["data"]

    def get_session(self, session_id):
        return self.request("GET", f"/api/session/{session_id}")["data"]

    def context(self, session_id):
        return self.request("GET", f"/api/session/{session_id}/context")["data"]

    def interrupt(self, session_id):
        return self.request("POST", f"/api/session/{session_id}/interrupt")

    def prompt_without_resume(self, session_id, text):
        payload = {"prompt": {"text": text}, "resume": False}
        return self.request("POST", f"/api/session/{session_id}/prompt", payload)["data"]

    def history(self, session_id, after=None, limit=None):
        query = {}
        if after is not None:
            query["after"] = after
        if limit is not None:
            query["limit"] = limit
        suffix = "?" + urllib.parse.urlencode(query) if query else ""
        return self.request("GET", f"/api/session/{session_id}/history{suffix}")

    def sse_one(self, session_id, after=None, timeout=5):
        query = "" if after is None else "?" + urllib.parse.urlencode({"after": after})
        request = urllib.request.Request(
            self.base + f"/api/session/{session_id}/event{query}",
            headers={"accept": "text/event-stream"},
        )
        with urllib.request.urlopen(request, timeout=timeout) as response:
            data_lines = []
            while True:
                line = response.readline().decode("utf-8")
                if line == "":
                    raise RuntimeError("SSE stream closed before an event")
                line = line.rstrip("\r\n")
                if line == "":
                    if data_lines:
                        return json.loads("\n".join(data_lines))
                    continue
                if line.startswith("data:"):
                    data_lines.append(line[5:].lstrip())


def durable_identity(event):
    durable = event.get("durable")
    if not isinstance(durable, dict):
        raise AssertionError(f"event missing durable identity: {event}")
    aggregate = durable.get("aggregateID")
    seq = durable.get("seq")
    if not isinstance(aggregate, str) or not isinstance(seq, int):
        raise AssertionError(f"invalid durable identity: {event}")
    return aggregate, seq


class HarnessIsolationTests(unittest.TestCase):
    def test_server_environment_does_not_inherit_provider_secret(self):
        key = "SENTINEL_PROVIDER_API_KEY"
        previous = os.environ.get(key)
        os.environ[key] = "must-not-leak"
        try:
            with tempfile.TemporaryDirectory() as td:
                env = isolated_environment(Path(td))
            self.assertNotIn(key, env)
        finally:
            if previous is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = previous


class SessionContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = Server(BINARY).__enter__()
        cls.client = Client(cls.server.base)

    @classmethod
    def tearDownClass(cls):
        cls.server.__exit__(None, None, None)

    def test_session_lifecycle(self):
        session = self.client.create_session()
        self.assertEqual(self.client.get_session(session["id"])["id"], session["id"])
        self.assertIn(session["id"], {item["id"] for item in self.client.list_sessions()})

    def test_idle_interrupt_is_safe(self):
        session = self.client.create_session()
        self.assertIsNone(self.client.interrupt(session["id"]))

    def test_context_is_list(self):
        session = self.client.create_session()
        self.assertIsInstance(self.client.context(session["id"]), list)

    def test_history_after_is_exclusive(self):
        session = self.client.create_session()
        self.client.prompt_without_resume(session["id"], "first")
        self.client.prompt_without_resume(session["id"], "second")
        history = self.client.history(session["id"])["data"]
        self.assertGreaterEqual(len(history), 2)
        _, first_seq = durable_identity(history[0])
        page = self.client.history(session["id"], after=first_seq)["data"]
        self.assertTrue(page)
        for event in page:
            aggregate, seq = durable_identity(event)
            self.assertEqual(aggregate, session["id"])
            self.assertGreater(seq, first_seq)

    def test_session_stream_isolation(self):
        a = self.client.create_session()
        b = self.client.create_session()
        self.client.prompt_without_resume(a["id"], "event-a")
        self.client.prompt_without_resume(b["id"], "event-b")

        event_a = self.client.sse_one(a["id"], after=0)
        event_b = self.client.sse_one(b["id"], after=0)
        self.assertEqual(durable_identity(event_a)[0], a["id"])
        self.assertEqual(durable_identity(event_b)[0], b["id"])

        for event in self.client.history(a["id"])["data"]:
            self.assertEqual(durable_identity(event)[0], a["id"])
        for event in self.client.history(b["id"])["data"]:
            self.assertEqual(durable_identity(event)[0], b["id"])

    def test_reconnect_cursor_is_exclusive(self):
        session = self.client.create_session()
        self.client.prompt_without_resume(session["id"], "one")
        first = self.client.sse_one(session["id"], after=0)
        _, first_seq = durable_identity(first)

        self.client.prompt_without_resume(session["id"], "two")
        second = self.client.sse_one(session["id"], after=first_seq)
        aggregate, second_seq = durable_identity(second)
        self.assertEqual(aggregate, session["id"])
        self.assertGreater(second_seq, first_seq)

    def test_reconnect_from_empty_history(self):
        session = self.client.create_session()
        self.assertEqual(self.client.history(session["id"], after=0)["data"], [])

        result = {}
        thread = threading.Thread(
            target=lambda: result.setdefault(
                "event", self.client.sse_one(session["id"], after=0, timeout=5)
            )
        )
        thread.start()
        self.client.prompt_without_resume(session["id"], "first-live")
        thread.join(timeout=6)
        self.assertFalse(thread.is_alive(), "SSE reconnect from empty history stalled")
        self.assertEqual(durable_identity(result["event"])[0], session["id"])

    def test_two_session_streams_progress_concurrently(self):
        a = self.client.create_session()
        b = self.client.create_session()
        results = {}
        errors = []

        def read(name, session_id):
            try:
                results[name] = self.client.sse_one(session_id, after=0, timeout=5)
            except Exception as exc:
                errors.append(exc)

        ta = threading.Thread(target=read, args=("a", a["id"]))
        tb = threading.Thread(target=read, args=("b", b["id"]))
        ta.start()
        tb.start()
        self.client.prompt_without_resume(a["id"], "concurrent-a")
        self.client.prompt_without_resume(b["id"], "concurrent-b")
        ta.join(timeout=6)
        tb.join(timeout=6)

        self.assertFalse(ta.is_alive(), "Session A stream stalled")
        self.assertFalse(tb.is_alive(), "Session B stream stalled")
        self.assertEqual(errors, [])
        self.assertEqual(durable_identity(results["a"])[0], a["id"])
        self.assertEqual(durable_identity(results["b"])[0], b["id"])

    def test_server_cleanup_after_assertion_exception(self):
        probe = Server(BINARY)
        with self.assertRaises(AssertionError):
            with probe:
                self.assertIsNone(probe.process.poll())
                raise AssertionError("deliberate cleanup probe")
        self.assertIsNotNone(probe.process.poll())


def main():
    global BINARY
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--binary", required=True)
    args, remaining = parser.parse_known_args()
    BINARY = args.binary
    if not Path(BINARY).is_file():
        raise SystemExit(f"binary not found: {BINARY}")
    unittest.main(argv=["session_contract.py", *remaining], verbosity=2)


if __name__ == "__main__":
    main()
