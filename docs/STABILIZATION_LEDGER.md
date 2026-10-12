# Stabilization Ledger

**Purpose.** Durable evidence ledger for the stabilization pass. A source branch, a
published artifact, and a running deployment are three different kinds of evidence and
are recorded separately below. Nothing is listed as verified without a fresh, reproducible
command output recorded in this file.

**Not a scope definition.** Scope is `docs/MINIMUM_TELEGRAM_RELEASE.md`. This file only
records what has actually been executed and what it proved.

---

## 1. Identity evidence (three distinct kinds)

### 1.1 Source branch (what was inspected and read)

| Repository | Branch | Inspected commit | Tree state | Note |
|---|---|---|---|---|
| `opencode-telegram-core` | `main` | `82e47abda8648e55abb56d90d9ed4623395101ac` | clean | `docs: document core runtime behavior contracts` |
| `opencode-telegram-bot` | `main` | `4208ee704b6cfe3124c29aee5ce2238d8c581690` | clean except `D node_modules` (see §7.3) | `test: seed shared New Chat fixtures for the remote Worker path` |

Bot `main` was `a781967835bc42b20f283fecb04fa5a67778bde4` before the CI repair in §4.1.

### 1.2 Published artifact (what the release pipeline actually produced)

| Field | Value |
|---|---|
| Core release tag | `v1.18.33-bot.13-pre.34` |
| Tag target commit | `3b83de32f2259be2f8d6d847804c111698138b8e` |
| Published at | `2026-10-12T10:41:28Z` |
| `isPrerelease` / `isDraft` | `true` / `false` |
| Publishing workflow run | `38237318544` (`Build Core prerelease`), all steps `success` |

Asset digests (from `gh release view --json assets`):

| Asset | Bytes | sha256 |
|---|---:|---|
| `opencode-telegram-core-linux-x64.tar.gz` | 41235248 | `f83ab7a7259375a701d4ec22380402be3f14e894da4c69bf9792a5811f2cd301` |
| `opencode-telegram-core-sdk.tar.gz` | 103452 | `8ddaa9385c1e8fd190806845b1ef910fc1fc4cae7c4a7dd68bf56a0a47d1656c` |
| `opencode-telegram-core-sdk-node.tar.gz` | 103958 | `596c425e4f2efa3e83ce024b053e9b947f7035ced9accc1249f2e19625982407` |
| `opencode-telegram-native-runtime.tar.gz` | 162234 | `55a9cbbb6bc7ca04ccdbb28a62846534f3b5b02e374fdb388542c0e783dd9b02` |
| `opencode-telegram-native-runtime-node.tar.gz` | 57794 | `ea90fd9da782ef23d46221185d8b27673ddc2acbe80e15eef0f7ac4b12c0128d` |
| `release-manifest.json` | 1531 | `fbdd1ab360a38cc7e8098a18d09d90379aba7fbe4d049deb08619f5607fcd505` |
| `build-info.json` | 406 | `c367c1698c7c2d5624efc0bf4e60144b6d062731e533ddd507bed0e0d8d66632` |
| `SHA256SUMS` | 698 | `8003a1e9ca3d0eb1b3d0b52d5cbe067e497e38c8e1fe7e2de40f67d74d5e9276` |

### 1.3 Consumer pin

`opencode-telegram-bot/core-release.lock.json`:

| Field | Value | Matches published? |
|---|---|---|
| `tag` | `v1.18.33-bot.13-pre.34` | yes |
| `telegramCoreCommit` | `3b83de32f2259be2f8d6d847804c111698138b8e` | yes (§1.2 tag target) |
| runtime sha256 | `f83ab7a7…f2cd301` | yes |
| sdk sha256 | `596c425e…982407` | yes |
| native runtime sha256 | `ea90fd9d…12c0128d` | yes |

Lock verification is scripted and was executed locally:

```
node scripts/verify-core-install.mjs
→ Verified OpenCode Telegram Core 1.18.33-bot.13-pre.34 / OpenCode 1.18.33
```

### 1.4 Locked inputs (unchanged)

From `upstream/lock.json`:

| Field | Value |
|---|---|
| upstream project | `anomalyco/opencode` |
| upstream tag / commit | `v1.18.33` / `51ef4be1d3c122f18fefb510dca8d778571f4f18` |
| Bun | `1.3.14` |
| `telegramCoreVersion` | `1.18.33-bot.13-pre.34` |
| `runtimeProfile` | `telegram-headless` |
| `runtimeMaxBytes` | `120000000` |

