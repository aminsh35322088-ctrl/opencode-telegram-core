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

### 2.5 Bot CI @ `ce227128` — run `38340757408` — **success** (2m50s, `2026-10-13T03:17:19Z`)

Job `validate` = `success` for the Telegram-Stop attribution fix and the docs-alignment
change (§4.2, §4.3). The run executes, in order: `verify-core-install.mjs`, root
`node --import tsx --test tests/*.test.ts` (this is the step that carries
`tests/native-stop-attribution.test.ts` and `tests/legacy-run-controls-audit.test.ts`),
then `rm -rf tests` and materialization of `.github/ci-tests/tests`, then
`npm run lint`, `npm run typecheck`, `npm run build`, and the full vitest suite.
Workflow `Publish` = `skipped` (same `github.repository` guard as §2.3).

Local equivalent on Windows, recorded for comparison only (§3): `tsc --noEmit` exit 0,
`eslint src --max-warnings=0` exit 0, root suite 243 tests / 138 pass / 105 fail — the 105
are the pre-existing Windows-only set, **byte-identical** before and after the change.

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

**Re-measured 2026-10-13 (after the Stop-only guard test was added):** `Ran 326 tests`
(319 baseline + 7 new). The raw `FAIL:`/`ERROR:` **line** count flaps between runs
(114, 117) because one test can emit more than one error block (a temp-dir cleanup
`PermissionError` re-reports its parent test), but the **unique** failing identity set is
**84 in every run** and `Compare-Object` against the baseline set is empty for both runs —
plus the same `test_proxy_stream_fences` timing waits that already flap here. No new
failing identity was introduced.

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

### 3.3 Bot root suite — the 105 Windows failures, classified per failure

Gate: `node --import tsx --test tests/*.test.ts` on Windows, Node 22.23.2. Baseline
`# tests 253 / # pass 148 / # fail 105`, reproduced deterministically across runs.
Every one of the 105 was examined individually (per-failure table, 105 rows) at Bot
`fa236ff8`, before any fix was attempted.

| Mechanism | Count | Proof |
|---|---:|---|
| **M1 — `fsync()` on a *directory* handle → `EPERM` on Windows** | 101 (90 direct `EPERM: operation not permitted, fsync` + 11 assertion-shaped failures whose swallowed cause is the same `EPERM`) | Stack frames on 7 unguarded production sites (`node-bindings.ts:61` ×37, `railway-provisioning-driver.ts:89` ×27, `node-protocol.ts:60` ×16, native-runtime `atomic-binding-store` ×12, `mutations.ts:117-118` ×4, `node-registry.ts:56` ×4, `railway-credential-store.ts:36` ×1); direct experiment `open(dir,'r').sync()` → `EPERM` |
| **M2 — POSIX `stat` uid/mode predicate on a store this process just wrote** | 3 (`worker-runtime-canary.ts:12`) | Measured: `lstat.mode = 0o666` despite `{mode:0o600}`, `process.getuid === undefined` → both predicate halves permanently true on Windows |
| **M3 — POSIX shell quoting executed through `cmd.exe`** | 1 | The test builds `node -e '…|…'` → `budgetedExec` → `exec` → `cmd.exe` → `'PROJECT)?_?TOKEN$' is not recognized…`, exit 255. The argument-array probes (`execFile`, `spawn`) in the *same* test passed |

**Production-path relevance.** 104 of 105 run real Bot production code (control-plane
binding store, signed Bot↔Worker replay admission, provisioning journal, credential
store, Global-mutation rollback, Core binding registration, worker binding/session
routing, startup canary) — they are **not** dismissed as irrelevant. 1 of 105 (`M3`)
fails on a POSIX-quoted command string authored by the test, which exists nowhere in
production.

**Verdict — no latent product defect, but a real platform defect.** No failure encodes
a behavioural difference that would occur on Linux: CI runs the identical gate green
on `ubuntu-24.04`. Two supporting facts: `src/app/stores/app-state-store.ts:101`
already guarded the identical directory-fsync idiom with `process.platform !== "win32"`
while the seven sites above did not, and no POSIX API (`statvfs`, `O_DIRECTORY`,
`killpg`, `mkfifo`, `O_NOFOLLOW`, `chown`) appears anywhere in the repository. What the
105 *did* prove is that **a Windows host could not read back six of its own write-through
stores at all** — a genuine defect, now fixed (§4.4).

**Progression (all with `tsc --noEmit = 0` and `eslint --max-warnings = 0`):**

| Step | Result | Δ |
|---|---|---|
| Baseline | 148 pass / 105 fail | — |
| After §4.4 (a) directory-fsync guard | 232 pass / 21 fail | 84 fixed, **0 regressions** |
| After §4.4 (b) POSIX ownership/mode predicates | **239 pass / 14 fail** | 7 fixed, **0 regressions** |

**The remaining 14 hold no production-source failure:** 12 are the directory fsync
*inside* the published `@opencode-telegram/native-runtime` package (its source lives in
this repository under `runtime/src/runtime/atomic-binding-store.ts` and ships with the
next Core prerelease), 1 asserts `mode & 0o777 === 0o600` verbatim (`438 !== 384` because
NTFS stores no POSIX mode bits), 1 is `M3`. None is "pre-existing and ignorable": the
first is a pending Core release item (§6.1), the last two are Windows-only assumptions
inside `tests/` files.

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

