# Linux process-scope retirement diagnostics

These probes study process-tree retirement for the compiled runtime and persistent browser helper. They distinguish diagnostic experiments from the candidate Unix-socket scope runner used by the production build. None of the probes alone proves full deployment crash containment. See the Core root README and docs/BOT_CONTAINMENT_PREREQUISITE.md.

## Implementations under comparison

- scope.c preserves the first unshipped FD experiment. Bun's extra stdio streams dropped final receipts during integration, so it is not the production runner.
- runtime/linux/process-scope.c is the candidate Unix-socket implementation embedded by scripts/install-runtime-overlays.sh. It preserves ordinary child stdio.

Compilation or a passing isolated probe is not enough to close the release gate.

## Basic probes

~~~bash
cc -std=c11 -O2 -Wall -Wextra -Werror runtime/linux/process-scope.c -o /tmp/core-scope
python3 tests/diagnostics/linux-process-scope/probe.py /tmp/core-scope --socket
python3 tests/diagnostics/linux-process-scope/browser.py /tmp/core-scope \
  /path/to/pinned/node_modules /path/to/pinned/ms-playwright
~~~

The browser probe requires the pinned @playwright/cli 0.1.18, playwright-core 1.63.0-alpha-2026-08-05, and installed Chromium 1237. It starts the foreground CLI daemon, makes three named-session calls, checks stable browser identity, physically pauses/resumes the captured tree, and retires while paused. Both Chromium crashpad processes must be adopted and gone.

The process probe covers setsid/double-fork, descendants created by a non-leader thread, persistent launcher exit, physical pause/resume, and paused abort. Its SIGKILL case intentionally demonstrates that runner loss can leave a survivor. EOF is not a confirmed-empty receipt. A test-only outer subreaper and explicit fixture cleanup prevent that expected failure from leaking processes.

The runner does not restart Core or choose the workspace/execution owner. Existing Core leases retain admission until an empty-child receipt and joined child close. The container must own loss of runtime or runner authority. A same-container Bun restart is not sufficient evidence for that prerequisite.

## Compiled and recovery probes

~~~bash
python3 tests/diagnostics/linux-process-scope/compiled_browser.py \
  --binary /path/to/compiled/opencode
python3 tests/diagnostics/linux-process-scope/persistent_recovery.py \
  --binary /path/to/compiled-runtime --data /path/to/disposable-directory
~~~

The compiled browser probe uses HTTP barriers for active pause/resume/abort, concurrent foreign-Topic calls, physical idle parking, execution-generation reuse, and workspace replacement. It does not infer ownership from a CLI exit alone.

Persistent recovery checks persisted pause after SIGKILL, unavailable continuation/stale controls, explicit abort, no replay, and fresh-owner fencing. Same-container restart proves durable metadata semantics only. Container loss, mounted-volume replacement, and unprivileged init evidence are maintained under validation/containment/.

Production uses the Unix-control native scope runner, not the historical FD3/4 prototype. Adoption still depends on the essential-child contract in docs/BOT_CONTAINMENT_PREREQUISITE.md and the current gates in docs/MINIMUM_TELEGRAM_RELEASE.md.
