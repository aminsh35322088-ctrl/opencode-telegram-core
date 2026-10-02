## Latest checkpoint: headless governor merged; LSP workspace candidate preserved

Core main `640becc950605790b1fff368557885833886704a` includes PR #23.
Bot remains frozen at main471f644a/pre.7; PR189 open/unmerged. Latest Core release
pre.8; no RC/stable. Do not resume Bot until Core stable.

PR23 candidate d0bbbe20: full upstream314 pass/2 expected skips, original cancellation
repetitions, headless20 stress, compiled124344448-byte binary actual API probe (two
shells/third rejected, physical pause, same-PID resume, abort-paused cleanup/capacity).
CI37012834718 green; exact Railway native smoke4db9fb42 SUCCESS/native298/health.
Main CI37013827781 and37014223822 green. Railway restored main/no pin/staged config;
main deploymentd7aad224 sleeping normally. Existing smoke is native conformance,
NOT actual OpenCode runtime resource/soak proof.

Active worktree `/workspace/opencode-core-cancellation`, branch
`fix/lsp-workspace-lifecycle`, pushed candidate `70676cdd32a7054ceeee69172f2449e569f7dd82`,
draft PR24. Captured workspace owner registers initialization/installer processes
before handle return; closing fences publication, aborts downloads/npm, joins bounded
cleanup. Stalled startup retains helper admission until raw task settles; no late
launch through cancelled owner. Three physical causal regressions reproduced defects.
Patch0007 uses existing Bun vendor patch mechanism to stop make-fetch-happen retry
operation on cancellation; real registry/download and scheduled-backoff tests passed,
ordinary retries preserved. Exact dependency is @gar/promise-retry, which exposes
its public RetryOperation as third callback argument; generic promise-retry review
hypothesis was withdrawn after actual import-chain inspection.

Initial full gate Core npm10/upstream320 pass/2 skip/1 fixture failure: immediate
server socket-count assertion preceded TCP close event despite prompt cancellation.
Corrected fixture joins actual close with unchanged5s bound. New timer spy confirms
real60s backoff cleared; test overload typing corrected at70676c. Fresh full gate is
running; no merge claim. Diagnostic index: scratch/lsp-workspace-full-upstream.log
(initial), lsp-workspace-full-upstream-final.log (current), lsp focused/red files only
when needed. Do not bulk-read historical diagnostic captures.

Remaining Core gates: MCP startup/teardown/concurrency, PTY joined cleanup, explicit
persistent custom-daemon ownership, measured resource baselines, repeated Linux
stress, actual Railway runtime soak, artifact alignment/full audit before RC/stable.

## Latest checkpoint: MCP service ownership merged; Bot frozen

Core main `adb98f639c52fcb8c9c45a5c0f6f9f435f355bcb` includes PR #22.
Bot PR #189 remains open/unmerged; Bot source/pins/production unchanged (pre.7).
Core latest published release remains pre.8; no RC/stable.

PR #22 exact candidate `3f807822c3e421a6c4ec888452169bbcc1cf5a25`: SDK framing/client
protocol retained with Core stdio service/group ownership. Cleanup joins group death
and terminal close even when admission is disabled. Failed close propagates, keeps
owner/accounting, quarantines tools and blocks replacement. Local transport ownership
is registered before handshake; finalizer covers failed acquisitions as well as clients.
Physical disconnect, disabled-admission cleanup and review failure-path regressions
reproduced red before correction. Full upstream312 pass/2 expected skip/0 fail,
typecheck/SDK surface plus five original cancellation repeats; Linux MCP/service
stress220 pass; CI37009589230 green; focused review clean. Exact Railway native smoke
`730f77d8-6c0b-459b-af0a-7384f890fbd1` SUCCESS, native298 pass/0 fail, health succeeded.
Source independently restored main, no pin or staged config. This is NOT actual runtime soak.

