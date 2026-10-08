# Worker runtime dependency baseline

`Dockerfile.worker` builds the existing exact source-pinned Core without changing
its build stage. Its runtime stage supplies Node 22.14.0 and npm/npx, Python 3
with pip/venv, git/git-lfs, C/C++/make/pkg-config and SQLite/SSL development headers,
SQLite CLI, jq, ripgrep, fd, curl/wget, archives/rsync, OpenSSH client, GitHub CLI,
DNS/network diagnostic clients, ffmpeg and ImageMagick. The baseline explicitly
includes bash/coreutils/findutils and lsof for process/socket diagnostics.
The Worker exposes fixed port 8080 and does not declare a conflicting `PORT` ENV.
Debian dependencies come
from Bookworm repositories. Image tool inventory records their resolved versions;
there are no runtime package installations or caches on the Topic volume.

Playwright CLI is pinned to `@playwright/cli@0.1.18`. Core independently checks its
`playwright-core` dependency is `1.63.0-alpha-2026-08-05` before browser admission.
Chromium and its runtime libraries are installed at image build time. Browser
artifacts are root-owned at `/opt/ms-playwright` and readable, never writable, by
Core UID1000. Browser profiles, temporary files and package caches belong under
`/tmp`. `/data/topic` retains only Topic workspace/session state.

The image-installed `worker/runtime_tools/browser.ts` uses only the native
`context.process.browser` port. The Core workspace owns its daemon/Chromium tree;
the live execution owns request admission and pause/abort delegates. The native
implementation physically pauses idle browsers and joins retirement. Do not
substitute Bot's older raw `child_process.execFile("playwright-cli")` wrapper.
The Agent must copy this tool into its root-owned canonical tool directory and
force the child browser artifact path to `/opt/ms-playwright`; image ENV alone
does not override its child-environment allowlist.

## Source audit

| Source inspected | Dependency / ownership conclusion |
| --- | --- |
| Bot `Dockerfile` runtime stage | Development, network, transfer and media binaries are required baseline; omit its daemon, Bot service graph and debug/UI convenience programs. |
| Bot `.opencode/tools/browser.ts` | CLI version and action names retained, execution moved to Core's governed browser port. |
| Core `runtime/upstream/telegram-browser-process.ts` | Exact CLI/runtime checks; workspace/session fencing; process admission; physical pause; joined disposal. |
| Core `runtime/upstream/telegram-tool-process.ts` and process-budget patch | Custom children must use the captured process port; budget `1` enables the native governor, it is not a global one-child limit. |
| Bot `.opencode/tools/test.ts` | Optional project Bun-lockfile detection; no canonical Worker plugin/MCP requires standalone Bun. Core's pinned build Bun is not copied into runtime. Bun-requiring configured tools need an explicit future capability/dependency. |
| Bot `railway-entrypoint.sh` and `src/app/services/tailscale-integration-service.ts` | A single Bot-owned Tailscale daemon/socket and encrypted Tailnet configuration; never start another daemon or copy keys/state into Workers. |
| Bot `.opencode/tools/tailscale.ts` and SSH integration | Calls trusted Bot services with Topic-owned leases/workspaces. Installing OpenSSH binaries does not provide that integration. |

Worker SSH/Tailnet and other trusted Bot integrations depend on an authenticated
Control-plane bridge. Their Bot modules, credentials and shared daemon are not
copied into this image. Runtime binary availability is not a claim that those
application integrations have passed cutover validation.

## Offline validation

Build the complete source image with its exact Core source commit:

```sh
docker build -f Dockerfile.worker --build-arg CORE_SOURCE_COMMIT="$(git rev-parse HEAD)" -t core-worker:parity .
docker run --rm --user 1000:1000 --workdir /tmp \
  --mount type=bind,src="$PWD",dst=/validation,readonly \
  -e HOME=/tmp -e XDG_CONFIG_HOME=/tmp -e XDG_DATA_HOME=/tmp \
  --entrypoint python3 core-worker:parity /validation/scripts/worker-runtime-smoke.py
docker run --rm --user 1000:1000 --workdir /tmp --memory=1g \
  --mount type=bind,src="$PWD",dst=/validation,readonly \
  --entrypoint python3 core-worker:parity /validation/tests/worker/compiled_browser_runtime.py
docker image inspect core-worker:parity --format '{{.Size}}'
docker run --rm --mount type=bind,src="$PWD",dst=/validation,readonly \
  --entrypoint python3 core-worker:parity /validation/scripts/worker-runtime-inventory.py
```