### 1.5 ⚠ Source branch is ahead of the published artifact

`main` HEAD `82e47ab` is **one commit ahead** of the tag target `3b83de3`:

```
$ git rev-list -n1 v1.18.33-bot.13-pre.34   → 3b83de32f2259be2f8d6d847804c111698138b8e
$ git rev-parse HEAD                          → 82e47abda8648e55abb56d90d9ed4623395101ac
$ git log --oneline v1.18.33-bot.13-pre.34..HEAD
82e47ab docs: document core runtime behavior contracts
```

`upstream/lock.json` still declares `telegramCoreVersion = 1.18.33-bot.13-pre.34`, so
`prerelease.yml` correctly computes `publish = false` and skips. Confirmed from run
`38252664192`:

```
[success]  Select unreleased prerelease
[skipped]  Build compatibility unit
[skipped]  Publish verified prerelease
```

**Consequence.** The commit `82e47ab` is *unreleased*. Any statement about release
`pre.34` refers to `3b83de3`, not to `main`. Bumping `telegramCoreVersion` to a new
`^[0-9]+\.[0-9]+\.[0-9]+-bot\.[0-9]+-pre\.[0-9]+$` value with a non-existing tag is the
only trigger that publishes.

### 1.6 Deployment (Railway) — recorded `2026-10-12`

Collected with the Railway CLI (`railway 5.65.0`, authenticated as
`rizcaf@mailviro.com`, workspace `ali475-lab's Projects`).

**Topology as actually deployed** — two projects, which is what keeps the Worker
secrets out of the control plane:

| Role | Project | Service | Service id |
|---|---|---|---|
| Control plane (the Bot) | `opencode-telegram-bot` | `control-plane` | `a64ba999-b5be-4b71-ab73-6523e2a0e6c4` |
| Per-Topic Workers | `opencode-topic-01` | `topic-node-087af7f1…`, `topic-node-5f5ea0a2…`, `topic-node-d2cbdbb9…`, `topic-node-f0c11c28…` | 4 services |

**Control plane live deployment**

| Field | Value |
|---|---|
| deployment id | `8e4efa2f-2273-4285-b08b-42414b9b0ad1` |
| status | `SUCCESS` |
| created | `2026-10-12T17:23:36.806Z` |
| `meta.commitHash` | `4208ee704b6cfe3124c29aee5ce2238d8c581690` — **equals Bot `main` HEAD** |
| `meta.imageDigest` | `sha256:f277daca9867778ea31a7994b42ebfe1eedcb5d8c712334bd30b1f73b45e94d6` |
| source | `aminsh35322088-ctrl/opencode-telegram-bot`, branch `main`, `builder: DOCKERFILE` |
| health check | `GET /health` → HTTP 200 `{"status":"healthy"}` |
| volume | `control-plane-data @ /data` |
| replicas / region | 1/1, crashed 0, `europe-west4-drams3a` |
| restart policy | `ON_FAILURE`, max retries 3 |

**Worker deployments** — all four `status = SUCCESS`, `replicas 1/1`, `crashed 0`,
each with its own `/data` volume (`serene-volume`, `sunny-volume`, `unique-volume`,
`supportive-volume`, 500 MB, state `READY`):

| Service | deployment id | created | `/data` volume | `GET /health` |
|---|---|---|---|---|
| `topic-node-087af7f1…` | `71b2741b-b00d-4b29-9833-ddeca5e8e46f` | `2026-10-12T11:37:16.551Z` | `serene-volume` 34.7/500 MB | 200 `ready-unbound` |
| `topic-node-5f5ea0a2…` | `bce32e16-80cb-4fe5-b78f-b3c8e167d312` | `2026-10-12T11:36:32.171Z` | `sunny-volume` 33.6/500 MB | 200 `ready-unbound` |
| `topic-node-d2cbdbb9…` | `44c5f48e-a8be-4417-8ad7-13f389b8295a` | `2026-10-12T12:12:16.611Z` | `unique-volume` 39.1/500 MB | 200 `ready-unbound` |
| `topic-node-f0c11c28…` | `41a61e74-052b-4522-adf2-c20198478164` | `2026-10-12T12:11:55.252Z` | `supportive-volume` 48.9/500 MB | 200 `ready-unbound` |

