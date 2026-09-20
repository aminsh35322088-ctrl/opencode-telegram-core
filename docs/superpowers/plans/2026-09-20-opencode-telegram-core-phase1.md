# OpenCode Telegram Core Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify a reproducible OpenCode `v1.18.31` Telegram Core release candidate with exact upstream pinning, minimal downstream build identity, matching SDK output, native session-scoped compatibility tests, and verified release packaging.

**Architecture:** Keep OpenCode upstream external. Materialize the exact locked tag/commit, apply a tiny ordered patch series, compile the official standalone Linux x64 runtime and the SDK from the same tree, validate the native v2 session contract against a local headless server, then package only artifacts that pass identity and checksum verification.

**Tech Stack:** Bash, Python 3 stdlib/unittest, Git, Bun 1.3.14, OpenCode v1.18.31, GitHub Runner Lab.

**Spec:** `docs/superpowers/specs/2026-09-20-opencode-telegram-core-design.md`

## Global Constraints

- Upstream repository: `anomalyco/opencode`.
- Upstream release: `v1.18.31`.
- Upstream commit: `014614d35b397775e5d397a490fc72368c894ec2`.
- Upstream package manager: `bun@1.3.14`.
- Initial downstream version: `1.18.31-bot.1`.
- Runtime and SDK must come from the same locked upstream revision.
- No production bot change is made until Core Phase 1 verifies.
- No new GitHub workflow is introduced for the initial build.
- Heavy work runs on GitHub Runner Lab only while lifecycle state is `SAFE`.
- Railway remains a deployment-verification environment, not a compiler.
- Any functional downstream patch beyond build identity requires a reproduced failing test first.

## Review Focus

1. A moved/retargeted upstream tag must be rejected when it no longer resolves to the exact locked SHA.
2. A wrong Bun on `PATH` must fail before dependency installation or compilation.
3. Patch drift must fail before any partial patch application.
4. Session B events must never appear on Session A's session-scoped stream/history.
5. Reconnect from durable sequence N must obey exclusive cursor semantics: only events with sequence greater than N are accepted.

---

## Planned File Structure

```text
.gitignore
LICENSES/upstream-opencode-MIT.txt
upstream/lock.json
patches/series
patches/0001-telegram-core-build-info.patch
scripts/common.sh
scripts/ensure-bun.sh
scripts/materialize-upstream.sh
scripts/apply-patches.sh
scripts/build-runtime.sh
scripts/build-sdk.sh
scripts/run-compatibility.sh
scripts/package-release.sh
scripts/verify-release.sh
tests/test_upstream.py
tests/test_patches.py
tests/test_toolchain.py
tests/test_release.py
tests/compatibility/session_contract.py
docs/superpowers/specs/...
docs/superpowers/plans/...
```

Generated `.work/` and `dist/` remain ignored.

---

### Task 1: Exact upstream lock and deterministic materialization

**Files:**
- Create: `upstream/lock.json`
- Create: `scripts/common.sh`
- Create: `scripts/materialize-upstream.sh`
- Create: `tests/test_upstream.py`
- Create: `LICENSES/upstream-opencode-MIT.txt`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: no earlier task.
- Produces: `scripts/materialize-upstream.sh [DEST]`.
- Produces: optional `CORE_UPSTREAM_LOCK=/path/to/lock.json` test override.
- Contract: exit 0 only when the requested tag resolves exactly to the locked commit and the checkout is detached/clean.

- [ ] **Step 1: Write the failing materialization tests**

Create `tests/test_upstream.py` with a local temporary Git fixture:

```python
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "materialize-upstream.sh"

class UpstreamTests(unittest.TestCase):
    def fixture(self):
        td = tempfile.TemporaryDirectory()
        root = Path(td.name)
        src = root / "src"
        src.mkdir()
        subprocess.run(["git", "init", "-q", str(src)], check=True)
        subprocess.run(["git", "-C", str(src), "config", "user.name", "test"], check=True)
        subprocess.run(["git", "-C", str(src), "config", "user.email", "test@example.invalid"], check=True)
        (src / "README.md").write_text("fixture\n")
        subprocess.run(["git", "-C", str(src), "add", "README.md"], check=True)
        subprocess.run(["git", "-C", str(src), "commit", "-qm", "fixture"], check=True)
        sha = subprocess.check_output(["git", "-C", str(src), "rev-parse", "HEAD"], text=True).strip()
        subprocess.run(["git", "-C", str(src), "tag", "v1.0.0"], check=True)
        return td, src, sha

    def test_exact_commit_materializes(self):
        td, src, sha = self.fixture()
        self.addCleanup(td.cleanup)
        lock = Path(td.name) / "lock.json"
        lock.write_text(json.dumps({
            "repository": str(src), "tag": "v1.0.0", "commit": sha,
            "version": "1.0.0", "bun": "1.3.14", "telegramCoreVersion": "1.0.0-bot.1"
        }))
        dest = Path(td.name) / "out"
        env = os.environ | {"CORE_UPSTREAM_LOCK": str(lock)}
        result = subprocess.run([str(SCRIPT), str(dest)], text=True, capture_output=True, env=env)
        self.assertEqual(result.returncode, 0, result.stderr)
        actual = subprocess.check_output(["git", "-C", str(dest), "rev-parse", "HEAD"], text=True).strip()
        self.assertEqual(actual, sha)

    def test_tag_commit_mismatch_is_rejected(self):
        td, src, sha = self.fixture()
        self.addCleanup(td.cleanup)
        lock = Path(td.name) / "lock.json"
        lock.write_text(json.dumps({
            "repository": str(src), "tag": "v1.0.0", "commit": "0" * 40,
            "version": "1.0.0", "bun": "1.3.14", "telegramCoreVersion": "1.0.0-bot.1"
        }))
        env = os.environ | {"CORE_UPSTREAM_LOCK": str(lock)}
        result = subprocess.run([str(SCRIPT), str(Path(td.name) / "out")], text=True, capture_output=True, env=env)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("commit mismatch", result.stderr.lower())
```

- [ ] **Step 2: Verify RED**

Run:

```bash
python3 -m unittest tests.test_upstream -v
```

Expected: FAIL because `scripts/materialize-upstream.sh` does not exist.

- [ ] **Step 3: Add the exact production lock**

Create `upstream/lock.json`:

```json
{
  "repository": "https://github.com/anomalyco/opencode.git",
  "tag": "v1.18.31",
  "commit": "014614d35b397775e5d397a490fc72368c894ec2",
  "version": "1.18.31",
  "bun": "1.3.14",
  "telegramCoreVersion": "1.18.31-bot.1"
}
```

- [ ] **Step 4: Implement shared helpers**

Create `scripts/common.sh`:

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

CORE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CORE_UPSTREAM_LOCK="${CORE_UPSTREAM_LOCK:-$CORE_ROOT/upstream/lock.json}"

json_get() {
  python3 - "$CORE_UPSTREAM_LOCK" "$1" <<'PY'
import json, sys
with open(sys.argv[1], "r", encoding="utf-8") as fh:
    print(json.load(fh)[sys.argv[2]])
PY
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}
```

- [ ] **Step 5: Implement materialization**

Create `scripts/materialize-upstream.sh`:

```bash
#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

dest="${1:-$CORE_ROOT/.work/opencode}"
repo="$(json_get repository)"
tag="$(json_get tag)"
expected="$(json_get commit)"