The first probe exercises offline npm, Python venv, C/C++/SQLite compilation,
local HTTP transfer, archives, media encoding and real Chromium as UID1000. The
second drives the actual compiled Core through a synthetic model, uses the
governed browser tool to navigate/snapshot/screenshot a local page, verifies
physical pause/resume of the browser descendants, and joins workspace disposal.
It configures Core directly and is not proof of the separate Agent materializer
or Control-plane integrations. No real credentials or external model providers
are used.

Local evidence for this change used dependency image
`sha256:c1b98760f2f90f71084b8ede21e350c05351f208c94284f2763e5b51553a24f8`
(2,112,797,250 bytes, about 1.97 GiB uncompressed). Its original Core was a
bootstrap artifact. Exact-source retests mounted the verified public CI Core
`c859ae495bb46534a9b2e78b533f5d885a72b5de` binary read-only, SHA256
`f9215b242ce1ad7484dfc064cf44f024b27d0d714cf3fb1efbb81725d43eb68c`, and public
build metadata. The updated baseline also installed public Debian Bookworm
`lsof 4.95.0-1` inside one disposable test container. Baseline passed at 512 MiB;
the real governed-browser probe passed at 1 GiB. These are transparent container
overrides, not a newly built production image. The final lsof/8080 source image
and authenticated selftest route must still be built and checked on the canary.

The standalone toolchain/Chromium probe passed with a 512 MiB container limit.
The compiled governed-browser probe safely rejected startup at 512 MiB: its
measured cgroup use was 398 MiB and the existing browser startup reservation is
256 MiB, exceeding the 94% pressure ceiling. Browser-capable Workers need enough
startup headroom; do not weaken admission or confuse the 500 MiB data-volume
budget with a browser memory limit. The documented compiled probe uses 1 GiB.

In the managed development environment, use a temporary verification Dockerfile
with BuildKit `--mount=type=secret,id=proxy_ca` on npm/browser download RUNs and
`NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca`. Supply the authorized public combined
CA file with `--secret id=proxy_ca,src=/etc/ssl/certs/ca-certificates.crt`. Do not
copy the development CA into production image layers or disable TLS validation.

## Fixed native selftest profiles

The image installs `/opt/worker-runtime/worker-runtime-smoke.py` read-only. The
narrow native selftest handler must invoke it through Core's captured process
port, with private ephemeral execution/workspace ownership and joined abort or
retirement. It must not spawn another Core, choose a caller command or create a
production Session. `baseline` invokes only `--tools-only`; `browser` additionally
uses the governed browser port with fixed local content, not a raw CLI subprocess.

`network` invokes only `--tools-only --online`. It performs three fixed public
operations: install `is-number@7.0.0` from the HTTPS npm registry with scripts,
audit and funding requests disabled; install binary-only `six==1.17.0` in the
private venv from HTTPS PyPI, without dependencies or version checks; clone
`https://github.com/octocat/Hello-World.git` at depth one. Each command is bounded
to 30 seconds, package versions and repository origin/HEAD are verified, and
fresh HOME/config/cache paths avoid inherited credential or package-manager
configuration. The profile has no caller-selected URL, package, command or path.

Offline proofs retain `externalRequests: 0`. The network proof reports
`externalNetworkOperations: ["npm.install", "pip.install", "git.clone"]`,
`npmDependency: "is-number@7.0.0"`, `pipDependency: "six==1.17.0"` and the exact
`publicClone` URL. It does not invent an HTTP subrequest count. Actual network
success must be checked on the built canary; providing the profile is not proof
that those egress operations have succeeded or that a real model task ran.

### Governed per-Topic compaction

The signed Worker RPC operation `session.compact` uses the current owned
`sessionId` and payload:

```json
{"runId":"compact_1","model":{"providerID":"opencode","modelID":"big-pickle"},"events":true}
```

`runId` and the explicit model are required; `events` and `expectedRevision` are
optional. Callers may reserve the run through `run.prepare`. Admission, snapshot
revision fencing, active-execution exclusion, native execution identity,
stop/pause/resume and durable callback receipts follow the existing `run`
protocol. Queue consumers should request `events:true`, use the same run ID when
reconciling an uncertain admission, and finish only on the owned terminal
`session.event` callback. Acceptance returns `{"accepted":true,"runId":"compact_1"}`;
reconciliation can also return `reconciled:true` and the existing submitted state.

Core creates the native compaction marker and forks its existing session prompt
loop in the application Effect scope. The internal request is
`POST /session/:sessionId/summarize` with
`{"providerID":"opencode","modelID":"big-pickle","async":true}`. Ordinary
summarize calls retain their synchronous behavior. The Worker does not start a
separate process, synthesize a summary prompt, or transfer runtime ownership to
Bot. Provider failures are native session error events.

No dedicated speech-transcription or image-generation operation is exposed:
the current Core interfaces do not supply a governed implementation for those
operations. Model attachment input and provider modality metadata do not imply
an output-generation or transcription service.
