# Linux scope retirement diagnostics

`scope.c` preserves the first **unshipped FD experiment**. It is not the production
runner: Bun's extra stdio streams dropped final receipts during integration.
`runtime/linux/process-scope.c` is the candidate Unix-socket implementation,
embedded by `install-runtime-overlays.sh`; it preserves ordinary child stdio.
Neither diagnostic passing nor compilation alone closes the deployment gate.

```sh
cc -std=c11 -O2 -Wall -Wextra -Werror runtime/linux/process-scope.c -o /tmp/core-scope
python3 tests/diagnostics/linux-process-scope/probe.py /tmp/core-scope --socket
python3 tests/diagnostics/linux-process-scope/browser.py /tmp/core-scope \
  /path/to/pinned/node_modules /path/to/pinned/ms-playwright
```

The browser probe requires exactly @playwright/cli0.1.18 with its pinned
playwright-core1.63.0-alpha-2026-08-05 and installed Chromium1237. It starts the
foreground `lib/entry/cliDaemon.js`, performs three named-session calls, verifies
stable browser identity, physically pauses/resumes the captured tree, and retires
while paused. Both Chromium crashpad processes must be adopted and gone.

The process probe exercises setsid/double-fork, descendants created by a
non-leader thread, persistent launcher exit, physical pause/resume and paused
abort. Its SIGKILL case deliberately proves that runner loss leaves a survivor;
EOF is not a confirmed-empty receipt. A test-only outer subreaper and explicit
fixture cleanup prevent this expected failure mode leaking test processes.
Production must retire its essential runtime/container on this uncertainty.

The runner never restarts Core or chooses a workspace/execution owner. Existing
Core leases retain admission until an empty-child receipt and joined child close.
The container must own loss of runtime or runner authority. Bot's existing
in-container Bun restart does not satisfy that prerequisite, so release and Bot
pins remain frozen until its separate integration is authorized and validated.