rm -rf "$dest"
mkdir -p "$(dirname "$dest")"
git init -q "$dest"
git -C "$dest" remote add origin "$repo"
git -C "$dest" fetch -q --depth=1 origin "refs/tags/$tag:refs/tags/$tag"
actual="$(git -C "$dest" rev-parse "$tag^{commit}")"
[[ "$actual" == "$expected" ]] || die "upstream commit mismatch: expected $expected, got $actual"
git -C "$dest" checkout -q --detach "$actual"
[[ -z "$(git -C "$dest" status --porcelain)" ]] || die "materialized upstream is dirty"
printf '%s\n' "$actual"
```

- [ ] **Step 6: Add license and ignore generated trees**

Copy the exact upstream MIT license into `LICENSES/upstream-opencode-MIT.txt`.

`.gitignore` must include:

```gitignore
.work/
dist/
__pycache__/
*.pyc
```

- [ ] **Step 7: Verify GREEN and commit**

Run:

```bash
python3 -m unittest tests.test_upstream -v
git diff --check
```

Expected: 2 tests PASS, diff check exit 0.

Commit:

```bash
git add .gitignore upstream scripts/common.sh scripts/materialize-upstream.sh tests/test_upstream.py LICENSES
git commit -m "feat: pin and materialize upstream OpenCode"
```

---

### Task 2: Fail-closed patch series and machine-readable build identity

**Files:**
- Create: `patches/series`
- Create: `patches/0001-telegram-core-build-info.patch`
- Create: `scripts/apply-patches.sh`
- Create: `tests/test_patches.py`
- Patch upstream only:
  - `packages/opencode/script/build.ts`
  - `packages/opencode/src/cli/cmd/debug/index.ts`

**Interfaces:**
- Consumes: exact checkout from Task 1.
- Produces: `scripts/apply-patches.sh WORKTREE`.
- Produces: runtime command `opencode debug build-info`.
- JSON fields: `upstreamVersion`, `upstreamCommit`, `telegramCoreVersion`, `telegramCoreCommit`, `sdkRevision`.

- [ ] **Step 1: Write patch tests before patch implementation**

`tests/test_patches.py` must assert:

```python
def test_series_applies_to_locked_upstream():
    # materialize exact upstream, apply series, assert build-info command exists

def test_drift_fails_before_partial_application():
    # materialize, mutate one patch context line, capture git diff,
    # run apply-patches, require non-zero, require git diff unchanged
```

The second test is the regression for Review Focus item 3.

- [ ] **Step 2: Verify RED**

Run:

```bash
python3 -m unittest tests.test_patches -v
```

Expected: FAIL because `apply-patches.sh` and patch files are absent.

- [ ] **Step 3: Create ordered series**

`patches/series` contains exactly:

```text
0001-telegram-core-build-info.patch
```

- [ ] **Step 4: Build the minimal identity patch**

The patch to `packages/opencode/script/build.ts` adds four Bun compile definitions sourced from environment variables:

```ts
OPENCODE_TELEGRAM_CORE_VERSION: JSON.stringify(process.env.OPENCODE_TELEGRAM_CORE_VERSION ?? "unknown"),
OPENCODE_TELEGRAM_CORE_COMMIT: JSON.stringify(process.env.OPENCODE_TELEGRAM_CORE_COMMIT ?? "unknown"),
OPENCODE_TELEGRAM_CORE_UPSTREAM_COMMIT: JSON.stringify(process.env.OPENCODE_TELEGRAM_CORE_UPSTREAM_COMMIT ?? "unknown"),
OPENCODE_TELEGRAM_CORE_SDK_REVISION: JSON.stringify(process.env.OPENCODE_TELEGRAM_CORE_SDK_REVISION ?? "unknown"),
```

The patch to `packages/opencode/src/cli/cmd/debug/index.ts` declares those compile constants and registers:

```ts
const BuildInfoCommand = cmd({
  command: "build-info",
  describe: "show machine-readable build identity",
  handler() {
    console.log(
      JSON.stringify({
        upstreamVersion: InstallationVersion,
        upstreamCommit: OPENCODE_TELEGRAM_CORE_UPSTREAM_COMMIT,
        telegramCoreVersion: OPENCODE_TELEGRAM_CORE_VERSION,
        telegramCoreCommit: OPENCODE_TELEGRAM_CORE_COMMIT,
        sdkRevision: OPENCODE_TELEGRAM_CORE_SDK_REVISION,
      }),
    )
  },
})
```

`DebugCommand.builder` adds `.command(BuildInfoCommand)`.

No server/session/provider behavior changes in this patch.

- [ ] **Step 5: Implement fail-closed patch application**

Create `scripts/apply-patches.sh`:

```bash
#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