### 4.2 Bot: Telegram native Stop was not attributed to the stopped generation draft

Product decision in force: the Bot exposes **exactly one** execution control — Telegram's
own Stop. Pause / Resume / Abort commands, buttons and keyboard entries were removed by the
owner and must not return. Internal cancellation primitives are implementation detail, not
a licence to re-expose a control.

| | |
|---|---|
| Reported symptom | Pressing Telegram Stop on an **old** generation draft could cancel a **newer** run of the same Topic, and cleared that newer run's interaction state |
| Claimed status before | `cancelStoppedGeneration` logged `draft=` but never used it; it called `cancelCurrentRun({ reason })` with no attribution |
| Root cause | `stopped_message_generation.draft_id` was ignored (`src/bot/middleware/auth.ts`, `cancelStoppedGeneration`). Abort scope was "the session that is live", so any live run was cancelled — violating "Stop cancels exactly that run" and "Stop must not stop a newer run". Core ships a draft-correlated stop, but the reachable Bot path never wired it |
| Second-order effect | `cancelCurrentRun` cleared interaction state **before** aborting, so an unattributable Stop also wiped a newer run's state |
| Fix | (a) `src/bot/messages/telegram-text.ts` — registry of Bot-issued generation drafts keyed by `chatId:draftId` now records the creation instant, keeps the earliest timestamp when a draft is re-sent, and registers **every** `can_stop` draft including `sendDraftBotPart`; (b) `src/app/services/current-run-cancellation-service.ts` — new `stopAttribution` option and new result `stale-draft`, checked immediately after target resolution and **before** any local state is cleared; (c) `src/bot/middleware/auth.ts` — passes `{ chatId, draftId }` |
| Attribution rule | refuse when the draft is unknown or expired, when no run is active, or when the active run started **after** the draft was issued |
| Product code changed? | Yes |
| Red → green proof | New `tests/native-stop-attribution.test.ts` (5 cases). RED: missing export → suite failed. GREEN: 7/7 together with `tests/current-run-cancellation-service.test.ts`. Mutation: guard forced to `false` → `not ok 1 - native Stop on a draft that predates the active run must not abort the newer run`; guard restored |
| Regression proof | Full local root suite run twice, with and without the change: **identical** failure name sets (105/243 pre-existing Windows-only failures; 0 new). `tsc --noEmit` exit 0, `eslint src --max-warnings=0` exit 0 |
| Landed | Bot commit `ce22712849d723008fc6f271da2065624bba960f` (pushed `4208ee70..ce227128`) |
| Linux evidence | Bot CI run `38340757408` on `ce227128` → `validate = success` (`2026-10-13T03:17:19Z`, 2m50s); Publish job `skipped` (repo-name guard) |
| Covers of `SOAK_GATES.md` §3 | Contract-level coverage of **S1** and **S5**; **S2, S3, S4, S6–S10 require the real run** and stay `PENDING` (gate G2) |

---

### 4.3 Documentation presented removed controls as current behavior

| | |
|---|---|
| Symptom | `README.md`, `PRODUCT.md`, `docs/RAILWAY.md` and the **current** release notes still documented `/abort`, `/sessions`, `/new` and pause/resume behavior — commands that are not registered anywhere in `src` |
| Verification | `bot.command(...)` registration scan over all of `src`: 33 commands, **no** `new`, `sessions`, `projects`, `abort` |
| Fix | README: command table corrected, `/abort` row replaced by the Telegram Stop contract section, verification-table row reworded; `PRODUCT.md`: command list, interaction rules, capability checklist; `docs/RAILWAY.md`: command list; `docs/release-notes/v0.26.2.md` (the notes actually served to users) no longer claims paused-Topic behavior |
| Guard | `tests/legacy-run-controls-audit.test.ts` extended with two cases: user-facing docs must not document `/pause`, `/resume`, `/abort`, and README must document Telegram Stop as the only execution control |
| Red → green proof | Both new cases failed first (`README.md still documents /abort`, `README must document the Telegram native Stop control`), then passed; file now 5/5 |
| Landed | Same commit `ce22712849d723008fc6f271da2065624bba960f` |

---

### 4.4 Bot: a Windows host could not read back six of its own write-through stores

| | |
|---|---|
| Reported symptom | 105 of 253 local Windows tests failing — 101 with `EPERM: operation not permitted, fsync`, the rest with `Invalid <store>` rejections. Per-failure classification in §3.3. |
| Claimed status before | Handled as "Windows-only, pre-existing"; the open question was *fix vs. narrow supported platforms* |
| Root cause | (a) Windows rejects `fsync()` on a **directory** handle with `EPERM`. (b) Windows has no POSIX DAC: `lstat().mode` is synthesized as `0o666` even for a file created with `{mode:0o600}`, and `process.getuid` does not exist. Eight write-through stores ran (a) after their atomic rename and six validated with (b) — so on Windows each of them threw *while writing* and, once a file existed, rejected *itself* on read. `app-state-store.ts:101` already guarded (a); the rest did not. |
| Fix | (a) new `src/utils/sync-directory.ts` — `syncDirectory()`, a no-op on `win32` and byte-identical elsewhere — routed through all eight directory barriers. (b) new `src/utils/file-ownership.ts` — `isRestrictiveMode` / `isOwnUser` / `isRootUser` — replacing the inline uid/mode predicates in six stores. Type, symlink and size checks untouched; `launcher.ts` keeps its deliberate root requirement. |
| Product code changed? | **Yes — 9 production files.** This is a genuine platform defect, not a test artifact: without it the Bot cannot persist its binding registry, replay admission, identity seeds, Worker settings, provisioning journal or credential store on Windows at all. |
| Red → green proof | Baseline `148 pass / 105 fail` → after (a) `232 / 21` → after (b) **`239 / 14`**, with **zero** tests moving from pass to fail at either step (`tsc --noEmit = 0`, `eslint --max-warnings = 0` throughout) |
| Landed | Bot commits `0b4dae91` (a) and `4bd9d4b4` (b) |
| Linux evidence | The guards are `platform === "win32"` / `getuid === undefined` only, so non-Windows executes the original code path. Bot CI @ `0b4dae91` (run `38345181835`) → `success`. |
| Still open | 12 × `EPERM` remain inside the **published** `@opencode-telegram/native-runtime` package; its source is `runtime/src/runtime/atomic-binding-store.ts` in this repository and ships with the next Core prerelease. Two Windows-only assumptions remain inside `tests/` files. Neither is a production-source failure (§3.3). |