All four run the same immutable image:

```
ghcr.io/aminsh35322088-ctrl/opencode-telegram-worker@sha256:6c365cc6cf5a8a5297a706410ad089c72b02eeafa7d45f2e82a6586e4710c8f3
```

**Deleted project tombstones** (no services): `opencode-telegram-01` ×2 and
`opencode-telegram-02` ×2, `deletedAt` `2026-10-12T22:55:53Z` / `2026-10-13T15:15:02Z`.

### 1.7 Source ↔ artifact ↔ deployment chain — **consistent**

| Link | Evidence |
|---|---|
| Core `3b83de3` → GitHub Release `pre.34` | tag target = `3b83de3` (§1.2) |
| Core `3b83de3` → GHCR Worker image | `prerelease.yml` job `worker-image`, run `38237318544`, `Build and publish immutable governed Worker runtime` = `success` (`2026-10-12T10:35:50Z` → `10:38:29Z`), tag `3b83de3`, build-arg `CORE_SOURCE_COMMIT=3b83de3` |
| Bot pins the release | `core-release.lock.json`: tag `pre.34`, commit `3b83de3`, three asset digests = §1.2 (§1.3) |
| Bot pins the image | `src/infrastructure/worker-core-release.ts`: `WORKER_CORE_COMMIT=3b83de3…`, `WORKER_CORE_VERSION=1.18.33-bot.13-pre.34`, `WORKER_RUNTIME_IMAGE=…@sha256:6c365cc6…` |
| Pin is enforced by test | `tests/core-worker-release-alignment.test.ts` asserts all three equal to the lock values |
| Production runs the pinned image | All 4 Workers run `@sha256:6c365cc6…` (§1.6) — **matches the Bot source pin** |
| Production runs Bot `main` | Control plane `meta.commitHash = 4208ee70…` — **matches Bot `main` HEAD** |

Locked inputs in `upstream/lock.json` are unchanged from §1.4 (pre.34).

**Observation, not a defect:** `prerelease.yml` job `worker-image` is *not* gated on
`publish`, so every green Core CI publishes a fresh image (e.g. run `38252664192`,
`worker-image = success` at `2026-10-12T13:02:57Z` for `82e47ab`). Production stays on
the explicitly pinned digest. This is the intended immutable-pin model: newer images exist
that are deliberately not adopted.

**Observation:** all four Workers currently report `readiness: "ready-unbound"`, i.e. no
Topic is bound to any Worker right now. Probes were taken with no active session, so this
is recorded as an observation, not as a pass or a failure. Positive evidence of a bound
route has not been collected.

---

## 2. Verification evidence — Linux (authoritative for this release)

The release target is Linux (`telegram-headless` on Railway). GitHub Actions on
`ubuntu-latest` is the authoritative environment; the local host is Windows with no WSL,
no Docker, no Bun and no MSVC toolchain.

### 2.1 Core CI @ `82e47ab` — run `38252065277` — **success** (5m21s, `2026-10-12T12:54:54Z`)

| Job | Conclusion | Steps (all `success`) |
|---|---|---|
| `validate` | success | Install runtime dependencies, Typecheck, **Test runtime** (`bun test`), Test unbound session probe boundary, **Test toolchain and release contracts** (`python3 -m unittest discover -s tests -p 'test_*.py' -v`) |
| `upstream-runtime` | success | **Verify patched live runtime** (`scripts/test-upstream-runtime.sh`) |
| `telegram-headless` | success | **Build and verify production graph** (`build-runtime.sh`), Build independent compatibility CLI (`build-compat-cli.sh`), **Verify actual production composition and compiled execution** (`test-headless-runtime.sh`), Verify Bot SDK surface (`build-sdk.sh`) |

> Note the Python linter **is** a CI gate (step "Test toolchain and release contracts",
> identical selection `-p 'test_*.py'`). It passes on Linux. The local Windows failures in
> §3 are therefore not defects in the supported platform.

### 2.2 Core packaging/verification @ `3b83de3` — run `38237318544` — **success**

This is the run that published `pre.34`. Steps:

```
[success] Build compatibility unit        # build-runtime.sh, build-sdk.sh,
                                          # test-headless-runtime.sh,
                                          # package-release.sh, verify-release.sh
[success] Publish verified prerelease
```