tree="${1:?usage: apply-patches.sh WORKTREE}"
mapfile -t patches < <(sed -e 's/#.*$//' -e '/^[[:space:]]*$/d' "$CORE_ROOT/patches/series")

for patch in "${patches[@]}"; do
  git -C "$tree" apply --check "$CORE_ROOT/patches/$patch"
done
for patch in "${patches[@]}"; do
  git -C "$tree" apply --whitespace=error "$CORE_ROOT/patches/$patch"
done
```

All `--check` passes happen before the first mutation.

- [ ] **Step 6: Verify GREEN and commit**

Run:

```bash
python3 -m unittest tests.test_patches -v
git diff --check
```

Expected: both tests PASS.

Commit:

```bash
git add patches scripts/apply-patches.sh tests/test_patches.py
git commit -m "feat: add downstream build identity patch"
```

---

### Task 3: Exact Bun bootstrap, standalone runtime build, and matching SDK

**Files:**
- Create: `scripts/ensure-bun.sh`
- Create: `scripts/build-runtime.sh`
- Create: `scripts/build-sdk.sh`
- Create: `tests/test_toolchain.py`

**Interfaces:**
- Consumes: lock/materializer/patch series.
- Produces: `dist/runtime/opencode`.
- Produces: `dist/sdk/` and `dist/sdk/UPSTREAM_REVISION`.
- Produces: `dist/build-info.json` by executing the compiled runtime itself.

- [ ] **Step 1: Write the wrong-Bun regression test**

Create `tests/test_toolchain.py`:

```python
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
ENSURE = ROOT / "scripts" / "ensure-bun.sh"

class ToolchainTests(unittest.TestCase):
    def test_wrong_bun_is_rejected_without_install(self):
        with tempfile.TemporaryDirectory() as td:
            fake = Path(td) / "bun"
            fake.write_text("#!/usr/bin/env bash\necho 9.9.9\n")
            fake.chmod(0o755)
            env = os.environ | {
                "PATH": f"{td}:{os.environ['PATH']}",
                "CORE_BUN_NO_INSTALL": "1",
            }
            result = subprocess.run([str(ENSURE)], text=True, capture_output=True, env=env)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("expected Bun 1.3.14", result.stderr)