---

### 4.5 Core documentation argued from the removed Pause/Resume/Abort controls

| | |
|---|---|
| Symptom | Core `README.md`, `docs/BOT_CORE_CALLS.md`, `docs/PAUSE_RESUME.md`, `docs/TELEGRAM_EXECUTION_CONTROL.md` and `docs/PROCESS_OWNERSHIP_MATRIX.md` still described the Bot's Pause/Resume/Abort controls as current behaviour after the product owner's **Stop-only** decision |
| Fix | Commit `c73bb1c` — 5 documents, 89 insertions / 34 deletions: Stop-only user-facing contract stated as authoritative; pause/resume/abort recorded as internal runtime primitives that are not user commands |
| Guard | `tests/test_execution_control_docs.py` — 7 cases over README, `TELEGRAM_EXECUTION_CONTROL`, `PAUSE_RESUME`, `BOT_CORE_CALLS`, `MINIMUM_TELEGRAM_RELEASE`, plus "no Core document advertises `` `/pause` ``, `` `/resume` ``, `` `/abort` `` as Bot commands". `STABILIZATION_LEDGER.md` is deliberately out of scope: it records the defect and this guard |
| Proof | `python -m unittest tests.test_execution_control_docs -v` → **7/7 OK** (local CPython 3.13.16, `EXIT=0`). On Linux the file is picked up by the CI step `Test toolchain and release contracts` (`python3 -m unittest discover -s tests -p 'test_*.py' -v`), so the guard runs on every push |
| Bot counterpart | `tests/legacy-run-controls-audit.test.ts` (5 cases, §4.3) covers the Bot repository; `CHANGELOG.md` historical entries naming `/pause` are out of scope on both sides — they describe released history, not current behaviour |

---

### 4.6 Soak harness reported passes it had not earned — found by the first executed stress run

The first `stage=stress` run (`38370753677`) executed the registered workload and, in doing
so, showed that several harness "passes" were not earned. Each defect below made the harness
assert something the evidence did not support; each was fixed red → green in the Bot
repository.

| | |
|---|---|
| Symptom 1 — a refused Stop reported as confirmed | Run `38368783928` recorded `W5/stop pass` with `confirmedBy: "message"`, while its own Bot log shows `Refused unattributable native Stop: … draft=4, reason=unknown-draft` and `result=stale-draft`. A message published after the press is equally consistent with the run having finished on its own — which is exactly what had happened |
| Symptom 2 — W6 exercised the wrong workload | The registry requires "Delete a Chat **while its run is active**". The harness deleted an *idle* Topic and counted `deleteForumTopic` attempts, so it could not see the cancel-then-cleanup path at all |
| Symptom 3 — the live-run precondition was a race | The stub model ended a run in ~0.4 s (120 tokens / 8 per piece / 25 ms), so "the run was still active when the control arrived" was a coin flip — the same ambiguity that produced symptom 1 |
| Symptom 4 — a cycle bound itself to a deleted Topic | In run `38370753677`, **2 of 167 cycles** recorded W1 with the thread id the *previous* cycle had just deleted (`10152`, `10159`). The Bot logged `Rejected stale Topic metadata` 100 ms later — it was right to refuse; W2 timed out after 90 s, W5 found no draft, W6's confirmation never arrived. Cause: `flowNewChat` waited for "threads grew **or any** message growth" and then took `at(-1)`, which during New Chat's multi-second workspace/session/binding setup was still the deleted Topic |
| Fix | `d95ed0ca` — Stop is confirmed only by the Bot's own `result=confirmed` for that exact draft, and only once a registered draft exists; a refusal surfaces as `Stop refused by the Bot: <reason>` instead of timing out. `82a1fb58` — W6 deletes during a live run, reads per-Topic evidence from the Bot's log (`deleteOutcome`), observes the topic disappearing (`topicGone`, stub now implements `deleteForumTopic`), and asserts the recreated Topic is genuinely new. `f64ae490` — the long prompt streams ~13 s (measured 12.8 s locally, vs 0.5 s), so the live-run precondition and D2 are real. `b5fb27c1` — a Topic counts as created only when an id absent from the baseline appears (`newThreadId`). `3c62a2d4` — adds the controlled restart the gates needed (`bot-restart.sh`, one materialised environment shared by first boot and every restart) |
| Guard | `tests/soak-harness.test.ts` — 13 cases over the harness's judgement rules: message-only Stop growth must not confirm; a refusal must return its reason; another Topic's delete must not satisfy this Topic's evidence; a deleted Topic's id being the newest is not a Topic being created; an unchanged pid means nothing was restarted |
| Proof | Each new signal was written as a failing test first (`TypeError: … is not a function`), then implemented → **13/13**. Full suite 252 pass / 14 fail with a failing set byte-identical to the documented Windows-only remainder (§3.3); `tsc --noEmit` and `eslint src --max-warnings=0` clean. The Stop and W6 defects were then re-measured in CI: run `38370201462` shows `draftId:1, source:"stub-draft", confirmedBy:"bot-log", confirmMs:302, lateDelta:0` with the Bot logging `result=confirmed` for `draft=1` |