So `package-release.sh` and `verify-release.sh` **have** been executed successfully on a
Linux runner for the published artifact.

### 2.3 Bot CI @ `4208ee70` — run `38283899328` — **success** (3m17s, `2026-10-12T17:23:37Z`)

Job `validate` = `success`. Workflow `Publish` run `38283899330` = `skipped`, because
`publish.yml` is guarded by `github.repository == 'grinev/opencode-telegram-bot'`, which
does not match this repository. There is therefore **no accidental npm publish risk** on
pushes to `main`.

### 2.4 Gate coverage matrix

| Gate script / command | Runs in Core CI on every push? | Runs when publishing? | Last observed result |
|---|---|---|---|
| `bun run typecheck` | yes (`validate`) | — | success @ `82e47ab` |
| `bun test` | yes (`validate`) | — | success @ `82e47ab` |
| `python3 -m unittest discover -s tests -p 'test_*.py'` | yes (`validate`) | — | success @ `82e47ab` |
| `scripts/test-upstream-runtime.sh` | yes (`upstream-runtime`) | — | success @ `82e47ab` |
| `scripts/build-runtime.sh` | yes (`telegram-headless`) | yes | success @ `82e47ab` |
| `scripts/build-compat-cli.sh` | yes (`telegram-headless`) | — | success @ `82e47ab` |
| `scripts/test-headless-runtime.sh` | yes (`telegram-headless`) | yes | success @ `82e47ab` |
| `scripts/build-sdk.sh` | yes (`telegram-headless`) | yes | success @ `82e47ab` |
| `scripts/package-release.sh` | **no** | yes | success @ `3b83de3` (run `38237318544`) |
| `scripts/verify-release.sh` | **no** | yes | success @ `3b83de3` (run `38237318544`) |
| `scripts/test-native-runtime.sh` | **no** | **no** | **never executed by any workflow** |
| `scripts/run-compatibility.sh` | **no** | **no** | **never executed by any workflow** |

**Coverage gap.** `test-native-runtime.sh` and `run-compatibility.sh` exist in `scripts/`
but are referenced by no workflow file. They are currently dead gates. Either wire them
into CI or document them as unsupported.

---

## 3. Verification evidence — local Windows (non-authoritative, environment-limited)

### 3.1 Core Python linter — deterministic, 116 non-passing

```
python -m unittest discover -s tests -q
Ran 319 tests in 46.556s
FAILED (failures=19, errors=97, skipped=2)          exit code 1
```

Run twice; the set of failing test identities is byte-identical between runs
(`Compare-Object` of the sorted `FAIL:/ERROR:` name lists → **0 differences**). The linter
is deterministic locally, so these are reproducible Windows failures, not flake.

Root-caused mechanism classes (counts from the captured traceback text):

| Count | Mechanism | Evidence |
|---:|---|---|
| 70 | POSIX-only `os` attributes absent on Windows | `AttributeError: module 'os' has no attribute …` → `getuid` 26, `statvfs` 24, `O_DIRECTORY` 9, `killpg` 3, `mkfifo` 3, `O_NOFOLLOW` 3, `chown` 2 |
| 17 | Executing shell scripts as binaries | `OSError: [WinError 193] %1 is not a valid Win32 application` |
| 14 | Windows file sharing semantics | `PermissionError: [WinError 32] … being used by another process` |
| 8 | Missing POSIX helper executables | `FileNotFoundError: [WinError 2] The system cannot find the file specified` |
| 17 | Thread + real-socket shutdown propagation under a **0.7 s** wait | `tests/worker/test_proxy_stream_fences.py:84` → `self.assertTrue(closed.wait(.7), 'blocked upstream survived its fence')` |
| 1 | Thread + `socket.socketpair()` close under a **0.5 s** join | `tests/worker/test_mcp_proxy.py:240` → `self.assertFalse(thread.is_alive(), 'retirement did not cancel header read')` |
| 1 | Subprocess exit code from an unrunnable script | `AssertionError: 9009 != 2` |
| remaining | POSIX directory open / `O_DIRECTORY` handling, tests invoking `.sh` | — |

Failing tests by file (top): `test_proxy_stream_fences.StreamFenceTests` 17,
`test_release.ReleaseTests` 6, `test_patches.PatchTests` 3,
`test_worker_bootstrap_identity.*` 6, `test_upstream.UpstreamTests` 2,
plus singles across `test_node_agent`, `test_cloud_bootstrap`, `test_boundary_resources`.