```

- [ ] **Step 2: Verify RED**

Run:

```bash
python3 -m unittest tests.test_toolchain -v
```

Expected: FAIL because `ensure-bun.sh` is absent.

- [ ] **Step 3: Implement exact Bun bootstrap**

`ensure-bun.sh` reads the locked version. Exact match exits 0. If missing/wrong and `CORE_BUN_NO_INSTALL=1`, it fails. Otherwise install the exact documented Bun tag:

```bash
curl -fsSL https://bun.com/install | bash -s "bun-v${expected}"
```

Then export/use `$HOME/.bun/bin` and re-check exact equality.

- [ ] **Step 4: Implement runtime build**

`build-runtime.sh` must execute:

```bash
./scripts/ensure-bun.sh
./scripts/materialize-upstream.sh .work/opencode
./scripts/apply-patches.sh .work/opencode
bun install --cwd .work/opencode --frozen-lockfile
```

Before the OpenCode build it exports:

```bash
OPENCODE_TELEGRAM_CORE_VERSION="$(json_get telegramCoreVersion)"
OPENCODE_TELEGRAM_CORE_COMMIT="${CORE_SOURCE_COMMIT:-$(git rev-parse HEAD)}"
OPENCODE_TELEGRAM_CORE_UPSTREAM_COMMIT="$(json_get commit)"
OPENCODE_TELEGRAM_CORE_SDK_REVISION="$(json_get commit)"
```

Then run the official upstream build path:

```bash
bun run --cwd .work/opencode/packages/opencode script/build.ts --single
```

Resolve exactly one generated `opencode-linux-x64/bin/opencode`, copy it to `dist/runtime/opencode`, then run:

```bash
dist/runtime/opencode --version
dist/runtime/opencode debug build-info > dist/build-info.json
```

Reject zero/multiple binary matches.

- [ ] **Step 5: Implement matching SDK build**

`build-sdk.sh` verifies `.work/opencode` HEAD equals the lock, then runs:

```bash
bun run --cwd .work/opencode/packages/sdk/js script/build.ts
```

Copy the generated SDK output to `dist/sdk/` and write the exact locked upstream SHA to `dist/sdk/UPSTREAM_REVISION`.

- [ ] **Step 6: Verify unit test GREEN**

Run:

```bash
python3 -m unittest tests.test_toolchain -v
```

Expected: PASS.

- [ ] **Step 7: Run the real build on Runner Lab**

First run Runner Lab status; proceed only when `RUNTIME_STATE=SAFE`.

Then:

```bash
./scripts/build-runtime.sh
./scripts/build-sdk.sh
./dist/runtime/opencode --version
./dist/runtime/opencode debug build-info | python3 -m json.tool
```

Expected:
- runtime build exit 0;
- SDK build exit 0;
- `--version` returns `1.18.31`;
- build-info has upstream SHA `014614d35b397775e5d397a490fc72368c894ec2`;
- build-info has Core version `1.18.31-bot.1`;
- `dist/sdk/UPSTREAM_REVISION` is the same upstream SHA.

- [ ] **Step 8: Commit**

```bash
git add scripts/ensure-bun.sh scripts/build-runtime.sh scripts/build-sdk.sh tests/test_toolchain.py
git commit -m "feat: build pinned runtime and matching SDK"
```

---

### Task 4: Native v2 session compatibility, isolation, reconnect, and concurrency

**Files:**
- Create: `tests/compatibility/session_contract.py`
- Create: `scripts/run-compatibility.sh`

**Interfaces:**
- Consumes: `dist/runtime/opencode`.
- Uses exact stable endpoints:
  - `POST /api/session`
  - `GET /api/session`
  - `GET /api/session/{sessionID}`
  - `POST /api/session/{sessionID}/interrupt`
  - `GET /api/session/{sessionID}/context`
  - `GET /api/session/{sessionID}/history`
  - `GET /api/session/{sessionID}/event` (SSE)
- Produces: deterministic local contract result with no external provider key.

- [ ] **Step 1: Create the failing contract test skeleton**

`session_contract.py` must define these real assertions before the client/harness exists:

```python
def test_session_lifecycle(client):
    a = client.create_session()
    assert client.get_session(a["id"])["id"] == a["id"]
    assert a["id"] in {item["id"] for item in client.list_sessions()}

def test_idle_interrupt_is_safe(client):
    client.interrupt(client.create_session()["id"])

def test_context_is_list(client):
    session = client.create_session()
    assert isinstance(client.context(session["id"]), list)

def test_history_after_is_exclusive(client):
    # every returned durable seq must be > requested after

def test_session_stream_isolation(client):
    # B activity may not appear on A stream/history

def test_reconnect_cursor_is_exclusive(client):
    # after=N must resume strictly after N

def test_two_session_streams_progress_concurrently(client):
    # two readers make independent progress