Active worktree `/workspace/opencode-core-cancellation` now branch
`fix/headless-process-governor` from adb98f6. Standalone headless serve lacked governor
activation; real subprocess entrypoint regression reproduced three utility admissions
with flag unset or inherited0. Minimal activation before Server import now passes both
and20 repetitions. Focused review clean; full gate pending/running. Working source
is not yet pushed; do not discard it. Tests plus fixture are in runtime/upstream/test,
overlay installation copies headless entrypoint for the existing upstream CI gate.

Remaining gates: workspace MCP/LSP startup/teardown and concurrency, PTY joined group
cleanup, persistent custom daemon ownership, actual headless governor/binary verification,
measured resources, repeated Linux stress, aligned artifacts and actual Railway runtime
soak before RC/stable. Do not modify Bot until Core stable.

Current diagnostics: /workspace/scratch/mcp-service-acquisition-full-upstream.log
(312 pass); mcp-service-linux-stress.log (220 pass); headless-governor-red.log
(real admission bypass), headless-governor-stress.log (20 pass),
headless-governor-full-upstream.log (check current completion). Use indexed individual
logs only; do not bulk-read historical captures. Cloud subreaper test launcher remains
necessary because VM PID1 does not reap. No production change hides that concern;
actual Railway PID1/group reaping still requires evidence.

## Latest checkpoint: governed LSP process cleanup merged