**Classification.** All 116 are attributable to Windows-only conditions. Decisive
evidence: the *same test selection* passes on Linux (§2.1, step "Test toolchain and release
contracts" = `success`). These are **not** defects in the supported production platform.

**However — two of these blocks are honest open questions, not proven-fine:**

- The 17 `blocked upstream survived its fence` failures and the 1
  `retirement did not cancel header read` failure are *behavioural* assertions about
  cancellation/fence propagation. They fail on Windows because closing a socket from
  another thread does not wake a blocked reader the way it does on POSIX, under a 0.7 s /
  0.5 s budget. Linux CI passes them. Whether the product cancels correctly **on Windows**
  is therefore *unproven*, not disproven. Recorded in §7.1 as open.
- `atomic-binding-store` performs `fsync()` on a **directory** handle
  (`runtime/src/runtime/atomic-binding-store.ts`, `const dir = await open(directory, "r"); await dir.sync();`).
  Directory fsync is POSIX-only. Reproduced in isolation on this host:

  ```
  node -e "… fs.openSync(dir,'r'); fs.fsyncSync(fd) …"
  → dir fsync FAIL EPERM EPERM: operation not permitted, fsync
  ```

  A plain *file* `fsync` succeeds on the same host, so the failure is specific to the
  directory handle. Effect: on Windows `initializeNativeCore → registerBinding → #persist`
  throws, i.e. **the native Core cannot initialise at all**.

### 3.2 Bot — full gate locally

| Command | Result |
|---|---|
| `node scripts/verify-core-install.mjs` | `Verified OpenCode Telegram Core 1.18.33-bot.13-pre.34 / OpenCode 1.18.33` |
| `eslint src --max-warnings=0` | exit `0` |
| `tsc --noEmit` (typecheck) | exit `0` |
| `npm run build` (tsc) | exit `0` |
| `node --import tsx --test tests/main-reply-keyboard.test.ts` | 2/2 pass |
| vitest, full suite (277 files) | `4 failed | 273 passed (277)` files → `19 failed | 2248 passed (2267)` tests |

The 19 Windows-only vitest failures are root-caused and reproducible:

| Count | File | Root cause |
|---:|---|---|
| 6 | `tests/runtime/github-credential-shim.test.ts` | (a) `railway-entrypoint.sh` is checked out CRLF (`CRLF=237, LF=0`, `core.autocrlf=true`, no `.gitattributes`) which breaks the heredoc extraction regex; (b) `execFileSync("sh")` → `spawnSync sh ENOENT` (no `sh` on PATH); (c) after (a)+(b) are worked around, `exec: C:UsersAdmin…gh-stub: not found` — Windows backslashes are consumed as shell escapes in the embedded shim script |
| 5 | `tests/core/native-core-service.test.ts` | directory-fsync `EPERM` (§3.1) during `initializeNativeCore` |
| 6 | `tests/app/services/tailscale-integration-service.test.ts` | `server.listen(<unix socket path>)` → `listen EACCES` (no Unix domain socket at that path on Windows) |
| 2 | `tests/app/services/ssh-key-service.test.ts` | `spawn EFTYPE` for the `ssh-keygen` wrapper, and `expect(mode & 0o777).toBe(0o600)` → `438 != 384` because NTFS does not store POSIX mode bits |

Additionally, `tests/runtime/core-tool-process.test.ts` (2 tests) fails only when `dist/`
has not been built; CI builds before vitest, and a local `npm run build` makes it pass.

**Bogus work done here, discarded.** Converting `railway-entrypoint.sh` from CRLF to LF
*inside the working clone* did **not** fix `github-credential-shim` (still 6 failures); the
real causes were (b) and (c) above. The conversion was a local-only experiment and was not
committed.

---

## 4. Fixed defects (with red → green proof)

### 4.1 Bot: New Chat Worker-routing test had no fixture setup

| | |
|---|---|
| Reported symptom | Core CI red on 5 consecutive pushes (`80ac4962`, `b0dc2c28`, `5f97c888`, `0872f19d`, `a7819678`); 1 failing vitest case out of 2267, `tests/bot/commands/new.test.ts` |
| Claimed status before | CI was green at `27f3076d` (`2026-10-12T10:54`), i.e. before `80ac4962` introduced the test |
| Root cause | `describe('remote New Chat retry ownership')` had **no `beforeEach`**, so `getTopicDefaults()` returned `undefined`. `src/bot/commands/new-command.ts:65` threw `TypeError: Cannot read properties of undefined (reading 'agent')`, which the command swallowed as `🔴 OpenCode Server is unavailable or an error occurred while creating session.` → `assertCurrentSessionTopicRoute` was never called (0 assertions on the routing contract) |
| Fix | Hoist the shared `beforeEach` from the sibling `describe("bot/commands/new")` to file scope in `.github/ci-tests/tests/bot/commands/new.test.ts` |
| Product code changed? | **No.** Production `getTopicDefaults()` always returns an object; this was a fixture gap, not a product defect |
| Red → green proof | Original `HEAD` fixture → `Test Files 1 failed (1)`; fixed fixture → `Test Files 1 passed (1)` |
| Landed | Bot commit `4208ee704b6cfe3124c29aee5ce2238d8c581690` |
| Linux evidence | CI run `38283899328` → `validate = success` (§2.3) |

---

## 5. Soak / elapsed-time gates — **PENDING**

No gate below has been started. Per the release requirements, a stable artifact must not
be published while any of these is pending.

| Gate | Required | State |
|---|---|---|
| Representative stress run | ≥ 2 h under active + idle phases | **pending — not started** |
| RC soak | ≥ 24 h with active/idle phases, restarts, and rollback proof | **pending — no RC soak candidate selected yet** |
| Restart evidence | repeated restarts observed during soak | **pending** |
| Rollback proof | demonstrated revert to a known-good artifact | **pending** |
| Railway physical evidence | service/deployment identity, env, resource profile | **pending — §1.6** |

The harness for these gates is not yet committed. Until it exists and the elapsed time has
actually accrued, the correct status of the stable release is **blocked**.

---

## 6. Open items

### 6.1 Open (not proven fine)

1. **Control-plane production deploys are not gated on CI.** Railway creates a production
   deployment within ~1 s of every push to `main`, while the GitHub Actions run takes
   2–5 minutes. Five commits whose Bot CI **failed** were nevertheless deployed to
   production on `2026-10-12`:

   | commit | production deployment created | Railway status | Bot CI |
   |---|---|---|---|
   | `a7819678` | `12:55:05.921Z` | `REMOVED` (superseded) | **failure** (run `38252090298`) |
   | `0872f19d` | `12:26:47.405Z` | `REMOVED` | **failure** (run `38249068393`) |
   | `5f97c888` | `12:08:47.722Z` | `REMOVED` | **failure** (run `38247188010`) |
   | `b0dc2c28` | `11:46:19.957Z` | `REMOVED` | **failure** (run `38244803108`) |
   | `80ac4962` | `11:30:48.707Z` | `REMOVED` | **failure** (run `38243128111`) |

   The current live deployment `4208ee70` is the first one in this series whose commit
   also has a green CI run (`38283899328`) — and CI finished ~3 minutes *after* the
   deploy was created. **Consequence:** "the commit running in production" and "the
   commit verified by CI" are not causally linked; no release claim can rest on the
   deployment having been verified. Fixing this needs a deployment gate (CI-gated
   `railway up`, a Railway deploy hook triggered by a passing workflow, or a required
   status check plus branch protection), which is an infrastructure decision and is
   recorded here rather than changed unilaterally.
2. **Windows local/development mode cannot initialise the native Core.** Directory-fsync
   `EPERM` in `atomic-binding-store` (§3.1). The Bot repository declares
   `CONTRIBUTING.md`: *"Changes must be compatible with Linux, macOS, and Windows (our
   supported platforms)."* Tension with the Core's own note in
   `docs/MIGRATION_TO_V1.md`: *"A Windows directory-fsync limitation is not a Linux
   production workaround."* Decision needed: fix for portability, or explicitly narrow the
   supported local-mode platform.