**The rule this produced:** the harness may only report what it observed, and every judgement
rule must be a testable pure function. "A green workflow exit is not evidence" now has three
concrete ways it was violated, each with a regression case.

---

### 4.7 Restart readiness came from the process being stopped, and its updates were eaten — found by the queued validation cycle

The cycle queued behind the stress run (`38372649512`, executed 10:40) failed W7 — and the
failure exposed two more claims the harness could not support. Both were proven from that
run's own evidence.

| | |
|---|---|
| Symptom 1 — D5 satisfied before the new Bot booted | The record read `answered:true, pidChanged:true, withinD5:true, readyMs:13029`, but `t0` = 10:41:07.79 + 13,029 ms = **10:41:20.83**, while the new Bot's first log line is **10:41:21.109**. The "environment came back" judgement resolved before the new process existed: what grew was the process being stopped still finishing its run (`[LLM Usage] … elapsedMs=15014` at 10:41:20.769), because `flowRestart` snapshotted its baseline before the restart had produced anything attributable |
| Symptom 2 — the Topic prompt went to a process that had already exited | The Bot was SIGTERM'd with a long-poll open; the driver enqueued `/start` and the Topic prompt into that window (both in `updates.jsonl` at second 10:41:20). `telegram-api.jsonl` then shows `10:41:20.853 getUpdates note=update:1000004+1` — both handed to the dying consumer — and the new Bot's first poll returning `note=update:none` at 10:41:51.296. The queue had been drained by a process that never processed anything, so the Bot answered `/start` only when the *next* enqueue (the long prompt, after W7's 60 s window had already expired) woke the queue at 10:42:21.154. W7 reported "the Topic that existed before the restart was not served afterwards" — the Bot had never received it |
| Fix | `6ea8e28e` — two changes. (1) **Delivery is not acknowledgement:** `scripts/soak/update-queue.mjs` gives the stub Telegram's own at-least-once contract — an update is owed to some client until a later `offset` acks it, so a batch handed to a dead socket changes nothing and a restarted consumer receives everything it never confirmed (`takeBatch` no longer consumes on serve). (2) **Readiness is attributed:** `flowRestart` checkpoints `bot.log` before the restart, waits for *this* boot's own `Starting OpenCode Telegram Bot` line, and only then snapshots its baseline; `restartOutcome` now takes `bootMs`/`answerMs` and fails any answer observed before that line (`answeredAfterBoot`). `e436930b` then made the already-judged `topicGone` observation visible in every W6 record instead of only inferrable from `status=pass` |
| Guard | `tests/soak-harness.test.ts` — **14 cases**: an answer observed before the new Bot's boot line cannot satisfy D5 (the assertion carries run `38372649512`'s timestamps); a served-but-unacked update must remain queued, must be re-served to a fresh client, and may vanish only on an offset ack |
| Proof | Both rules written red first (missing module; missing field) → green. Cycle `38393226494` on `6ea8e28e` passed with `answeredAfterBoot:true, pid=2605→2749, readyMs:14938, threadId:10000` (pre-restart Topic served); cycle `38393937702` on `e436930b` repeated it (`readyMs:13938`) and recorded `topicGone:true`. Harness 14/14, `tsc --noEmit` 0, `eslint src --max-warnings=0` 0, full suite 253 pass / 14 fail with the failing set byte-identical to `bot-suite-newthread.txt` (§3.3 remainder) |

**The rule this produced:** "the environment came back" is a claim about *which process*
answered, and a response written to a socket is not proof anyone received it — the same
discipline as the Stop contract (`d95ed0ca`), now applied to readiness and to the update
queue.

---

### 4.8 The workload pressed New Chat into a run it could not see, and the restart tool refused to leave a Bot — cancelled re-run `38393992089`

The first re-run (`38393992089`, dispatched 11:59:00Z on `e436930b`) accumulated
W1 timeouts from cycle 1 on. It was cancelled at 12:46Z once all three causes were
reproduced from its own evidence — running it out would only have repeated them.
Full gate-facing accounting in `SOAK_GATES.md` §7; the mechanisms here.

