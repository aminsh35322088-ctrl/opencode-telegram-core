# Soak checkpoint — 2026-10-13 end of day (UTC)

**Purpose.** This file is the complete resume point for the soak/stabilization workstream.
It is written so that work can continue from it without any conversation context: it
records the exact repository state, every gate's standing with its evidence, the finished
designs that have not yet been implemented (G8 rollback proof, M-1 instrumentation), the
run ledger, the operating rules that do not change, and the exact next actions in order.

Authoritative gate definitions remain in `SOAK_GATES.md`; defect history in
`STABILIZATION_LEDGER.md`. This file is the "where were we" layer on top of both.

---

## 1. Repository state at this checkpoint

| Item | Value |
|---|---|
| Bot repo | `aminsh35322088-ctrl/opencode-telegram-bot`, branch `main`, tip **`cc8757a0`** (pushed; working tree clean except known noise: ` D node_modules` (tracked symlink), untracked `control-plane/`, `runtime/` — never commit these) |
| Core repo | `aminsh35322088-ctrl/opencode-telegram-core`, branch `main` (this commit; pushed) |
| Evidence branch | `origin/soak-evidence`, dirs `evidence/<stamp>-<stage>/` pushed incrementally during runs (persist interval 300 s) |
| Bot commits in play | `cf333d12` (rest precondition + restart-tool zombie/stop conventions), `a8496a1e` (tally can't lose a flow), `cc8757a0` (Stop attribution `sinceIso`) |
| Harness baseline | 21/21 red-first cases in `tests/soak-harness.test.ts`; full suite baseline is `AppData/Local/Temp/opencode/bot-suite-newthread.txt` (14 known Windows failures, `atomic-binding-store.ts` in core — needs next core prerelease) |
| Local verification commands | harness: `node --import tsx --test tests/soak-harness.test.ts`; suite: `node --import tsx --test tests/*.test.ts`; lint: `node_modules\.bin\eslint.cmd src --max-warnings=0`; `bash -n` only via `C:\Program Files\Git\bin\bash.exe`; `gh` at `C:\Program Files\GitHub CLI\gh.exe` |
| Commit style | PowerShell here-strings with `"` break `git commit -m` → write message to a file and use `git commit -F <file>` |

## 2. Gate standing at this checkpoint

| Gate | Standing | Evidence / note |
|---|---|---|
| G1 ≥2 h stress | **FAILED** (execution 4, run `38410095535`) | First honest 2 h verdict: 449 records = 434 pass + 7 fail + 8 cascade not-executed, `summary.json` == file, `unrecognized: 0`. Root cause: session-create aborted at the SDK's ~10 s timeout in cycles 78–89 (P-1, product-visible); leading hypothesis = runner disk pressure from ~174 accumulated topic workspaces, **unmeasured** (M-1). Full accounting: `SOAK_GATES.md` §7 "run 38410095535", `STABILIZATION_LEDGER.md` §4.11 |
| G2 Stop contract S1–S10 | PENDING | 252/252 confirmed in exec 1; per-row capture incomplete |
| G3 Two-Worker | PENDING | not implementable in current harness (single Bot, stub mode) |
| G4 Delete-Chat cleanup + reuse | PENDING | W6 v2 proven in cycle `38393937702`; carried by exec 4's passes, blocked by same G1 verdict |
| G5 Recovery/restart | PENDING | W7 ×8 all `exit=graceful` in exec 4 (ready 22.9–26.0 s, pid changed each time) — evidence accrues for the row, verdict still PENDING with G1 |
| G6 ≥24 h RC soak | PENDING, not started | 5 × 21000 s segments per §1.1; phase scheduler validated by `38406121122`; **cannot fully pass until G8 exists** (§2 requires ≥1 rollback proof inside the soak) |
| G7 Restart proof | PENDING | timelines recorded in cycles `38393226494`, `38393937702`, and exec 4's 8 restarts |
| G8 Rollback proof | PENDING — **designed, not yet built** (§4 below) | no harness exists yet |
| G9 Resource evidence | FAILED | §8 filled from exec 1 only; exec 4 added mem/CPU/idle-phase data but M-1 (disk) is still missing |
| G10 Deployment gate | PENDING — operator decision | §6 |

**No stable release while any row is PENDING or FAILED.**

## 3. G1 story (four executions, all on the books)

| Exec | Run | Outcome | What it found / proved |
|---|---|---|---|
| 1 | `38370753677` | FAILED verdict, ran full 2 h / 263 cycles | F1 ×11 (harness pressed New Chat blind — fixed `b5fb27c1`), F6/F7 resource columns; no W6 v2/W7 |
| 2 | `38393992089` | cancelled after root cause | D-A eaten presses, D-A2 cold-start session create, D-B restart tool refusing to leave a Bot; fixes `cf333d12` + `a8496a1e` |
| 3 | `38403749350` | cancelled at 39 min after root cause | D-E: Stop confirmed against pre-restart history (draft-id counter reset by W7); fix `cc8757a0` |
| 4 | `38410095535` | **FAILED, full 2 h / 89 cycles** | All harness fixes held (rest gates, tally, attribution under exact former failure conditions, W7 ×8). New product-visible failure P-1 + measurement gap M-1 (§2/§4.11 in ledger). Verdict honest: 7 fail + 8 cascade |

Validation runs that de-risked the fixes between executions: cycle `38403233051`
(attribution + rest e2e), soak `38406121122` (phase scheduler + tally, success exit).

**Cancellation doctrine (unchanged):** a run is cancelled only once its root cause is
fully explained from its own evidence; otherwise let it finish and evaluate from
`cycles.jsonl`. A failed/cancelled run passes nothing; gates read the file, never the
workflow verdict alone.

## 4. M-1 instrumentation spec (next harness change — build this before G1 execution 5)

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

## 5. G8 rollback-proof design (fully specified — ready to build TDD red-first)

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

`stage=cycle` with `-f rollback-sha=cf333d12` (CI success on main, ancestor of tip,
≠ tip, resolvable). Assert the cycle record carries both SHAs, the CI run identity,
the D6 timeline, and a serving restore leg. G8 stays PENDING until that evidence
exists; G6 then needs ≥1 real rollback proof inside its soak (one per segment when
`ROLLBACK_SHA` is set — my call: cycle index 1 of each segment).

## 6. G6 plan (starts after G1 attempt 5 is green or its result is known)

Five sequential `stage=soak` segments, `duration=21000` each (defaults active 2700 /
idle 900), dispatched one after another, each verified from its own `cycles.jsonl`
before the next; `rollback-sha` supplied so each segment carries one rollback proof.
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

Evidence dirs on `origin/soak-evidence`: `20261013T140350Z-stress` (exec 4 — the
current focus), `20261013T135754Z-soak`, `20261013T131746Z-stress`, `20261013T124702Z-soak`,
`20261013T120033Z-stress`.

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

1. **M-1 instrumentation** (§4): red-first tests → `parseDfOutput`/`parseDuTotal` in
   signals → driver disk/du/count sampling + `topicLatencyMs` on W1/W6 records → verify
   (harness all, tsc 0, eslint 0, suite vs baseline) → commit `soak:` + push.
2. **G1 execution 5**: dispatch `stage=stress duration=7200` on the new tip; evaluate
   from `cycles.jsonl` at finish; use the new disk/latency columns to confirm or refute
   the disk hypothesis; update G1 row + §7/§4.11 accordingly.
3. **G8 build** (§5): red-first tests → judges → `bot-rollback.sh` → `flowRollback` +
   wiring → `soak.yml`/`run.sh` plumbing → verify → commit + push.
4. **G8 validation**: `stage=cycle -f rollback-sha=cf333d12`; assert the full record.
5. **G6**: five 21000 s segments with `rollback-sha` set (§6), evidence-verified one by one.
