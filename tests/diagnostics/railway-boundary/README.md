# Unshipped Railway boundary probe

See [the evidence and decision](../../../docs/RAILWAY_CONTAINMENT_BOUNDARY.md).
This is a diagnostic, not production supervision or a passing cumulative test.

Run `probe.py` only in the disposable compiled validation image, with an independent
HTTP witness. It uses `/validation/tests` and `/usr/local/bin/opencode` by default;
`BOUNDARY_TESTS` / `BOUNDARY_BINARY` select local fixtures. Set `BOUNDARY_TOKEN` to
an ephemeral experiment token and `BOUNDARY_WITNESS` to the receiver URL. Configure
the receiver with the same token. Do not use real provider/Telegram credentials.

When Railway overrides startCommand, include `/usr/bin/tini -s --` explicitly;
the override replaces the Docker ENTRYPOINT. This experiment injected the Python
source as base64 using a fixed SHA256, without changing the compiled image. Existing
build redeploys reuse their config snapshot; a newly connected source snapshot can
be SKIPPED by watch paths and explicitly redeployed to apply diagnostic config.

GET without authentication exposes readiness only. Authenticated GET returns
identity/evidence. Authenticated POST actions are intentionally destructive to the
**validation container only**: `/kill-bun`, `/exit-wrapper`, `/kill-init`, and
`/primary-bun`. The last action execs the actual compiled Bun as tini's essential
child; a bounded helper confirms HTTP readiness and exact PID/start-time/PPid1,
records the action externally, then sends SIGKILL. No production guardian is used.

Before each action verify at least three fresh heartbeats for that exact boot,
then issue the action well before the300s fixture expiry. Preserve the external
observer across restart; require another boot/PID namespace and no old heartbeats
within a window that precedes natural expiry. Heartbeat disappearance after expiry
or network failure is not evidence. The sentinel is a double-fork fixture, not a
Chromium test. `/kill-init` from the same PID namespace may be ignored by Linux;
use an actual platform restart for that case and classify the ignored signal.

The initial v1 source is preserved in commit5e2a3e2 (120s heartbeat, fewer actions).
Restore the original candidate start config/build afterward, verify exact-source
health/tests, save sanitized evidence, and remove the temporary receiver. Never
change the Telegram Bot service or promote this probe to production.
