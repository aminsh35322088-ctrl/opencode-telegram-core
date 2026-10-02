# Codex Cloud handoff — 2026-10-02

Scope is frozen at the user's request. Preserve this work; do not restart the migration,
merge PR #15, publish RC/stable releases, or change production during handoff.

## Exact recovery identities

- Core repository: `aminsh35322088-ctrl/opencode-telegram-core`.
- Handoff branch: `codex/cloud-handoff-2026-10-02`.
- Frozen implementation/diagnostic checkpoint HEAD: `19e2833ee9176413692af7d924be462b980eb7cb`.
- Latest verified Core main: `ef65524978b3eadd117c5fee6068cec9e1071d4a`.
- A following documentation-only commit contains this note. Its exact final SHA is
  `git rev-parse HEAD` on the remote handoff branch and is reported in the handoff response;
  a document cannot contain its own commit hash. No implementation changes follow the frozen HEAD.
- Core [PR #15](https://github.com/aminsh35322088-ctrl/opencode-telegram-core/pull/15):
  OPEN, UNMERGED; branch `feat/telegram-native-document-renderer`, HEAD
  `c36cc27418e4f1d27fb5129c80a744e1b31284d5`, based on current main `ef655249`.
  Its implementation remains preserved on its existing remote branch, separate from this checkpoint.
- Bot repository: `aminsh35322088-ctrl/opencode-telegram-bot`; branch `main`, clean HEAD
  `471f644aefe44950f07c2e11effced4ffca7d525`, already remote. No Bot source changes in this continuation.
- Published Core prerelease and Bot pin: `v1.18.33-bot.13-pre.7`, Core commit
  `ce78773da013922ffd19419fc51f894fc586aaac`. Runtime, SDK and native URLs/checksums are
  authoritative in Bot `core-release.lock.json` and `package-lock.json`.
  New pause/process/provenance work is source-only and not in pre.7.
- Bot PR #15 is a different, historical free-model bug-report PR: merged September 2;
  `bug-report-free-model-detection`, HEAD `1f61679da2d3d99fada12e85cd3f9478a61d7899`.
  Do not confuse it with the open Core renderer PR.

## Classification and scope

The complete meaningful Core source-file inventory since pre.7 is
[`core-source-files-since-pre7.txt`](core-source-files-since-pre7.txt): 53 files,
approximately 6,469 insertions / 156 deletions already on main, including serialized upstream patches.
The handoff adds the following intentional WIP:

| File | Ownership / purpose |
| --- | --- |
| `patches/0003-telegram-process-budget.patch` | Core production: ShellTool timeout reuses existing `activeDeadline` |
| `runtime/upstream/test/telegram-shell-tool.test.ts` | Core test: real ShellTool path, deterministic pending process boundary, parent/child pause |
| `docs/MIGRATION_TO_V1.md` | Docs: distinguishes timeout fix from unfinished OS lifecycle |
| `docs/handoff/2026-10-02/**` | Recovery docs, file/hash inventory, historical diagnostics and scratch investigations |

Implementation increment is two effective ShellTool source lines and one 70-line test.
The first checkpoint preserves 68 changed files, approximately 10,990 insertions / 3 deletions;
most added lines are diagnostic captures, not new architecture. Bot production/tests/docs added/deleted:
zero. No new Bot compatibility layer. Archived generated native build output is diagnostic-only,
not a runtime/vendor replacement. No intentional changed/untracked repository file was omitted.

## Current implementation and decisions

| Area | State and continuation evidence |
| --- | --- |
| Reusable result polling | IMPLEMENTED / TESTED: Core-owned bounded polling, cancellation/deadlines/fences; Bot scheduled results consume pre.7 |
| Live pause/resume | IMPLEMENTED / PARTIALLY TESTED: existing fibers, phase epochs, background frames and child ownership retained; native control acknowledgments gate work/delivery; full migration NOT COMPLETE |
| Recovery intent | IMPLEMENTED / TESTED in current main CI: persist pause intent, report unavailable continuation after restart; never replay lost side effects |
| Custom-tool `context.process.execFile` | IMPLEMENTED / TESTED on Linux in main CI: captured lease/epoch/workspace, existing governor, process-group hooks, bounded joined cleanup; Bot adoption NOT YET IMPLEMENTED |
| Native/model shell OS suspension | NOT YET IMPLEMENTED: manual `SessionPrompt.shell` and model ShellTool do not yet attach execution-lease OS pause/resume hooks |
| ShellTool active timeout | IMPLEMENTED / PARTIALLY TESTED here: RED killed while paused, GREEN no kill during pause and timeout kill after resume; abort-after-pause and precise residual budget NOT RUN |
| Event provenance | IMPLEMENTED / TESTED on main: captured original root/producer/epoch, SSE/global transport + SDK schemas, strict native `resolveExecution` run fence; Bot adoption NOT YET IMPLEMENTED |
| CrossSpawnSpawner cleanup | IMPLEMENTED / PARTIALLY TESTED: bounded terminal wait and retained uncertain admission; intermittent Linux cancellation KNOWN FAILING, cause not fixed |
| Persistent browser daemon | NOT YET IMPLEMENTED: invocation scope cannot safely own a detached/unref Playwright CLI daemon across calls |
| Renderer / Persian RTL | IMPLEMENTED / TESTED on separate PR #15; UNMERGED, not part of this checkpoint's main ancestry |
| Final ownership/performance/stability audit, aligned new artifacts, RC and production soak | NOT YET IMPLEMENTED / NOT RUN |

Why these approaches were chosen:

- **Shell cancellation:** Runner cancellation must wait for readiness OR shell completion,
  since work can exit before opening readiness. That deterministic fix is already main
  (`2d28545`). The remaining Linux stall is later in process release, not proof that readiness is fixed incorrectly.
- **Process cleanup/accounting:** `exit` is not `close`; trailing output and group cleanup
  still matter. Scope finalization and explicit kill share bounded termination. Uncertain
  cleanup must fail and retain admission, not mark capacity healthy. Leader disappearance
  alone cannot prove detached descendants died. Do not bypass the existing governor.
- **Pause:** retain original fibers/session/child frames. Abort is destructive; pause is a gate.
  Reuse the existing active deadline rather than a second timer/governance implementation.
  Do not infer full OS pause from blocked model/event publication.
- **Provenance:** capture original owner before asynchronous publication; never resolve an old
  callback to the current replacement run. Host cleanup snapshots carry identity only,
  not resource authority. Durable replay remains untagged; delivery must recheck the complete fence.
- **Telegram fencing:** canonical workspace + session + run + binding/generation/worker identity
  stays authoritative at mutation/send boundaries. General/ALL is never an execution topic;
  sub-agent views remain inspection-only. Bot pre.7 still has legacy pause/tool paths until verified Core adoption.
- **Renderer reconciliation:** PR #15 was ported onto `ef655249`; superseded shell-cancellation
  commit was omitted and current patches/series retained. Do not replace current runtime
  patches with an older PR base. Rich chunks retain current pause checkpoints and exact run fences.
- **Persian/RTL:** PR separates semantic GFM/Rich Markdown/HTML parsing, direction handling,
  and bounded native-message chunking. Unsafe links/model-authored actions fail closed;
  oversized spanning tables degrade to text rather than invalid cross-chunk spans.
  Budget/credits/nesting/quote/span/caption limits have reproducing regressions. See PR files/body;
  this handoff does not claim a new renderer implementation or independent rerun.
- **Resources/performance:** existing Railway process/category/global/memory admission remains
  authoritative. No broad performance pass or new governor is claimed. Process failure must
  fence/quarantine rather than silently release a possibly live workspace.

## Verification and exact failures

Fresh lightweight checkpoint checks:

- PASS: materialized upstream `bun run --cwd packages/opencode typecheck` with Bun 1.3.14,
  `GOMAXPROCS=2`, `GOMEMLIMIT=1536MiB`; interrupted session resumed and returned exit 0.
- PASS: from materialized `packages/opencode`,
  `bun test ./test/telegram/telegram-shell-tool.test.ts ./test/telegram/telegram-execution.test.ts --timeout 30000`:
  5 pass, 0 fail, 14 assertions. Exact test names/output in `diagnostics/checkpoint-focused-tests.log`.
- PASS: all six patches applied in order to locked upstream tar,
  each with `git apply --check --whitespace=error`, then `git apply`.
- KNOWN FAILING: `git diff --check` before the WIP commit reports serialized-patch context
  lines 746, 776, 779 as trailing whitespace (`+ `). Exit 2, preserved in
  `diagnostics/checkpoint-diff-check.log`. These are required blank context lines inside
  a patch file; blindly trimming them would damage the patch. Actual inner patch validation passes.
- PASS: Bot temporary-copy `npm ci --ignore-scripts --no-audit --no-fund`,
  `node scripts/verify-core-install.mjs`, `npm run lint`, `npm run typecheck`, `npm run build`.
- KNOWN FAILING: full Windows `npm ci --no-audit --no-fund` fails in `better-sqlite3`
  `node-gyp rebuild`: `Could not find any Python installation to use`. See `bot-npm-ci.log`.
  Build-script-disabled install is not a SQLite runtime verification.
- Earlier Windows native full suite: 203 pass / 1 skip / 34 fail, POSIX directory/binding
  fixtures; preserve exact historical errors/test names in native diagnostic logs. Linux CI is green.
  Earlier diagnostic logs also contain superseded intermediate failures; do not describe all as current.
- Earlier provenance integration failures (now fixed on main): `dispatches queued subtasks
  concurrently with bounded fan-out`, `running subtask preserves metadata after tool-call
  transition`, `running task tool preserves metadata after tool-call transition`,
  `cancel propagates from slash command subtask to child session`. Prompt staging lacked
  captured epoch; `preparePrompt` now admits the original continuation under the guard.
- NOT RUN for handoff WIP: full release matrix, Linux checkpoint CI, new artifacts, Bot Vitest
  rerun, actual OS suspension, abort-after-pause addition, performance pass, RC soak.

Latest verified remote checks:

- Core main [36903427765](https://github.com/aminsh35322088-ctrl/opencode-telegram-core/actions/runs/36903427765):
  validate/upstream-runtime SUCCESS; 238 native + 24 Python; upstream 158 pass / 2 skip;
  generated SDK/wire checks and five two-case Linux shell repeats passed.
- Bot main [36708115359](https://github.com/aminsh35322088-ctrl/opencode-telegram-bot/actions/runs/36708115359): SUCCESS.
- PR #15 latest [36910215484](https://github.com/aminsh35322088-ctrl/opencode-telegram-core/actions/runs/36910215484):
  both jobs SUCCESS; PR reports local 298 native tests/typecheck + 24 Python passed.
- PR #15 earlier [36909074671](https://github.com/aminsh35322088-ctrl/opencode-telegram-core/actions/runs/36909074671):
  validate SUCCESS, upstream-runtime FAILURE. Full upstream suite passed (158/2), then focused
  `cancel interrupts loop queued behind shell` reproduced the cancellation stall.
  `shell rejects when another shell is already running` is the other repeated target.
  Trace observes exit/SIGTERM without close while release awaits terminal notification.
  Latest green does NOT establish the root cause or close this release blocker.
- Core Railway smoke `ba1d59c6-8bd2-430c-b65a-a32a245bac4e`, main `ef655249`:
  `core_smoke_ready` at 2026-10-01T17:59:28.348Z, then idle SLEEPING at 18:04:43;
  no updated PR/checkpoint deployment or production soak claimed.
- Bot production `4c21d27a-6a1f-4d8e-8864-8f70686bec29`: SUCCESS, older commit
  `a0a0f4d0910659b9732da8650b2b3cab156f5eb6`. Production was not changed for handoff;
  no variables/restarts/deployments/releases/merges were performed.

## Reproducibility and archived investigations

All intentional source/tests/docs and meaningful text diagnostics are committed here.
`diagnostic-inventory.tsv` hashes the original copied captures; the two checkpoint logs
were created afterward. Archives are historical investigation evidence, never active runtime code.
Windows helper scripts contain original absolute paths; adapt paths before using. The authoritative
Cloud reproduction is the committed lock, patch series and overlay installer, not a temp tree.
`codex-prompt-pause-wip.ts` is an earlier scratch snapshot; current patches supersede it.
`codex-native-pause-build.mjs` is generated diagnostic output, not a second implementation.

Not copied: immutable upstream tarball (re-download locked revision), released package tarballs
(release/checksum pins), dependency caches/install trees, temporary baseline Git trees, empty
mistaken nested copy directories, and commit-message/pointer files. Their useful source state is
already represented by committed patches/tests and identities above. No stash or local history is required.
The tracked Bot `node_modules` Linux pointer was restored before scope freeze; Bot source is clean.

## First action in Codex Cloud

1. Check out Core `codex/cloud-handoff-2026-10-02`; read this file and
   `docs/MIGRATION_TO_V1.md`. Independently inspect renderer branch `c36cc274` without merging.
   Keep Bot at `471f644a` with pre.7 until Core artifacts are verified.
2. On Linux, materialize/reapply the exact current source using the existing reproducible check:

   ```bash
   bash scripts/test-upstream-runtime.sh
   ```

   Once `.work/opencode-test` exists, the exact focused continuation command is:

   ```bash
   cd .work/opencode-test/packages/opencode
   bun test test/session/prompt.test.ts --timeout 30000 \
     --test-name-pattern 'cancel interrupts loop queued behind shell|shell rejects when another shell is already running'
   ```

3. Resume the shell terminal-notification investigation from preserved watchdog/process
   evidence before claiming runtime stability. Add abort-after-pause coverage only when
   implementation scope is reopened. Then finish Core OS process ownership / persistent-daemon
   ownership, verify aligned prerelease artifacts, migrate Bot and delete obsolete paths.
   Final ownership audit, stability matrix, performance/resource checks and real RC soak remain gates.

This checkpoint is preservation, not feature completion. Development stops after remote verification.

## Cloud continuation: cancellation reader-acquisition race

Checkpoint `99a2ea9` was recovered unchanged and clean. Fix checkpoint:
`f875baec6bba414f6341bc1f567e93a110dcddc8` on the same handoff branch.

The shell stall is reproduced without SessionPrompt: cancel a real Linux shell
using `Shell.args` while merged output readers are being admitted. Bare `bash -c`
and an unconsumed handle did not expose the same race. The failing shell had exited
but one pipe retained a `readable` listener and never closed.

The installed Effect beta.83 NodeStream adapter attaches listeners synchronously,
then returns the Effect that registers their scope finalizer. Interruption in
between leaks the listener. Bun 1.3.14's exit-time `resume()` cannot drain that pipe
while it has a `readable` listener. A deterministic test interrupts the fiber from
`once("end")` after attachment: before the fix it retained one readable listener;
after the fix the listeners are removed and the pipe is destroyed. Core now wraps
only reader acquisition through finalizer registration in an uninterruptible,
suspended channel transform. Reads, cancellation, deadlines and governor retention
remain unchanged. The fix covers stdout/stderr and extra output FD adapters.

Verification on this checkpoint's source:

- Permanent process-release suite: 6 pass, 0 fail, including the deterministic
  acquisition race and 50 real Linux shell cancellations with merged output.
- Additional diagnostic probe: 300 spawn-synchronized real shell cancellations
  passed after the fix; the same probe failed on its first round before the fix.
- Fresh `scripts/test-upstream-runtime.sh`: typecheck and SDK generation/surface
  validation passed; 161 pass, 2 expected skips, 0 fail; all five focused two-case
  repeats passed with no cancellation watchdog stalls.
- Core runtime typecheck and tests: 238 pass, 0 fail.
- Python toolchain/release contracts: 24 pass.
- Focused independent code review found no actionable issues.

The VM's PID 1 does not reap orphaned descendants. The first exact baseline script
therefore had two known custom-process zombie failures and also showed a nine-second
shell-release stall despite a passing exclusive-shell assertion. Full validation
used a test-only Linux subreaper wrapper that reaps adopted descendants; production
cleanup has not been weakened. One isolated governed fixture also rejected admission
under concurrent typecheck memory pressure; after that load ended the unchanged
fixture passed, including its uncertain-admission checks.

Do not treat this local evidence as Railway or GitHub candidate evidence. The fix
needs isolated latest-main CI and Railway smoke before integration/release. Main
was still `ef655249`; PR #15 was `c36cc274` with two green checks. Production Bot
remains on its existing deployment and pre.7 pin. Renderer refresh, aligned release,
Bot adoption, resource measurements and RC/soak gates remain pending.
