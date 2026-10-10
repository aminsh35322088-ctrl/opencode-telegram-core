"""Private bounded transport fence for root credential consumers."""
import socket
import threading
import time

TOTAL_SECONDS = 55
VALIDATE_SECONDS = 2
VALIDATE_TIMEOUT = 2


class LeaseTransport:
    def __init__(self, lease, connection, owner, *, lifetime=None, interval=None, validation_timeout=None, downstream=None):
        self.lease, self.connection, self.owner = lease, connection, owner
        self.downstream = downstream
        self.deadline = time.monotonic() + (TOTAL_SECONDS if lifetime is None else lifetime)
        self.interval = VALIDATE_SECONDS if interval is None else interval
        self.validation_timeout = VALIDATE_TIMEOUT if validation_timeout is None else validation_timeout
        self.closed = threading.Event()
        self.condition = threading.Condition(threading.RLock())
        self.validation_lock = threading.RLock()
        self.validating = False
        self.validation_started = 0
        self.next_validation = time.monotonic() + self.interval
        threading.Thread(target=self._watch, daemon=True).start()

    def _valid(self):
        try:
            return (not self.closed.is_set() and time.monotonic() < self.deadline and self.owner()
                    and (not self.lease or self.lease.current()))
        except Exception:
            return False

    def _validate(self):
        try:
            self.lease.consume(lambda _: None)
            with self.validation_lock:
                if not self._valid():raise ValueError()
                self.validating = False
                self.next_validation = time.monotonic() + self.interval
        except Exception:
            self.close()

    def _watch(self):
        while not self.closed.wait(.02):
            if not self._valid():
                self.close();return
            with self.validation_lock:
                now = time.monotonic()
                overdue = self.validating and now - self.validation_started >= self.validation_timeout
                if self.lease and not self.validating and now >= self.next_validation:
                    self.validating = True
                    self.validation_started = now
                    threading.Thread(target=self._validate, daemon=True).start()
            if overdue:
                self.close();return

    def forward(self, callback):
        """Gate every header/body write, including while CP validation is pending."""
        with self.condition:
            while self._valid():
                with self.validation_lock:validating = self.validating
                if not validating:break
                self.condition.wait(.02)
            if not self._valid():raise ValueError('credential transport retired')
            return callback()

    def close(self):
        if self.closed.is_set():return
        self.closed.set()
        # Discard before potentially blocking network work. Late CP replies can
        # never resurrect material or admit another write on this transport.
        if self.lease:self.lease.discard()
        try:
            self.connection.close()
        finally:
            if self.downstream:
                try:self.downstream.shutdown(socket.SHUT_RDWR)
                except OSError:pass
            # Gate waiters poll closed at 20 ms; retirement must never wait
            # for a gate callback blocked in DNS/network establishment.
            if self.lease:threading.Thread(target=self.lease.release, daemon=True).start()