3. **Cancellation/fence behaviour on Windows is unproven** (18 timing/socket tests,
   §3.1). Pass on Linux; Windows result is a platform-semantics artifact, but no positive
   evidence exists for Windows.
4. **Two dead gates**: `scripts/test-native-runtime.sh` and `scripts/run-compatibility.sh`
   are referenced by no workflow (§2.4).
5. **`node_modules` is tracked as a symlink** in the Bot repository
   (`node_modules → /app/node_modules`, mode `120000`). It was deliberately untracked by
   `2463ed14` and then re-added by `e02c3dfe`. Consequence: any fresh checkout is dirty
   after `npm ci` (`D node_modules`). Not a CI gate failure, but it defeats clean-tree
   verification.
6. **Untracked `control-plane/node-bindings.json`** is produced as a side effect of running
   the Bot test suite in a working checkout and is not covered by `.gitignore`.
7. **No positive evidence of a bound Topic route in production.** All four Workers report
   `readiness: "ready-unbound"` (§1.6); probes were taken with no active session. Whether
   a session is actually routed to exactly one Worker has not been demonstrated end to end
   against the live deployment.

### 6.2 Verified / do not reopen

- Upstream lock identity (`v1.18.33`, `51ef4be1…`, Bun `1.3.14`, `telegram-headless`,
  `120000000`) — read from `upstream/lock.json`, unchanged.
