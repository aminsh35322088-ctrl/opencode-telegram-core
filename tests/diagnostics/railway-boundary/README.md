# Unshipped Railway boundary probe

This folder contains a destructive validation-container experiment for observing process/runtime boundaries across Railway restarts. It is not production supervision, not part of the Worker request path, and not a passing cumulative test. Read docs/RAILWAY_CONTAINMENT_BOUNDARY.md for the evidence and decision, and docs/MINIMUM_TELEGRAM_RELEASE.md for current release gates.

## Safety and setup

Run probe.py only in the disposable compiled validation image with an independent HTTP witness. Defaults are /validation/tests and /usr/local/bin/opencode; BOUNDARY_TESTS and BOUNDARY_BINARY select local fixtures. Set BOUNDARY_TOKEN to an ephemeral experiment token and BOUNDARY_WITNESS to the receiver URL. Configure the receiver with the same token. Never use real Telegram or provider credentials.

When Railway overrides startCommand, include /usr/bin/tini -s -- explicitly because the override replaces the Docker ENTRYPOINT. The experiment injected Python source as base64 with a fixed SHA256 without changing the compiled image. Existing build redeploys reuse their config snapshot; a newly connected source snapshot may be SKIPPED by watch paths and must be explicitly redeployed to apply diagnostic configuration.

## Probe surface

- Unauthenticated GET exposes readiness only.
- Authenticated GET returns identity/evidence.
- Authenticated POST exposes destructive actions for the validation container only: /kill-bun, /exit-wrapper, /kill-init, and /primary-bun.

The last action execs the actual compiled Bun as tini's essential child. A bounded helper confirms HTTP readiness and exact PID/start-time/PPid 1, records the action externally, then sends SIGKILL. No production guardian is used.

## Procedure and interpretation

Before each action, verify at least three fresh heartbeats for the exact boot. Act well before the 300-second fixture expiry. Preserve the external observer across restart; require a different boot/PID namespace and no old heartbeats inside a window that precedes natural expiry. Heartbeat disappearance after expiry or network failure is not evidence. The sentinel is a double-fork fixture, not a Chromium test.

Linux may ignore /kill-init when it is issued inside the same PID namespace; use an actual platform restart for that case and classify an ignored signal correctly.

The initial v1 source is preserved in commit 5e2a3e2 (120-second heartbeat and fewer actions). Restore the original candidate start configuration/build afterward, verify source health/tests, save sanitized evidence, and remove the temporary receiver. Never change the Telegram Bot service or promote this probe to production.