| | |
|---|---|
| Symptom 1 — presses that vanished (D-A) | 3/3 New Chat presses issued while a run was streaming died: `reply-keyboard-router.ts` `menuAllowed` returns `false` on an active run *after* the router has already deleted the pressed button, so the update is consumed with no binding, no error and no reply. The consumed presses are visible as silent windows (12:04:23.341, 12:07:04.739, 12:10:34.081); each became W1's `new topic id timed out after 60000ms` exactly 60 s later (cycles 3, 5, 8). 6/6 at-rest presses passed. The trigger is the workload's own pacing: cycle N+1 began while cycle N's W6 reuse-run tail was still streaming ~13 s after W6 recorded on first growth |
| Symptom 2 — the first press hit a server still recovering (D-A2) | Cycle 1's `session.create` threw `TimeoutError` at +10.6 s (`Error creating session`, 12:00:55.184) and created no Topic. The server had reported ready at 12:00:38.009, errored in `startServer`/`notifyReady` by 12:00:41 and restarted at 12:01:06: "ready" was not "ready for session creation" |
| Symptom 3 — the restart tool killed the environment (D-B) | `bot-restart.sh` allowed 15 s before SIGKILL; the Bot's own shutdown drains up to 45 000 ms, so every restart of an active Bot escalated to SIGKILL — and `kill -0` was evaluated *immediately* after `kill -9`, succeeded against the not-yet-reaped process, and the script refused (`old bot pid=2562 is still alive after 15s`, 12:13:33.176). The old Bot died at its 45 s deadline with nothing started behind it: no Bot, and cycle 11's `/start` timed out against a dead environment. D5 = 120 s was never the constraint |
| Fix | `cf333d12` — (a) `restState` (pure: any signature change resets the clock; one reading can never claim rest) + `waitAtRest()` gates **both** New Chat presses on 5 s of unchanged output (Telegram output calls + model streams, background traffic excluded) **and** 2 s of `/global/health` healthy, bounded at 60 s, failing with its observed `quiet=`/`healthyFor=` numbers; (b) `bot-restart.sh` grace 50 s (outlasts the Bot's 45 s), zombie-aware settle after SIGKILL, only a genuinely running pid refuses, and every path writes an `exit=` marker into `bot.log` that `flowRestart` records as `restartExit`; (c) `run.sh` passes `--opencode-port`. W6's D4 window untouched (`elapsed` freezes before the reuse press) |
| Guard | `tests/soak-harness.test.ts` — red-first `restState` case: no observation is not rest, a single reading is not rest, growth (up or down) restarts the clock, quiet is measured from the last growth |
| Proof | Validation cycle `38403233051` on `cf333d12`: W1 `restWaitMs=5228` → thread 10000; **W7 `restartExit=graceful`**, pid 2551→2696, `readyMs=13942` ≤ D5 (the 50 s grace let the Bot finish its own shutdown instead of racing a kill); W6 `restWaitMs=5030`, `topicGone=true`. Re-run `38403749350` dispatched 13:17:20Z |

**The rule this produced:** a control the Bot silently declines during an active run is a
*precondition*, not a race — the workload waits for rest and for a healthy server before
pressing, and a tool that must replace a process has to outlast that process's own
shutdown and settle its death before claiming either outcome.

---

### 4.9 A failure that could not reach the verdict — run `38397066002` reported success with W1 failed

The soak-validation run (12:24:34Z, `evidence/20261013T124702Z-soak/`) exited 0 and its
workflow said **success**. Its own `cycles.jsonl` holds
`12:48:40.940 W1 new-chat fail "new topic id timed out after 60000ms"` (the D-A defect
above — the job checked out `42034f5c`, before the fix) and two `not-executed`
follow-ons; `summary.json` counted `pass: 5, fail: 0`.

| | |
|---|---|
| Cause | `cycle()` pushed every flow's return into `results` **except `flowNewChat()`'s**. `record()` had written W1's line to `cycles.jsonl`, but the tally — and therefore `summary.json` and the exit code — was built from a collection that never received it. The tally compounded the hole: an unknown status went to `counts[undefined]`, and the exit check read only `counts.fail` |
| Also unproven | The run recorded **zero** `phase:"idle"` samples: cycle 2's pre-fix 60 s W1 timeout spanned every idle window, so the phase scheduler's idle branch never executed. A green run had proved neither phasing nor its absence |
| Fix | `a8496a1e` — `flowNewChat` returns its record (spread with the threadId); `cycle()` and the smoke stage collect it; the tally becomes `tallyResults(summaries)` in `signals.mjs`, reporting any status it cannot name as `unrecognized`; the driver exits non-zero on `fail > 0 \|\| unrecognized > 0` and carries `unrecognized` in `summary.json` |
| Guard | Two red-first cases: tally behaviour (cycle summaries + bare records count; a record with no status and an unknown status each surface as `unrecognized`) and a source pin that `cycle()` collects the W1 record — the same source-pinning approach `persist-evidence.sh` already uses, because the driver executes `main()` on import and cannot be loaded into a test. Harness 20/20 |
| Proof | Red (both cases failing: `tallyResults` missing, wiring absent) → green 20/20; `node --check` 0; `tsc --noEmit` 0; `eslint src --max-warnings=0` 0; suite 273 tests / 14 fail with the failing set byte-identical to `bot-suite-newthread.txt`. Re-validation **delivered** by `38406121122`: 15 records == summary counts (`unrecognized: 0`) and 13 idle-phase rows with the §8 columns |

**The rule this produced:** a workflow verdict is only as sound as the picture its exit
code was built from — this closes the fourth way "a green workflow exit is not evidence"
was violated (after `d95ed0ca`, `6ea8e28e`, `cf333d12`), and gates now read
`cycles.jsonl`, never the verdict alone.

---

### 4.10 A Stop confirmed by an earlier Stop's confirmation — cancelled run `38403749350`

The third stress execution (13:17:20Z, `cf333d12`) proved every `cf333d12` mechanism —
W1/W6 rest gates, `restartExit=graceful`, `topicGone` ×12 — then failed W5 from cycle
10 on and was cancelled at 39 min once the cause was reproduced from its own bot.log.

| | |
|---|---|
| Symptom | Cycle 10's W5 recorded `confirmMs:2, lateDelta:1, withinD2:false` and failed; cycle 11 the same (`confirmMs:3`); cycle 12 passed with `confirmMs:3` — the normal value is ~303 ms, and draft ids had gone **…27, 31 → 1 → 4 → 7** across cycle 10's W7 restart |
| Cause | W7's restart hands the new Bot process a fresh draft-id counter while the old confirmations stay in the same `bot.log`. `stopConfirmed` took the *first* `draft=<id>, result=` match in a 512 KB tail — cycle 10's Stop matched **cycle 1's line** (`13:18:08.827 draft=1 result=confirmed`) and reported "confirmed" 2 ms after the press, before the Bot had processed it; the run that was still streaming then produced the late output charged to D2. Cycle 12's identical fake confirmation passed only by quiet luck — post-restart W5 passes were unattributed as well. The product was correct throughout: the Bot's real confirmations exist (`13:26:07.208 draft=1 thread=10018`, `13:26:48.960 draft=4`, no refusals) |
| Fix | `cc8757a0` — `stopConfirmed` gains `sinceIso` and only reads timestamped lines the Bot wrote **after this press**: first eligible match wins; pre-press confirmations are history, pre-press refusals are not this Stop's verdict, and an unparseable window never confirms (attribution fail-closed). `flowStop` passes the `t0` captured before its enqueue |
| Guard | Red-first case carrying the run's actual lines (stale `13:18:08` vs real `13:26:07`, pre-press refusal ignored, unparseable window never confirms); harness 21/21, `tsc` 0, `eslint` 0, suite 274/14 failing set byte-identical to `bot-suite-newthread.txt` |
| Proof | Validation soak `38406121122` on `a8496a1e`: all W5s confirmed with real timing (its stage has no restart, hence no id reset); idle-phase rows ×13 with §8 columns; file counts == summary counts, `unrecognized: 0`. Execution 4 `38410095535` dispatched 14:03:23Z on `cc8757a0`. Cancelled-run evidence: `evidence/20261013T131746Z-stress/` |

**The rule this produced:** an id is not identity — a judgement that matches evidence by
value must also bind it to *when* the claim was made. "The Bot said `result=confirmed`"
is only admissible for a line the Bot wrote after the press that asked, which makes this
the fifth way "a green workflow exit is not evidence" was violated (after `d95ed0ca`,
`6ea8e28e`, `cf333d12`, `a8496a1e`).

### 4.11 A session create that outran its 10 s budget after 90 minutes of accumulation - run `38410095535`

**Found by:** G1 execution 4 (`stage=stress duration=7200`, on `cc8757a0`,
2026-10-13T14:03:23Z-16:04:28Z, evidence `evidence/20261013T140350Z-stress/`). This one
is **not** a harness defect - it is the first honestly failed 2 h verdict the workload
has produced, and the first product-visible failure the soak has caught: 449 records =
434 pass + **7 fail + 8 cascade not-executed**, `summary.json` == file,
`unrecognized: 0`.

**Defect (P-1, product-visible).** During cycles 78-89, ~50% of new-session creations
failed: the Bot consumed the press, created the isolated workspace, logged
`Creating session pinned to selected model`, and the loopback `session.create` aborted
at the SDK's ~10 s timeout (`[Bot] Error creating session: TimeoutError` - 7 lines,
each ~10.8 s after its press, one per driver fail). The Bot then failed to clean the
half-built workspace (`ENOTEMPTY .../​.opencode/node_modules/effect/src` - the server
was still writing when the client gave up), orphaning 6 of 7. A user pressing New Chat
would have seen an error. Two owner decisions recorded, untouched by the harness: the
~10 s create abort has no retry, and the timeout path orphans workspaces.