- Published `pre.34` artifact digests match the Bot's `core-release.lock.json` (§1.3).
- Full source ↔ artifact ↔ deployment chain is consistent (§1.7): Core `3b83de3` →
  Release `pre.34` + GHCR `sha256:6c365cc6…` → Bot pins both → all four production
  Workers run exactly that pinned digest.
- Control-plane deployment is built from Bot `main` HEAD
  (`meta.commitHash = 4208ee70…`, §1.6) and answers `GET /health` 200.
- `package-release.sh` + `verify-release.sh` succeeded for the published artifact (§2.2).
- All three Core CI jobs green at `82e47ab` (§2.1).
- Bot CI green at `4208ee70` after the fixture repair (§2.3).
- Bot `Publish` workflow cannot fire on this repository (§2.3).

### 6.3 Superseded — re-verify before acting

Content inside `docs/MINIMUM_TELEGRAM_RELEASE.md` predating the current head — including
percentage completion figures, the "frozen Bot" wording, the PR28 Draft reference and the
41-SDK-member inventory — is historical. Re-derive from code before relying on it.

---

## 7. Reproduction

Every claim above is reproducible with:

```bash
# identities
git -C <repo> rev-parse HEAD
git -C <repo> rev-list -n1 v1.18.33-bot.13-pre.34
gh release view v1.18.33-bot.13-pre.34 --json tagName,isDraft,isPrerelease,publishedAt,assets

# Linux gates (authoritative)
gh run view <run-id> --json jobs

# local Windows linter (environment-limited)
python -m unittest discover -s tests -q

# Bot local gates
node scripts/verify-core-install.mjs
eslint src --max-warnings=0 && tsc --noEmit && npm run build
```

### 7.1 Environment constants observed on this host

| Item | Value |
|---|---|
| Host OS | Windows, no WSL, no Docker, no Bun, no MSVC |
| `git config core.autocrlf` | `true` |
| `.gitattributes` | absent in both repositories |
| Local Python | 3.12.14 (absolute path; not on PATH) |
| Local npm/node | `C:\Users\Admin\AppData\Local\Microsoft\WinGet\Packages\OpenJS.NodeJS.22_…` |
| Bot `npm ci` | requires `--ignore-scripts` (`better-sqlite3` node-gyp has no MSVC) |
| Core `main` | `82e47abda8648e55abb56d90d9ed4623395101ac` |
| Bot `main` | `4208ee704b6cfe3124c29aee5ce2238d8c581690` |
| Published Core | `v1.18.33-bot.13-pre.34` → `3b83de32f2259be2f8d6d847804c111698138b8e` |
| Railway control plane | project `opencode-telegram-bot` / service `control-plane`, deployment `8e4efa2f-2273-4285-b08b-42414b9b0ad1`, `commitHash 4208ee70…`, `SUCCESS` |
| Railway Workers | project `opencode-topic-01`, 4 × `topic-node-*`, image `@sha256:6c365cc6…`, all `SUCCESS` |
| Railway CLI | `railway 5.65.0`, auth `rizcaf@mailviro.com`, workspace `ali475-lab's Projects` |
| Live probes | control plane `GET /health` 200 `{"status":"healthy"}`; 4 × Workers 200 `{"alive":true,"readiness":"ready-unbound"}` |