```

- [ ] **Step 2: Verify RED**

Run:

```bash
python3 tests/compatibility/session_contract.py --binary ./dist/runtime/opencode
```

Expected: FAIL because server/client harness is not implemented.

- [ ] **Step 3: Implement isolated server lifecycle**

The harness must:
- allocate a loopback free port;
- use temporary data/config/state directories;
- start `opencode serve --hostname 127.0.0.1 --port PORT`;
- poll a v2 endpoint until ready with a bounded timeout;
- capture stdout/stderr;
- terminate/wait in `finally`, including assertion failures.

- [ ] **Step 4: Implement stdlib HTTP/SSE client**

Use `urllib.request` and a line-based SSE parser. Non-2xx responses include response bodies in exceptions. SSE parsing accepts `data:` fields, blank-line frame termination, per-read timeout, and explicit `after` query values.

Do not invent event field names. First inspect the actual stable v2 event payload and generated SDK type; then implement one helper that extracts the session aggregate identity and durable sequence from that verified shape.

- [ ] **Step 5: Pin Review Focus 4 and 5**

Add explicit tests for:
- A/B stream isolation;
- reconnect after exact observed N;
- reconnect from empty history;
- concurrent A/B SSE readers;
- server cleanup after a deliberate assertion exception.

A failing native invariant triggers systematic debugging. Do not add a functional downstream patch in the same step.

- [ ] **Step 6: Add one-call runner**

`scripts/run-compatibility.sh`:

```bash
#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec python3 "$ROOT/tests/compatibility/session_contract.py" --binary "$ROOT/dist/runtime/opencode"
```

- [ ] **Step 7: Verify GREEN and commit**

Run:

```bash
./scripts/run-compatibility.sh
```

Expected: all lifecycle/context/interrupt/history/isolation/reconnect/concurrency tests PASS without model/provider credentials.

Commit:

```bash
git add tests/compatibility scripts/run-compatibility.sh
git commit -m "test: verify native session event contract"
```

---

### Task 5: Release packaging and fail-closed artifact verification

**Files:**
- Create: `scripts/package-release.sh`
- Create: `scripts/verify-release.sh`
- Create: `tests/test_release.py`

**Interfaces:**
- Consumes: verified runtime, SDK, `dist/build-info.json`, Core Git SHA, upstream lock.
- Produces:
  - `dist/release/opencode-telegram-core-linux-x64.tar.gz`
  - `dist/release/opencode-telegram-core-sdk.tar.gz`
  - `dist/release/build-info.json`
  - `dist/release/release-manifest.json`
  - `dist/release/SHA256SUMS`

- [ ] **Step 1: Write release tamper tests**

`tests/test_release.py` must test:
- a valid temporary manifest/checksum set verifies;
- one changed artifact byte fails checksum verification;
- wrong `upstreamCommit` fails identity verification;
- wrong `telegramCoreVersion` fails identity verification.

- [ ] **Step 2: Verify RED**

Run:

```bash
python3 -m unittest tests.test_release -v
```

Expected: FAIL because packaging/verification scripts do not exist.

- [ ] **Step 3: Implement packaging**

`package-release.sh` creates the runtime and SDK tarballs, copies `build-info.json`, writes:

```json
{
  "telegramCoreVersion": "1.18.31-bot.1",
  "telegramCoreCommit": "<40-hex Core commit>",
  "upstreamVersion": "1.18.31",
  "upstreamCommit": "014614d35b397775e5d397a490fc72368c894ec2",
  "sdkRevision": "014614d35b397775e5d397a490fc72368c894ec2",
  "platform": "linux-x64",
  "artifacts": [
    "opencode-telegram-core-linux-x64.tar.gz",
    "opencode-telegram-core-sdk.tar.gz"
  ]
}
```

Then generate `SHA256SUMS` after all artifacts are final. Never include `.work`, environment files, Runner state, tokens, caches, or Git metadata.

- [ ] **Step 4: Implement verification**

`verify-release.sh` must:
- run `sha256sum -c SHA256SUMS`;
- validate manifest values against `upstream/lock.json`;
- extract runtime to a temporary directory;
- run `opencode --version`;
- run `opencode debug build-info`;
- require binary identity to equal manifest identity;
- extract/check SDK `UPSTREAM_REVISION`;
- clean temporary files on every exit.

- [ ] **Step 5: Verify GREEN with unit and real artifacts**

Run:

```bash
python3 -m unittest tests.test_release -v
./scripts/package-release.sh
./scripts/verify-release.sh
```

Expected: tests PASS and real artifact verification exits 0.

- [ ] **Step 6: Commit**

```bash
git add scripts/package-release.sh scripts/verify-release.sh tests/test_release.py
git commit -m "feat: package and verify Telegram Core releases"
```

---

### Task 6: Full Phase 1 verification, documentation, review, and first release

**Files:**
- Modify: `README.md` only after commands have actually succeeded.
- No new functional Core patch unless a reproduced failing test from Task 4 justifies it.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: one fully verified commit suitable for tag `v1.18.31-bot.1`.
- Produces after fresh verification: GitHub Release `v1.18.31-bot.1`.

- [ ] **Step 1: Run all repository unit tests**

```bash
python3 -m unittest discover -s tests -p 'test_*.py' -v
```

Expected: 0 failures/errors.

- [ ] **Step 2: Clean generated state and rebuild**

```bash
rm -rf .work dist
./scripts/build-runtime.sh
./scripts/build-sdk.sh
```

Expected: both exit 0 from clean state.

- [ ] **Step 3: Run compatibility suite**

```bash
./scripts/run-compatibility.sh
```

Expected: all native session contract tests PASS.

- [ ] **Step 4: Package and verify**

```bash
./scripts/package-release.sh
./scripts/verify-release.sh
```

Expected: checksum and identity verification PASS.

- [ ] **Step 5: Static checks**

```bash
bash -n scripts/*.sh
python3 -m py_compile tests/*.py tests/compatibility/*.py
git diff --check
git status --short
```

Expected: syntax clean, no whitespace errors, no unintended tracked/generated changes.

- [ ] **Step 6: Update README only with proven commands**

Document:
- exact upstream lock;
- build/runtime/SDK commands;
- compatibility command;
- release artifact names;
- upgrade procedure;
- later bot pinning model.

Do not document a command that did not run successfully in this session.

- [ ] **Step 7: Commit verified docs**

```bash
git add README.md
git commit -m "docs: document verified Core build and upgrade flow"
```

- [ ] **Step 8: Whole-branch review**

Review against:
- architecture spec;
- this plan;
- five Review Focus cases;
- exact upstream lock;
- secret leakage;
- accidental Telegram UI/business logic in Core;
- unnecessary patch surface.

Critical/Important findings require a RED -> GREEN regression test and fix before release.

- [ ] **Step 9: Fresh post-review verification**

Repeat Steps 1 through 5 after the last fix commit.

Expected: all commands exit 0 with fresh output.

- [ ] **Step 10: Tag and publish**

Only after Step 9 succeeds:

```bash
git tag -a v1.18.31-bot.1 -m "OpenCode Telegram Core 1.18.31-bot.1"
git push origin v1.18.31-bot.1
gh release create v1.18.31-bot.1 \
  dist/release/opencode-telegram-core-linux-x64.tar.gz \
  dist/release/opencode-telegram-core-sdk.tar.gz \
  dist/release/build-info.json \
  dist/release/release-manifest.json \
  dist/release/SHA256SUMS \
  --title "OpenCode Telegram Core 1.18.31-bot.1" \
  --notes "Pinned OpenCode v1.18.31 Telegram Core runtime and matching SDK."
```

Expected: release tag exists and contains exactly the verified artifacts.

- [ ] **Step 11: Stop before bot migration**

Do not modify `opencode-telegram-bot` in this plan. Report the Core release plus any compatibility findings. Bot pinning and replacement/simplification of `topic-event-bus` become the next separately reviewed implementation plan.