**Evidence the machine was not the cause.** `memAvailable` 9.5-11.1/16 GB flat,
loadavg <= 1.1/4 CPUs, OpenCode child ~20-30 s CPU per 10 min, health 15 ms, W5 drafts
confirmed ~320 ms inside the failing window, no server restarts outside W7's own 8
(all `exit=graceful`, ready 22.9-26.0 s). Rest gates passed before every press
(`restWaitMs` 5088-26127); the cc8757a0/a8496a1e fixes held under their exact former
failure conditions (draft counter reset 31->1 with `confirmMs` 317-324, `lateDelta 0`).

**Leading hypothesis, unmeasured (M-1).** 174 topic workspaces were created in the run
and only W6 deletes remove any: ~89 accumulated, each with its own materialized
`.opencode/node_modules`. First failure at ~90 min with idle CPU is consistent with
runner disk pressure; an egress stall during dependency materialization is not
excluded. The harness never sampled disk, so the run cannot discriminate: closing that
gap (`df -B1` + `df -i`, `du -sb` + workspace count on per-cycle samples,
press-to-topic latency on W1/W6 records) is the next harness change before G1
execution 5.

**Status:** G1 `FAILED` on the books; P-1/M-1 open; full accounting in
`docs/SOAK_GATES.md` §7 ("run `38410095535`"); checkpoint state in
`docs/SOAK_CHECKPOINT.md`.

