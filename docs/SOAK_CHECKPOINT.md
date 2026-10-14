# Soak checkpoint — 2026-10-13 end of day (UTC)

**Purpose.** This file is the complete resume point for the soak/stabilization workstream.
It records the current repository state, each gate's standing with evidence, implemented
harness capabilities, the run ledger, the operating rules that do not change, and the
next actions in order.

Authoritative gate definitions remain in `SOAK_GATES.md`; defect history in
`STABILIZATION_LEDGER.md`. This file is the "where were we" layer on top of both.

---

## 1. Repository state at this checkpoint

| Item | Value |
|---|---|
| Bot repo | `aminsh35322088-ctrl/opencode-telegram-bot`, soak harness branch `fix/soak-evidence-through-restart`, tip **`da2728cfb2a4447bed2489791bb09125278002fe`** (pushed; PR #192; CI run `38599189898` succeeded; not merged to `main`; known local noise: ` D node_modules` (tracked symlink), untracked `control-plane/`, `runtime/` — never commit these) |
| Bot `main` | **`57ac7606`**; do not merge PR #192 while G10 deployment decision is open |
| Core repo | `aminsh35322088-ctrl/opencode-telegram-core`, branch `main`, tip **`343fe1a337bb5cb84038d26d82a256a5d6a068d7`** (pushed; Core pre.35 source) |
| Evidence branch | `origin/soak-evidence`, dirs `evidence/<stamp>-<stage>/` pushed incrementally during runs (persist interval 300 s) |
| Bot commits in play | `cf333d12` (rest precondition + restart-tool zombie/stop conventions), `a8496a1e` (tally can't lose a flow), `cc8757a0` (Stop attribution `sinceIso`) |
| Harness verification | 29/29 in `tests/soak-harness.test.ts`; full local suite 282/282; PR #192 CI run `38590435690` succeeded. The original Windows baseline had 14 known `atomic-binding-store.ts` failures; Core pre.35 includes the Windows fix. |
| Local verification commands | harness: `node --import tsx --test tests/soak-harness.test.ts`; suite: `node --import tsx --test tests/*.test.ts`; lint: `node_modules\.bin\eslint.cmd src --max-warnings=0`; `bash -n` only via `C:\Program Files\Git\bin\bash.exe`; `gh` at `C:\Program Files\GitHub CLI\gh.exe` |
| Commit style | PowerShell here-strings with `"` break `git commit -m` → write message to a file and use `git commit -F <file>` |

## 2. Gate standing at this checkpoint

| Gate | Standing | Evidence / note |
|---|---|---|
| G1 ≥2 h stress | **FAILED; execution 7 in progress** (`38599794531`) | Exec 4 remains the latest completed full-duration verdict: 434 pass + 7 fail + 8 not-executed. Exec 5 (`38585090356`) was cancelled after its evidence persister stopped after W7 changed the Bot PID. Exec 6 (`38591337444`) was cancelled after its own evidence showed `stage=stress` incorrectly entered the default idle window at the 45-minute boundary; its partial records do not qualify. Bot `da2728cf` makes only `soak` stages use active/idle phasing; CI run `38599189898` succeeded and execution 7 is the corrected full stress. |
| G2 Stop contract S1–S10 | PENDING | 252/252 confirmed in exec 1; per-row capture incomplete |
| G3 Two-Worker | PENDING | not implementable in current harness (single Bot, stub mode) |
| G4 Delete-Chat cleanup + reuse | PENDING | W6 v2 proven in cycle `38393937702`; carried by exec 4's passes, blocked by same G1 verdict |
| G5 Recovery/restart | PENDING | W7 ×8 all `exit=graceful` in exec 4 (ready 22.9–26.0 s, pid changed each time) — evidence accrues for the row, verdict still PENDING with G1 |
| G6 ≥24 h RC soak | PENDING, not started | 5 × 21000 s segments per §1.1; phase scheduler validated by `38406121122`; **cannot fully pass until G8 exists** (§2 requires ≥1 rollback proof inside the soak) |
| G7 Restart proof | PENDING | timelines recorded in cycles `38393226494`, `38393937702`, and exec 4's 8 restarts |
| G8 Rollback proof | **PASS** | Run `38590936914`, evidence `20261014T153745Z-cycle`: pinned rollback and restore both exited 0; exact CI run `38403232635` / #2573 qualified `cf333d12f7b9da3d37ba0042b162ba7b0d188294`; rollback took 34,826 ms ≤ 300,000 ms and restore served after boot. |
| G9 Resource evidence | FAILED | M-1 columns are implemented and present in cycle `38590936914`; exec 6 provides disk, workspace bytes and latency but has an undercounted `workspaceCount`. Run a full stress stage on Bot commit `981bf841` before reconsidering this gate. |
| G10 Deployment gate | PENDING — operator decision | §6 |

**No stable release while any row is PENDING or FAILED.**

## 3. G1 story (six executions completed; execution 7 in progress)

| Exec | Run | Outcome | What it found / proved |
|---|---|---|---|
| 1 | `38370753677` | FAILED verdict, ran full 2 h / 263 cycles | F1 ×11 (harness pressed New Chat blind — fixed `b5fb27c1`), F6/F7 resource columns; no W6 v2/W7 |
| 2 | `38393992089` | cancelled after root cause | D-A eaten presses, D-A2 cold-start session create, D-B restart tool refusing to leave a Bot; fixes `cf333d12` + `a8496a1e` |
| 3 | `38403749350` | cancelled at 39 min after root cause | D-E: Stop confirmed against pre-restart history (draft-id counter reset by W7); fix `cc8757a0` |
| 4 | `38410095535` | **FAILED, full 2 h / 89 cycles** | All harness fixes held (rest gates, tally, attribution under exact former failure conditions, W7 ×8). New product-visible failure P-1 + measurement gap M-1 (§2/§4.11 in ledger). Verdict honest: 7 fail + 8 cascade |
| 5 | `38585090356` | cancelled at 25 min | Evidence persister stopped after W7 changed the Bot PID; fixed on PR #192. Partial evidence; no gate passes |
| 6 | `38591337444` | cancelled after root cause | Its own resource samples show `phase:"idle"` beginning at 16:26:08Z after cycles stopped at 16:26:05Z, the configured 2700 s active boundary. `stress` must be continuously active; `phaseForStage` now applies active/idle windows only to `soak`. The count was also undercounted on this run's SHA. This partial run passes no gate |
| 7 | `38599794531` | in progress | Full 7200 s continuous stress on `da2728cfb2a4447bed2489791bb09125278002fe`; CI `38599189898` passed; build/runtime setup passed and `Run soak stage` is active. Judge only after evidence and final summary are available. |

Validation runs that de-risked the fixes between executions: cycle `38403233051`
(attribution + rest e2e), soak `38406121122` (phase scheduler + tally, success exit).

**Cancellation doctrine (unchanged):** a run is cancelled only once its root cause is
fully explained from its own evidence; otherwise let it finish and evaluate from
`cycles.jsonl`. A failed/cancelled run passes nothing; gates read the file, never the
workflow verdict alone.

## 4. M-1 instrumentation spec (implemented)

**Implemented and pushed** on Bot PR #192 (commits `7e776c3c` and `57ac7606`): df/du
parsers, disk/inode and per-cycle workspace measurements, and W1/W6 topic latency.
The first G1 attempt using this instrumentation was run `38585090356`; it was cancelled
after 25 minutes when evidence showed the checkpoint persister exited after W7 changed
the Bot PID. Its partial measurements do not qualify G1. Run `38591337444` corrected that persister, but was cancelled after its own
samples proved stress had incorrectly entered the default idle window at the 45-minute
boundary. That partial run does not qualify G1. Bot commit `da2728cf` scopes phase windows
to `soak`; the next complete stress must use this corrected head and its evidence.

**Count correction:** the workspace service stores Topic directories as
`topic-workspaces/<chatId>/<sessionId>`. Exec 6 initially counted only the direct
`chatId` entries, so its `workspaceCount=1` is not a Topic count. Bot commit `981bf841`
counts the nested session directories and has passing CI plus a fixture test; this fix
was pushed while exec 6 remained pinned to its original SHA. Its disk, workspace byte
and latency measurements remain usable, but use the corrected commit for complete §8
resource evidence.

Problem it closes: exec 4's failure could not discriminate "disk pressure from
accumulated workspaces" vs "egress stall during dependency materialization" because the
harness sampled CPU/memory but never disk.

| Piece | Where | Spec |
|---|---|---|
| `parseDfOutput(text)` | `scripts/soak/signals.mjs` (pure) | parse `df -B1 --output=size,used,avail,pcent,target <path>` → `{ sizeB, usedB, availB, pcent, target }`; fail-closed to nulls |
| `parseDuTotal(text)` | `scripts/soak/signals.mjs` (pure) | parse `du -sb <dir>` → total bytes number, or null (dir absent / error) |
| disk sampling | driver resource sampler (`resource-samples.jsonl`, ~line 825) | every sample: `df -B1` + `df -i` on the state dir (cheap metadata). Per-cycle samples only (not the 5 s idle cadence): `du -sb` of `topic-workspaces` + `readdirSync` count → `diskBytes`, `workspaceCount`, `workspaceBytes`, `inodesFree` |
| create latency | `flowNewChat` / W6 reuse record | `topicLatencyMs` = press timestamp → first observation of the new topic id (the driver already waits for it; record the delta) |
| red-first tests | `tests/soak-harness.test.ts` | df/du parsers (happy + absent-dir + malformed), source pins (sampler carries `df`/`du`, flows record `topicLatencyMs`) |

## 5. G8 rollback-proof design (implemented and validated)

**Implemented and validated** on Bot PR #192 (`57ac7606`, plus checkout-clean fix
`56d72371`). Run `38590936914` completed successfully; its cycle evidence contains the
rollback/restore proof below. The implementation details and marker contract that
follow remain the reference for future soak segments.

Hard constraints from the operator: the target is **always a pinned, explicitly supplied
SHA** (`rollbackSha`), never `HEAD^` or any implicit previous revision; qualification is
verified **mechanically at cycle time against GitHub**, never by caller claim; no
qualified target → explicit `"no qualified rollback target: …"` not-executed record (G8
stays PENDING), never a silent fallback; both SHAs recorded in evidence; after a
successful rollback, `testedSha` is restored, rebuilt, and verified serving before the
workload continues.

### 5.1 Pure judges — `scripts/soak/signals.mjs`

- `rollbackTimeline(events, d6Ms)` → `{ rollbackMs, withinD6, checkoutMs, buildMs, spawnMs, bootAfterStop, restoreMs, restoreServing }`.
  Events (epoch ms, nullable): `stop` (driver t0), `checkout`/`build`/`spawn` (script markers), `boot`/`answer` (observed), `restoreStop`/`restoreBoot`/`restoreAnswer`.
  Fail-closed: missing `stop` or `answer` → `rollbackMs: null`, `withinD6: false`;
  overrun → `withinD6: false` with `rollbackMs` present; phase markers missing → their
  durations `null` but the verdict unaffected (they are timeline detail, not the gate);
  `restoreServing` requires all three restore events with `restoreBoot >= restoreStop`
  and `restoreAnswer >= restoreBoot` (an answer that precedes its boot is the old
  process talking).
- `qualifiesCiRun(payload, sha)` → `{ qualified, runId, runNumber, conclusion, headSha, reason }`.
  Only the **latest completed run of `ci.yml` whose `head_sha` equals `sha` exactly**
  qualifies; a later failure for the same commit revokes an earlier green; in-progress
  or absent runs never qualify. The run identity travels into the cycle record.
- `rollbackPreflight({ supplied, rollbackSha, testedSha, resolvable, isAncestor, ci })`
  → `{ ok, reason, isAncestor }`; reasons are exactly
  `no qualified rollback target: rollbackSha not supplied` / `… equals testedSha` /
  `… is not a resolvable commit` / `…: <ci.reason>`. Ancestor is **preferred and
  recorded, not a gate** (health comes from CI; a divergent target that misbehaves
  fails honestly at build or D6).
- `parseRollbackScript(logText)` → `{ exit, sha, checkout, build, spawn }` parsed from
  the script's `bot-rollback:` marker lines (the script↔driver contract; tested).

### 5.2 `scripts/soak/bot-rollback.sh` (new)

`Usage: bot-rollback.sh <run-dir> <repo-dir> <rollback|restore> <sha>` — `${4:?…sha required}`
so the revision can never be defaulted; no `HEAD^`/`HEAD~` anywhere (a source-pin test
enforces this). Mechanics, mirroring `bot-restart.sh`: source `bot-env.sh`; stop the old
pid with the proven grace=50 s zombie-aware logic, marker `bot-rollback: old pid=… exit=… after …s`;
`git cat-file -e <sha>^{commit}` then `git checkout --quiet --detach <sha>`; rebuild
(`npm --prefix … run build >> rollback-<phase>.log`, failure → marker + exit 3/4);
start `node dist/index.js >> bot.log`, write `bot.pid`; final marker
`bot-rollback: phase=<p> sha=<s> checkout=<ms> build=<ms> spawn=<ms>` (epoch ms,
checkout/build = finish times) + `bot-rollback: started new pid=…`.

### 5.3 Driver — `flowRollback()` in `scripts/soak/driver.mjs`

1. Preconditions: `--rollback-script` arg present (else explicit not-executed).
2. Facts: `testedSha = git -C REPO_DIR rev-parse HEAD` (before any checkout); env
   `ROLLBACK_SHA`; resolvable via `git cat-file -e`; equal-check; ancestor via
   `git merge-base --is-ancestor` (recorded, not gating); CI via
   `fetchCiQualification(sha)` → GitHub API
   `/repos/$OC_REPO/actions/workflows/ci.yml/runs?head_sha=<sha>` with
   `GITHUB_TOKEN` bearer, 15 s abort, fail-closed on any error → payload → `qualifiesCiRun`.
3. `rollbackPreflight` decides; not ok → `record("W7","rollback","not-executed", { reason, testedSha, rollbackSha, isAncestor, ciRunId, ciReason })`.
4. Execute: beforePid, logOffset, t0 → run script phase `rollback` → parse markers +
   boot line (`Starting OpenCode Telegram Bot`) within `D.rollbackReadyMs = 300_000`
   (D6) → `/start` growth answer within the remaining budget → afterPid.
5. **Always restore** (even on rollback-leg failure): script phase `restore` with
   `testedSha`, own boot+answer window, `restoreServing` per timeline judge.
6. Verdict (mirror `flowRestart` reason precedence, D6 wording): script error/boot
   never came → no answer → pid unchanged → answer precedes boot → D6 exceeded →
   restore not serving → pass. Record carries: both SHAs, `isAncestor`, CI run identity
   (`ciRunId`, `ciRunNumber`, `ciConclusion`, `ciHeadSha`), `rollbackMs`, `withinD6`,
   phase durations, pids, exits (`rollbackExit`/`restoreExit` from markers), restore leg.
7. Wiring in `cycle()`: `if (STAGE === "cycle" || (STAGE === "soak" && index === 1)) results.push(await flowRollback());`
   — called unconditionally for those stages so the skip reason is always recorded.

### 5.4 Plumbing

`soak.yml`: input `rollback_sha` (default `""`) → stage-step env `ROLLBACK_SHA`,
`GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}`, `OC_REPO: ${{ github.repository }}`;
chmod adds `bot-rollback.sh`. `run.sh`: pass `--rollback-script "$SOAK/bot-rollback.sh"`.

### 5.5 Red-first test list (harness 21 → ~27)

rollbackTimeline (happy/D6-overrun/no-answer/no-markers/pre-boot answer/restore
variants), qualifiesCiRun (success/exact-`head_sha`/latest-failure-revokes/
in-progress/empty), rollbackPreflight (each skip reason verbatim, ancestor-not-gating,
happy), parseRollbackScript (marker contract), plumbing pins (script requires sha +
no `HEAD^`; soak.yml input + env; run.sh flag; driver wiring
`results.push(await flowRollback())`).

### 5.6 G8 validation run

`stage=cycle` with `-f rollback_sha=cf333d12` (CI success on main, ancestor of tip,
≠ tip, resolvable). Assert the cycle record carries both SHAs, the CI run identity,
the D6 timeline, and a serving restore leg. Validation evidence:
`evidence/20261014T153745Z-cycle/cycles.jsonl`, run `38590936914`, Bot tip
`56d723714ab8eb70e0e4ee7c2b7c4d079d81e18d`; `rollbackSha` is
`cf333d12f7b9da3d37ba0042b162ba7b0d188294`, the latest matching successful CI run is
`38403232635` / #2573, `rollbackMs=34826`, `withinD6=true`, `restoreMs=10362`,
`restoreServing=true`, `rollbackExit=0`, `restoreExit=0`. G8 is PASS. G6 still needs a
real rollback proof inside its soak (one per segment when `ROLLBACK_SHA` is set —
cycle index 1 of each segment).

## 6. G6 plan (starts after G1 execution 6 is complete and judged)

Five sequential `stage=soak` segments, `duration=21000` each (defaults active 2700 /
idle 900), dispatched one after another, each verified from its own `cycles.jsonl`
before the next; `rollback_sha` supplied so each segment carries one rollback proof.
Any gap between segments is reported as a gap, never smoothed over.

## 7. Run ledger

| Run | Stage | Result | Role |
|---|---|---|---|
| `38370753677` | stress 2 h | failure | G1 exec 1 (F1/F6/F7) |
| `38393992089` | stress 2 h | cancelled 12:46Z | D-A/A2/B root-caused |
| `38393226494` | cycle | success | W7/D5 proof cycle |
| `38393937702` | cycle | success | W6 v2 + W7 proof cycle |
| `38397066002` | soak | false success | D-C (flowNewChat's pass never counted) |
| `38403233051` | cycle | success | validation of cf333d12+a8496a1e e2e |
| `38403749350` | stress 2 h | cancelled 13:56Z | D-E root-caused (pre-restart Stop attribution) |
| `38406121122` | soak 180 s | success | phase scheduler + tally validation |
| `38410095535` | stress 2 h | **failure** | G1 exec 4: honest 2 h verdict; P-1 + M-1 |
| `38585090356` | stress 2 h | cancelled at 25 min | G1 exec 5: evidence persister stopped after W7 changed the Bot PID; no gate passes |
| `38590936914` | cycle | success | G8 rollback/restore proof against pinned `cf333d12`; rollback 34.826 s and restore serving |
| `38591337444` | stress 2 h | cancelled | G1 exec 6 on Bot tip `56d72371`; stress incorrectly entered idle at 45 minutes. Root cause fixed in Bot `da2728cf`; execution 7 awaits CI. |

Evidence dirs on `origin/soak-evidence` include `20261014T153745Z-cycle` (G8 validation),
`20261014T145737Z-stress` (G1 exec 5, cancelled; partial), `20261013T140350Z-stress`
(exec 4), `20261013T135754Z-soak`, `20261013T131746Z-stress`, `20261013T124702Z-stress`,
and `20261013T120033Z-stress`. Exec 6 partial evidence was durably pushed in
`20261014T163301Z-stress`; it is not qualifying gate evidence.

## 8. Operating rules that do not change

- Every unexecuted gate stays `PENDING`; nothing `stable` while any row is PENDING/FAILED.
- Verdicts come from `cycles.jsonl`, never the workflow's exit alone; `summary.json`
  must equal the file (`tallyResults` exits non-zero on fail or unrecognized).
- Stop confirmation = the Bot's own `draft=<id>, result=confirmed` line written
  **after the press that asked for it** (`stopConfirmed(…, sinceIso)`).
- Rest is the workload's precondition (`restState`/`waitAtRest` gates W1 and W6 reuse).
- Restart grace 50 s > Bot's 45 s drain; zombie-aware; `exit=` marker on every W7 record.
- G8: pinned SHA only, GitHub-mechanical qualification, explicit skip string, both SHAs
  + CI run identity in evidence, restore-and-verify before the soak continues.
- Destructive tests only in the isolated Actions environment (stub Telegram API, local
  OpenCode, no paid resources); never touch the production Worker's chat/Topics.
- Product code (`src/**`) changes are the owner's decision; the harness measures and
  records. Open owner questions at this checkpoint: P-1(a) create-abort retry policy,
  P-1(b) orphaned workspace cleanup race, §5 memory ceiling (child peak 6.66 GB vs the
  120 MB registered ceiling), G10 deployment gate.

## 9. Next actions, in order

1. **G1 execution 7** (`38599794531`): wait for the full 7200 s `stage=stress` on `da2728cfb2a4447bed2489791bb09125278002fe`; inspect its own `cycles.jsonl`, summary, and resource samples before judging. Execution 6 (`38591337444`) was cancelled after its samples proved stress entered the default idle phase at the 45-minute boundary; it passes no gate.
2. **G6**: after G1's full result is known, run five 21000 s segments sequentially with
   `rollback_sha` supplied (§6); inspect each segment's own evidence before dispatching
   the next. The correct workflow input is `rollback_sha` (underscore).
3. Resolve remaining G2/G3/G4/G5/G7/G9 evidence and the G10 operator deployment gate.
   No Stable release until every gate is admissibly closed.


### 8.1 Continuation — stress phase defect (2026-10-14)

- G1 execution 6 (`38591337444`, Bot `56d72371`) completed as `cancelled`, not a gate
  pass. Its own evidence showed the final cycle at `16:26:05.265Z`, followed by the first
  `phase:"idle"` sample at `16:26:08.940Z`; this matches the configured 2700 s active
  boundary. `phaseForStage` had applied active/idle windows to `stress`, which must be
  continuous. The run's evidence was pushed to `origin/soak-evidence` as
  `318eb674` (`20261014T163301Z-stress`).
- Bot `da2728cfb2a4447bed2489791bb09125278002fe` fixes the scheduler so only `soak`
  stages use active/idle windows and pins driver use with a regression test. Bot CI run
  `38599189898` is still in progress at this checkpoint. Once green, start a fresh 7200 s
  stress on that exact SHA; the cancelled run is not G1 evidence.
- Core documentation commit `9ed7f4ec` was current before this addendum; no gate status
  changes here. G1 and G9 remain FAILED, G8 PASS, G10 awaits the operator decision.


### 8.2 G1 execution 7 started (2026-10-14)

- Bot CI `38599189898` succeeded for `da2728cfb2a4447bed2489791bb09125278002fe`.
- G1 execution 7, run `38599794531`, was dispatched at `16:38:28Z` as a 7200 s
  `stage=stress` against `fix/soak-evidence-through-restart` at that exact SHA. Checkout,
  dependency install, pinned Core runtime verification/materialization, and build passed;
  the `Run soak stage` step is active. No gate verdict is available until the run finishes
  and its own evidence is inspected.