Core main is now `46401de2be2140360b72e8e92d3e542090d66ca5` (PR #21).
Bot remains frozen; PR #189 open/unmerged and pre.7 production unchanged.
Core pre.8 remains latest published release; no RC/stable published.

PR #21 candidate `1874c989ee2c5956fb0af6390640f021c951f3f2` isolates governed LSP
workspace service groups, retains admission through terminal/group cleanup, joins
stop, and fences retired identities. Physical TERM-resistant stop and normal-leader-exit
regressions failed before the fix. New service helper is
`runtime/upstream/telegram-service-process.ts`; Process.spawn/stop wiring is patch 0003.
Workspace service ownership is independent of an arbitrary model run.

Verification: focused process/LSP 73 pass; expanded upstream runtime gate 241 pass,
2 expected skip, 0 fail, typecheck/SDK surface plus five original cancellation repeats
passed. Existing LSP/process tests are now in that CI gate. Linux daemon stress
20 repetitions × 5 tests = 100 pass; readiness stress 20 pass. CI 37005239835 green.
Exact candidate Railway native smoke `fe78be54-66a0-4370-bb05-9348724a1018` SUCCESS,
298 native tests/0 fail and health succeeded. Smoke source independently verified
restored to main with no pin or staged changes. This is NOT actual runtime soak.
Post-merge CI 37005753938 was in progress when recorded.

Expanded test gate exposed the prior paused-readiness test's arbitrary100ms scheduler
race. It now asserts readiness already open when cancellation completes. Removing
production readiness ensuring deterministically fails this causal assertion; restored
code passed20 repeats/full gate. No production timeout/cleanup ordering was weakened.
One earlier local command failed at EOF because the script was edited while Bash read
it; subsequent unchanged script passed. Earlier Railway candidate d43ba9e8 was cancelled
by restoring main before candidate health; excluded from passing evidence. The later
candidate was held through confirmed SUCCESS before restoration. Agent MCP504 did not
mean deployment failed; independent deployment API/check/logs verified success.

Next worktree branch: `/workspace/opencode-core-cancellation`,
`fix/mcp-workspace-process-ownership`, clean from46401de. Next scope is MCP adapter using
existing SDK framing and governed Process.spawn/service lifetime, without SDK private-field
patching or raw spawn fallback. Current MCP wrapper releases lease in close finally,
binds only leader, and best-effort pgrep cleanup is not sufficient. PTY high-level service
already has admission but leader-exit/teardown cleanup remains open. LSP workspace
startup/teardown race remains open. No claim these gates are closed by PR21.

Use these notes and docs/PROCESS_LIFECYCLE_AUDIT.md as the index; do not bulk-read old
archived diagnostics. Current bounded diagnostic names are `/workspace/scratch/daemon-*.log`:
physical red, focused73green, causal readiness mutation red, causal20stress, full241green,
Linux100stress. All meaningful implementation is pushed and merged; no VM-only source.

## Current recovery checkpoint — Core-only continuation

This section supersedes historical handoff status below. User froze Bot migration:
leave PR #189 unmerged, no intermediate pin bumps or Bot architecture changes.
Finish Core independently, verify RC and actual runtime Railway soak, then stable;
only after Core stable perform one clean Bot pre.7-to-stable migration.

- Core main: `c5d2952d217d38237dce2e02167ea1437b63bad0` (PR #20 merged).
- PR #15 renderer is merged; superseded cancellation patch was not reintroduced.
- Latest published release: `v1.18.33-bot.13-pre.8`, target
  `f110bd25419b6bedc40db36e9ae929bc4e52b9ac`. All seven asset checksums and runtime/SDK/native
  identities verified. New ShellTool active timeout and OS shell ownership fixes are newer than pre.8.
- Bot main remains `471f644aefe44950f07c2e11effced4ffca7d525`, production pinned pre.7.
- Cancellation root cause fixed in PR #16: Effect stream listener acquisition/finalizer
  registration interruption gap. Deterministic listener regression, 50 real cancellation rounds,
  disposable 300-round probe and original focused repeats passed. Do not reintroduce old patches.
- PR #19 freezes ShellTool active deadline while paused.
- PR #20 captures original governed shell execution/group identity; SIGSTOP/SIGCONT preserve
  parent/child PIDs, abort kills stopped groups, cleanup joins terminal and group death,
  uncertain admission stays retained. Retired handle.kill and failed paused attachment
  regressions reproduced red and passed after fixes. Gate only governed shell execution:
  utility Snapshot.patch cleanup must retain bounded destructive authority.
- PR #20 candidate `3887880e359d687606eaa3248fc8091f735d2d8b`: upstream 168 pass/2 expected skip,
  native 298 pass, Python 24 pass, 20 extra Linux rounds × 5 owned-shell tests = 100 pass.
  Candidate CI 36988615162 green. Post-merge CI 37003163785 and 37003428264 green.
- Railway exact candidate smoke `13f090ed-0ec5-4683-844b-3b16a4cdc786` passed;
  post-merge main smoke `b38f1fdc-76a3-46a0-b5e5-c48f46e730c9` SUCCESS. Core smoke source
  restored to main. This image runs native conformance/health, NOT a full OpenCode runtime soak.

Next blocker: persistent workspace service ownership. Focused index:
`docs/PROCESS_LIFECYCLE_AUDIT.md`, patch 0003, generated upstream MCP index.ts,
LSP util/process.ts + lsp.ts + launch.ts, core pty.ts. MCP SDK transport closes/release
uncertainty and leader-only binding remain unsafe; LSP stop does not join group death,
and workspace teardown may race startup. PTY DOES acquire governor at high-level service
(the earlier low-level adapter-only audit was incomplete), but releases on leader exit
and teardown does not join descendants. Do not attach workspace daemons to arbitrary
short-lived model runs. No fake ownership of detached browser launcher descendants.

Worktree `/workspace/opencode-core-cancellation`, branch `fix/persistent-process-ownership`
starts from c5d2952. Generated `.work/opencode-test` is disposable build output; committed
patches/overlays are authoritative. Tests run sequentially via Linux subreaper helper
`/workspace/scratch/run-subreaped.py` because Cloud PID1 does not reap. Parallel compiler/tests
once exhausted Cloud cgroup and correctly rejected admission; do not mask pressure by retries.
Bounded current diagnostic logs live in `/workspace/scratch/owned-shell-*.log`; old archived
11k-line captures are historical and need not be reread.

Remaining gates: daemon cleanup; actual runtime Railway resource baselines/soak; ownership and
stability matrix; aligned candidate artifacts; RC then stable validation. No RC/stable claim.

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


## Verified integration milestone (2026-10-02)

- Cancellation PR #16 merged at `da4f28ab9c86b1bc9949f0635426caf85a6dac22`.
  PR CI run `36975712031` and main CI `36976156363` both passed validate and
  upstream-runtime. Railway main smoke `93c6d6cb-707f-49ee-bc28-a53bad4ca57b`
  reached SUCCESS with 238 runtime tests and healthcheck success.
- Twenty additional repetitions of each original focused shell case all passed;
  none reported a process-release watchdog stall. Two watchdog snapshots instead
  showed setup waiting in FileSystem.readJson with no child under concurrent build
  load. These remain separate latency observations, not optimization evidence.
- Renderer PR #15 was refreshed at `fcef14bb7097335891be4a4d01a8619179f8a575`
  against `da4f28ab`, retaining current cancellation patches unchanged. Native
  typecheck/298 tests, upstream typecheck/SDK surface/160 tests (2 expected skips)
  plus five focused repeats, and 24 toolchain contracts passed locally. GitHub
  run `36976562712` passed both required jobs. Narrow independent integration
  review found no issues and confirmed unchanged renderer source/guards.
- Exact-candidate Railway smoke `3d2eae5e-61e1-4b8b-967b-d47654f4f438` reached
  SUCCESS with metadata SHA `fcef14bb` and healthcheck success. Bounded candidate
  build logs contained image export/health records, without a new test-count
  summary; the 298 test result is local/CI evidence. Source config was restored
  exactly to repo/main/checkSuites=false with no temporary commitSha pin or staged
  changes. Restoration itself triggered a smoke-only main deployment. No Bot
  deployment/config was changed.
- PR #15 merged at current main `983bbcfb8bb3b088faa08e92e664001d48e6cc5b`.
  Post-merge main CI/smoke still need observation. The handoff checkpoint carries
  this main forward without dropping its existing ShellTool active-time timeout
  WIP or diagnostics. That WIP is still separate from verified/released main.
- Published Core remains `v1.18.33-bot.13-pre.7`. Bot main remains `471f644a`,
  version 0.26.2, pre.7 pin, unchanged production. Next prerelease needs the
  existing compatibility/artifact verification workflow. Bot adoption, OS pause
  integration for intended processes, persistent-daemon ownership, measured
  resource pass, ownership/stability audit and RC production soak remain gates.


### Published pre.8 and adoption checkpoint (2026-10-02, supersedes status above)

- Core main is `96536368f3209bd3cbac08a9c14f6e14614f3407` after publication-evidence PR #18. PR #15 is merged. Post-merge renderer CI `36977388377` and Railway smoke `39a759b3-2110-4204-b035-0752112a9970` passed.
- Published prerelease `v1.18.33-bot.13-pre.8` targets `f110bd25419b6bedc40db36e9ae929bc4e52b9ac`. Release workflow `36979098365` succeeded. All seven downloaded asset checksums passed; actual runtime, SDK and native identities match the release commit/upstream lineage. Headless binary is 124,340,352 bytes, below the 140,000,000-byte budget. This is size validation, not before/after resource optimization evidence.
- Main publication CI `36978802720` passed; Railway smoke `02ed6c3b-6178-4cee-a7b9-6f21a6590093` succeeded. Latest documentation main smoke `148b230c-1ecb-4d53-bca8-5511c1b428b9` succeeded at `96536368`.
- Bot branch `migration/core-pre8`, PR #189, HEAD `41731663da77822a99ebb497027544a07f569fa2`, aligns immutable runtime/SDK/native pins. npm ci, package/runtime identity, lint, typecheck, build, 13 Core tests and corrected full suite (277 files / 2221 tests) passed. CI `36981517217` passed. PR remains unmerged; production/main retain pre.7 and are unchanged.
- Local Bot full-suite failure was traced to startup lifecycle fixtures calling the real remote catalog refresh. A deliberately pending fetch deterministically reproduced missing startup; mock the catalog service and refresh timer, preserving runtime behavior and timeouts. All 12 startup tests pass; independent review found no issues.
- Preserved ShellTool timeout WIP is ported to current main in Core PR #19 / branch `fix/shell-active-time`, HEAD `727a46c8a60f11251f81b995ff0912641a191e8f`. Actual tool regression is red on wall-clock sleep (kills while parent paused), green with Core activeDeadline. Typecheck, 72 focused tests (one expected skip), five further regression repeats, and CI `36981678547` passed. Independent review found no issues. Exact-candidate Railway smoke and merge are in progress. OS shell suspension remains separate; no RC/stable gate is inferred from this timer fix.
- Worktrees: `/workspace/opencode-core-cancellation` is the clean pushed PR #19 tree; `/workspace/opencode-core-renderer` holds the clean pushed publication docs; `/workspace/opencode-bot-adoption` is the clean pushed PR #189 tree. Original Bot checkout/main is unchanged. Bot generated CI tests and temporary replacement dependency directory were classified, preserved under `/workspace/scratch/bot-pre8-ci-tests-materialized` and `/workspace/scratch/bot-pre8-node-modules.private`, and original tracked tests and node_modules symlink restored. Move that private dependency directory back only in the isolated adoption worktree if further local testing needs it.
- Remaining gates: Bot producer-run/provenance/mutation fencing and true pause controls, Core OS shell suspension, governed Bot custom tools, explicit daemon ownership, sub-agent view/lifecycle adoption, measured performance/resource pass, ownership/stability audit and real RC production soak. No RC/stable published.


### ShellTool timeout integration verified (supersedes in-progress status)

- Core PR #19 merged at current main `67ab2309741e1a17f9ffcb128b90a3e43e1fd671`. Post-merge CI `36982238000` passed validate and upstream-runtime. Exact-candidate Railway deployment `d57b33c7-e29b-4dbe-b485-5b4d3335341a` verified SHA `727a46c8`, 298 native runtime tests / zero failures and successful /health. It was removed normally by restoration/main deployments.
- Independently inspected Core smoke source configuration: repo/main/checkSuites=false, no commitSha, Dockerfile.railway-smoke, /health timeout120, sleepApplication=true, sfo one replica; original fields restored. Post-merge main smoke `2448e84b-31da-49b9-abed-271438bee03b` reached SUCCESS at `67ab2309`. Production Bot was untouched.
- Published Core remains pre.8 at `f110bd25`; this subsequent ShellTool timeout fix is not in pre.8. Next prerelease must build/verify one new aligned compatibility unit before Bot adoption relies on the timer change. RC/stable remain blocked.
- Imported ShellTool active-time patch and regression are now in verified main; they are no longer checkpoint-only WIP. Precise residual-budget and actual ShellTool abort-after-pause scenarios remain to be added to the stability matrix; do not infer OS suspension from this timer test.
- Next narrow Core investigation: actual manual/model-shell process suspension. Current `CrossSpawnSpawner` captures no `CurrentTelegramExecution` resource hook; custom-tool processes already attach authoritative pause/resume/terminate resources. Preserve process-category distinctions: MCP/LSP/PTY daemon ownership is separate. Validate ownership before launch and after readiness, detach signal authority only when OS identity is safely retired, and retain governor accounting through uncertain group cleanup. Do not let delayed resume signal a reused PID/group. Trace the two actual shell paths before implementing; no broader architecture rediscovery is needed.
- Bot PR #189 remains clean/pushed at `41731663`, CI and all 2221 local tests pass; its adoption worktree is clean. Production/main remains `471f644a`/pre.7. The next Bot changes must pass immutable telegramRunId on dispatch, configure Core execution acknowledgments, preserve metadata.telegramExecution through resolveExecution and retain/recheck the returned run fence at actual delivery, replacing abort/reprompt pause only after real continuation controls work.