---

## 5. Soak / elapsed-time gates — **PENDING**

The workload, acceptance criteria, failure criteria, resource bounds and deadlines are now
**registered in `docs/SOAK_GATES.md`** before execution, as required. Registering them is
not running them.

No gate below has passed — and two now have a **failed** first execution recorded in
`docs/SOAK_GATES.md` §7. Per the release requirements, a stable artifact must not be
published while any of these is pending or failed.

| Gate | Required | State |
|---|---|---|
| Representative stress run | ≥ 2 h under active + idle phases | **failed — execution 1 `38370753677`: 2 h / 263 cycles, F1 ×11 (fixed `b5fb27c1`), F6, F7, no W6 v2/W7. Execution 2 `38393992089` cancelled 12:46Z (§4.8: eaten New Chat presses, cold-start session create, restart-tool refusal; fixes `cf333d12` + `a8496a1e`). Execution 3 `38403749350` cancelled 13:56Z (§4.10: Stop confirmed against pre-restart history after W7's draft-id reset; fix `cc8757a0`). Validation cycle `38403233051` + validation soak `38406121122` green. Execution 4 `38410095535` finished 2 h / 89 cycles: **failed** (§4.11: session-create aborted at the SDK's ~10 s budget in cycles 78-89 after ~174 topic workspaces accumulated; disk was never sampled — M-1; the run's own verdict integrity, rest gates, W7 ×8, and W5 attribution all held). Execution 5 pending the M-1 instrumentation — `SOAK_GATES.md` §7/§8** |
| RC soak | ≥ 24 h with active/idle phases, restarts, and rollback proof | **pending — `SOAK_GATES.md` G6/G7/G8; per §1.1 built as 5 × 21000 s segments (≥24 h, the 360-minute job ceiling bounds each, gaps reported as gaps). Phase scheduler validated by `38406121122`: 13 idle-phase rows with the §8 columns, cycles confined to active windows, counts == file with `unrecognized: 0`. Segments not started; G6 still cannot fully pass until G8 exists (§2 requires ≥1 rollback proof)** |
| Telegram Stop contract S1–S10 | every row demonstrated with captured evidence | **pending — S1/S5 by committed tests; stress run: 252/252 Stops confirmed by the Bot's own `result=confirmed` line, D1 303/311/635 ms, D2 `lateDelta` 0; per-row capture still incomplete** |
| Two-Worker isolation (W3) | interleaved message/file/state traces | **pending — not implementable in current harness (single Bot process, local stub mode)** |
| Delete Chat cleanup + Worker reuse (W6) | resource inventory before/after | **pending — W6 v2 proven in cycle `38393937702`: delete issued during an active run, `requested`/`completed` true, `topicGone: true` recorded, fresh Topic `10001` ≠ deleted `10000` and answers, `lateStreams 0`, D4 303 ms. Must still be carried by the ≥2 h stress** |
| Recovery: retry / disconnect / restart | no duplicate execution, no stale output accepted | **pending — W7 proven in cycle `38393226494`: readiness attributed to the new Bot's own boot line (the first attempt had been satisfied by the dying process — `6ea8e28e`), D5 14,938 ms, pre-restart Topic served. Must still be carried by the ≥2 h stress** |
| Restart evidence | repeated restarts observed during soak | **pending — the stress driver restarts every 10th cycle; accrues in the re-run** |
| Rollback proof | demonstrated revert to a known-good artifact | **pending — no rollback harness exists** |
| Railway physical evidence | service/deployment identity, env, resource profile | **pending — §1.6** |
| Deployment gate (CI before deploy) | operator decision on `SOAK_GATES.md` §6 | **pending — operator decision** |

Environment constraint on the soak: destructive phases require a **separate test
environment** (`SOAK_GATES.md` E1–E3). They now run headlessly in GitHub Actions on the
stub Telegram API, isolated from every production Topic, with no additional paid
resources provisioned (E3 held through all runs to date) — so that admissible-environment
clause is satisfied for W1/W2/W5/W6/W7. W3 still needs a two-Worker harness and G8 a
rollback harness; those rows stay `pending`.

Until the elapsed time has actually accrued **and passed**, the correct status of the
stable release is **blocked**.

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
8. **The shared OpenCode server's RSS grows with session churn, and cannot be attributed
   from outside the process.** Stress run `38370753677` (§5) sampled it every cycle: 538 MB
   at cycle 1 → 3 755 MB at cycle 111 (peak 4 033 MB), roughly 30 MB per cycle, with partial
   reclaim — 64 rising and 46 falling samples, so F6 as written ("grows **monotonically**
   … without reclaim") does not fire, though the trend clearly does. The Bot daemon itself
   was stable throughout (RSS 172–178 MB, heap 38–57 MB, cgroup process count 114–126), and
   this is *not* a leaked-session path: topic deletion deletes the OpenCode session
   (`deleteTelegramTopicSession` → `core.revokeBinding` → `cleanupBinding` →
   `cleanupTelegramTopicSessionMetadata` → `session.delete`, `telegram-topic-delete-service.ts:100`).
   What cannot be determined from outside is whether the retained memory is a V8 high-water
   mark or a genuine leak: the harness observes RSS but not the child's heap. Against the
   Bot's own registered envelope (`docs/PROCESS_BUDGET.md`: OpenCode server 256 MiB reserved,
   98 % pressure ceiling) the child ran 2–15× over its reservation for the whole run. Settling
   this needs an OpenCode-side heap metric or a controlled restart of the *child* (the added
   W7 flow restarts the Bot only); until then no resource claim is made either way.
9. **`SOAK_GATES.md` §5's 120 000 000-byte per-process ceiling, read literally, fails the
   current runtime on its own.** F7 fires for the Bot daemon (172 MB RSS) before it ever
   reaches the OpenCode server, and the bound is stricter than the product's own envelope
   (192 MiB reserved for the Bot daemon, 256 MiB for the OpenCode server). It is not
   interpretable as written, so it is recorded here for the registry owner rather than
   silently re-interpreted to make a gate pass — the registration rule is that a result may
   not be retro-fitted to an outcome, and the same applies to a *bound*.

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

## 8. 2026-10-14 soak continuation

This dated addendum supersedes the earlier soak status above. It does not erase the
historical observations in §§4–7.

- Core `main` is `65a11128fd0f3227bd3450f6164bf938cf2de45d`; Core pre.35 is published
  from merge `343fe1a337bb5cb84038d26d82a256a5d6a068d7`. Bot production `main` remains
  `57ac7606`; Bot PR #192 is not merged, so no production deployment was triggered.
- Bot PR #192 head `56d723714ab8eb70e0e4ee7c2b7c4d079d81e18d` contains M-1, G8, and the
  fix that prevents the soak workflow from dirtying tracked `run.sh` mode before the
  rollback checkout. Its CI run `38590435690` succeeded. Local verification: 29/29
  soak-harness tests, 282/282 full Bot tests, TypeScript, ESLint, shell syntax, and
  Node syntax checks passed.
- G8 standalone rollback proof passed in run `38590936914`, evidence
  `20261014T153745Z-cycle`. The tested SHA was `56d723714ab8eb70e0e4ee7c2b7c4d079d81e18d`,
  the explicitly supplied rollback SHA was `cf333d12f7b9da3d37ba0042b162ba7b0d188294`,
  and the latest matching successful `ci.yml` run was `38403232635` / #2573. Rollback
  took 34,826 ms against D6 300,000 ms; restore took 10,362 ms and served after boot;
  both script exits were 0. G8 is PASS. G6 remains pending until rollback is demonstrated
  within its soak segments.
- G1 execution 5 (`38585090356`) was cancelled after 25 minutes because the evidence
  persister stopped after W7 replaced the original Bot PID. It passes no gate. The
  persister now follows the run directory, and execution 6 (`38591337444`) has survived
  W7: the 15:50:32Z evidence checkpoint includes W7's 15:48:31Z restart and later cycle
  records. At that checkpoint 62 cycle records were all `pass`; the latest W1/W6
  `topicLatencyMs` values were about 2.1 seconds. Workspace bytes reached 2.23 GB while
  the runner disk was 43% used and inode headroom remained above 18 million. This is an
  interim measurement, not the G1 verdict; execution 6 is still in progress and must be
  judged from its final cycle log, summary and resource samples.
- G1 remains FAILED until a complete qualifying stress run passes; G2/G3/G4/G5/G6/G7/G9
  are still pending or failed as shown in `SOAK_GATES.md`. G10 still needs the operator's
  deployment-gate decision. No Stable Core release is authorized by this evidence.
- **M-1 count correction:** early samples in exec 6 report `workspaceCount=1`, but a
  repository inspection shows Topic directories at
  `topic-workspaces/<chatId>/<sessionId>`; the driver counted only direct chat-ID entries.
  Workspace bytes and disk samples above are real, but that count is not the number of
  Topic workspaces. Bot commit `981bf841fb1a52267c75b81aea440cb6324022f6` now counts
  nested session directories and adds a filesystem fixture test; PR CI run `38594412061`
  succeeded. Exec 6 remains pinned to `56d72371`, so use the corrected Bot revision for
  any full resource dataset that must include an accurate workspace count.


### 2026-10-14 continuation — stress-only stage phasing

**Found by:** G1 execution 6 (`38591337444`, Bot `56d72371`). Its own evidence shows
cycles stopped at `2026-10-14T16:26:05.265Z`; the first idle sample followed at
`16:26:08.940Z`, at the configured 2700 s active boundary. Workflow defaults had supplied
active/idle values to every stage, and the driver incorrectly applied the phase scheduler
to `stress`.

**Disposition:** run `38591337444` was cancelled only after its evidence established this
root cause. It passes no gate. Bot `da2728cfb2a4447bed2489791bb09125278002fe` introduces
`phaseForStage`, which confines active/idle transitions to `soak`, plus tests pinning that
`stress` and `cycle` remain active. CI run `38599189898` was still in progress when this
addendum was written. CI `38599189898` subsequently passed and corrected 7200 s execution 7 (`38599794531`) was dispatched on `da2728cf`; its stage is in progress and has no verdict yet.


**First checkpoint (interim):** evidence commit `bda832920830e0ecafd912193472642754703c6c`
for G1 execution 7 records 31/31 pass across W1/W2/W5/W6/W0 and 12 topic latencies
(mean 2,567 ms, max 2,720 ms). Workspace count reached 6, workspace bytes 1,114,198,745,
disk use 43%, free inodes 18,363,577, minimum available memory 13,988,940 KiB, and
maximum child RSS 1,228,020 KiB. These are the first ~6 minutes of a 2 h run, not gate
verdict evidence.
