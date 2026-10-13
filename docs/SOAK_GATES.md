# Soak Gates — 2-hour stress and 24-hour RC soak

**Purpose.** Durable registration of the workload, acceptance criteria, failure criteria,
resource bounds and deadlines that a soak run must satisfy *before* it is executed, so a
result cannot be retro-fitted to an outcome.

**Status.** `REGISTERED / NOT YET EXECUTED`. Every gate in §7 stays `PENDING` until real
evidence exists. A green health check, an assumed result, or "it survived N hours" is not
evidence and must never be substituted for a row in §7.

**Supersedes.** Earlier instructions to exercise Pause / Resume / Abort controls. Those
controls were removed from the Bot interface by the product owner. The only execution
control under test is **Telegram's own Stop** (Telegram update type
`stopped_message_generation`). See `README.md` (Bot) §"Execution control: Telegram Stop
only" and `docs/TELEGRAM_EXECUTION_CONTROL.md`.

**Source of the 24-hour requirement.** The stabilization prompt as recorded for this pass:
≥2 h representative stress plus ≥24 h RC soak with active/idle phases, controlled restarts
and rollback proof. The prompt text itself is not in either repository; this file is the
durable copy of its acceptance conditions.

---

## 1. Environment rules (hard constraints)

| # | Rule | Rationale |
|---|---|---|
| E1 | Destructive tests run only in a **separate test environment**. | The production Control Plane and the four `topic-node-*` Workers are not test targets. |
| E2 | No production Worker may be stopped, restarted, drained or re-bound, and no user Topic may be deleted, as part of a test. | The conversation hosting this work and the operator's active Topics must be undisturbed. |
| E3 | No paid resource may be added for testing. Test infrastructure must fit in free/included capacity. | Explicit operator constraint. |
| E4 | No production deployment may be created or rolled by a test. | The deployment gate (§6) is a separate, operator-decided change. |
| E5 | Locked inputs stay locked: upstream OpenCode `1.18.33`, Bun `1.3.14`, pinned Core runtime image digest. | Changing an input to make a gate pass invalidates the gate. |
| E6 | The harness and every result are committed/pushed **before and during** execution. | A conversation restart, VM handoff or job termination must not be able to erase in-flight work. |
| E7 | The host's remaining lifetime is measured **before** a long stage starts, and a host that ends mid-run is recorded as an interruption. | Termination of the test host is not test completion. |

If E1–E3 cannot be met, the affected gate is reported `PENDING (no admissible
environment)` and **stable is not published**.

### 1.1 Selected test host and its lifetime envelope (measured 2026-10-13)

The separate test environment is the GitHub Actions Lab VM reachable over
Tailscale, inventoried read-only before any test:

| Property | Value |
|---|---|
| Address | `100.93.106.19` (Tailscale peer `github-lab`, `tagged-devices`) — **stale**: on 2026-10-13 07:17Z `ssh runner@100.93.106.19` → `ssh: connect to host 100.93.106.19 port 22: Connection timed out` (exit 255). The peer re-registered as **`100.65.33.41`** (`tailscale status` → `github-lab … tagged-devices`; `tailscale ping github-lab` → pong via DERP sfo). Resolve the address from `tailscale status` before every session; never trust a recorded literal. |
| Host / user | `runnervmmprz5` / `runner` (uid 1001, in `docker`, passwordless `sudo`) |
| Platform | Azure `Standard_D4ads_v7`, `centralus`, kernel `6.17.0-1022-azure` |
| Resources | 4 CPU, 15 989 MB RAM (~14.7 GB available), 145 GB disk (82 GB free) |
| Tools | node 22.23.3, npm 10.9.9, git 2.55.0, docker 28.0.4, python 3.12.3, jq 1.7, gh 2.102.0, curl 8.5.0, tailscale 1.104.1 — **Bun absent** |
| Egress | `github.com` → HTTP 200 |
| Auth | `gh` authenticated as `aminsh35322088-ctrl` with `repo`/`workflow` scope |

**Lifetime (E7 evidence).** The VM is not idle infrastructure: it is the executor
of an unrelated workflow job (`GitHub-Runner-Lab`, `rdc-lab.yml`), which owns
`~/work/**` and must not be touched. Observed at `2026-10-13T04:00:07Z`:

- VM boot `00:53:34Z`, `Runner.Listener`/`Runner.Worker` started `≈00:53:58Z`.
- That job declares `timeout-minutes: 350` → hard end `≈06:43:58Z`.
- The workflow queues a **successor run**, disconnects Tailscale, saves an agent
  checkpoint and removes the optional agent token before handoff — i.e. the SSH
  endpoint and local files are **not** expected to survive.

Consequences, adopted as registered constraints:

1. A single Lab lifetime is at most ~5 h 50 min and cannot by itself contain a
   24 h soak; a 24 h RC soak must be built from resumable, evidence-preserving
   segments, and any gap is reported as a gap.
2. Test work lives in `~/soak-lab/` (a dedicated directory outside `~/work`).
3. Everything durable — harness, results, logs — is pushed to GitHub
   (`soak-evidence` branch + workflow artifacts), so host loss loses nothing.

**Stage placement decision.** The ≥2 h stress is run from a `workflow_dispatch`
Soak workflow on GitHub-hosted `ubuntu-24.04` (6 h job ceiling), which gives a
full, measured window independent of the Lab's remaining lifetime. The Lab is
used for harness bring-up and debugging. Both are free-tier capacity (E3) and
neither can reach Railway or any production Worker (E1/E2).

No dedicated `ssh` tool exists in this harness's tool catalog, so the Tailnet
connection uses plain OpenSSH per the AGENTS.md fallback ("when the dedicated
action can perform the operation"); targets remain Tailscale-only, never a
public-Internet SSH path.

---

## 2. Workload — what a cycle actually does

One *cycle* = the eight flows below, executed against the test environment, in order, with
evidence captured for each. A cycle is the unit the 2-hour and 24-hour durations are built
from.

### W1 — New Chat becomes genuinely usable
Create a new Chat/Topic. Verify **all** of: a session exists, the Topic is bound to exactly
one Worker generation, and the response route is live (the first reply of the cycle arrives
in that Topic). A "created" acknowledgement without a working reply route is a failure.

### W2 — Prompt, streamed reply, supported tool execution
Send a prompt and receive a **streamed** reply (progressive message edits, not one final
blob). During the same run, execute at least one supported tool from each exercised class
(file read/write, shell/command) and confirm its effect on disk is visible afterwards.

### W3 — Two independent Workers, no cross-talk
Run the same workload concurrently on two Topics bound to two different Workers. Assert
that messages, files, settings and runtime state never cross: no message delivered to the
wrong Topic, no file written outside the Topic's own `/data` volume, no settings change
visible in the other Topic, no state key shared.

### W4 — Question and permission ownership
Trigger a prompt that produces a question and a permission prompt. Answer both from the
owning Topic only. Then attempt to answer them from the other Topic and assert the attempt
is **rejected** and does not act on the owner's run.

### W5 — Telegram Stop, end to end
While a model run and a tool of that run are in flight, press Telegram's own Stop on the
draft being generated. Trace the whole path (event receipt → attribution → cancellation →
cleanup) and assert every row of §3.

### W6 — Delete Chat during execution, then reuse the Worker
Delete a Chat while its run is active. Assert full cleanup, then create a **new** Topic and
assert it is served by the **same** Worker and works normally.

### W7 — Retries, disconnects, controlled restart, rollback
Repeat a request after a timeout; drop the transport mid-run; perform one controlled
restart of the test environment. After recovery assert: no duplicate execution of the
repeated request, no acceptance or emission of output belonging to the previous generation,
and no stale delivery. Then restore the previous revision and assert rollback works.

### W8 — Resource measurement
After **every** cycle measure RSS, CPU time, process count and remaining resource headroom
for the test environment's processes, and record them in §8.

### Duration build-up

| Phase | Content | Length |
|---|---|---|
| Stress | Back-to-back cycles W1–W8 with an active phase (continuous load) | ≥ 2 h wall clock |
| RC soak | Cycles spread over 24 h with **active** and **idle** phases, including ≥1 controlled restart and ≥1 rollback proof | ≥ 24 h wall clock |

---

## 3. Acceptance criteria — Telegram Stop (W5)

Each row must be **demonstrated by captured evidence**, not asserted by the harness.

| ID | Requirement |
|----|-------------|
| S1 | Stop cancels the model execution and the dependent work belonging to **exactly** the run that produced the stopped draft. |
| S2 | Late output from the stopped run ceases after the stop is confirmed. |
| S3 | Resources of that run are released per the Core contract (no orphan process, socket, temp file or lease). |
| S4 | Stop does **not** stop another Topic's run. |
| S5 | Stop does **not** stop a newer run of the same Topic (a Stop whose draft belongs to an earlier generation is refused as `stale-draft`). |
| S6 | Stop does **not** delete the session or its history. |
| S7 | Stop does **not** detach the Worker from the Topic. |
| S8 | After the stop completes, the same Topic accepts and answers the next message. |
| S9 | Stop is never presented as pause; the stopped run offers no resume. |
| S10 | No Pause / Resume / Abort command or button is reachable from Telegram. |

**Stop is accepted only when cancellation is confirmed.** A timeout or lost acknowledgment
is reported as *unconfirmed*, never as success.

---

## 4. Failure criteria

A run fails (and the gate stays `PENDING`/`FAILED`, never `PASSED`) if **any** of the
following occurs:

- F1 — Any row of §3 is not demonstrated.
- F2 — Cross-topic contamination of messages, files, settings or state (W3).
- F3 — A question or permission prompt is answerable by a non-owner, or a non-owner's
  answer affects the owner's run (W4).
- F4 — Delete Chat leaves residue, or the subsequent Topic is not served by the same
  Worker (W6).
- F5 — After recovery, a repeated request executes twice, or stale/previous-generation
  output is accepted or emitted (W7).
- F6 — Process count fails to return to the pre-cycle baseline, or RSS grows monotonically
  across cycles without reclaim (W8).
- F7 — Any process exceeds the 120,000,000-byte runtime ceiling.
- F8 — A Stop exceeds its deadline (§5), or cleanup exceeds its deadline (§5).
- F9 — A health check that is green while any of F1–F8 holds. **Green health is not
  evidence.**

---

## 5. Resource bounds and deadlines (registered before execution)

### Resource bounds

| Bound | Value |
|---|---|
| Runtime byte ceiling, any single process | 120,000,000 bytes (hard) |
| Process count after cleanup | must return to the pre-cycle baseline (±0) |
| RSS after a full cycle + cleanup | ≤ RSS at the same cycle's start + 150 MB |
| RSS trend | no monotonic growth across three consecutive cycles |
| Total additional infrastructure for testing | 0 paid resources (E3) |
| Test-environment concurrency | ≤ 2 Topics active at once (W3 needs exactly 2); never touches production Topics |
| Wall-clock budget for the stress phase | ≥ 2 h; the run is stopped and marked `PENDING` if it cannot complete |

### Deadlines

| # | Event | Deadline |
|---|---|---|
| D1 | Stop: event receipt → cancellation confirmed | ≤ 5,000 ms typical, ≤ 30,000 ms absolute |
| D2 | Stop confirmed → late output from that run ceases | ≤ 2,000 ms |
| D3 | Stop confirmed → run resources released (processes, sockets, temp files, leases) | ≤ 30,000 ms |
| D4 | Delete Chat issued → all its resources reclaimed | ≤ 60,000 ms |
| D5 | Controlled restart → environment ready and answering | ≤ 120,000 ms |
| D6 | Rollback → previous revision serving traffic | ≤ 300,000 ms |
| D7 | Topic usable for the next message after a Stop | ≤ 10,000 ms after D1 completes |

Missing any deadline is F8.

---

## 6. Deployment gate (separate from soak, operator decision required)

**Problem.** Railway creates a production deployment about one second after every push,
while Bot CI takes 2–5 minutes. Five commits whose CI failed were therefore deployed to
production on 2026-10-12. A commit can reach production before its own CI result exists.

**Solution to be evaluated by the operator** (not applied unilaterally, because it changes
production deployment behaviour):

1. Move Railway's build trigger off *every push to main* and onto a **published release
   artifact / successful workflow completion**, so deployment consumes a CI-green result
   instead of racing it.
2. If a push-triggered deploy must remain, add a **required status check** so the branch
   cannot advance while CI is running, and keep an automatic rollback to the last green
   revision when a post-deploy check fails.

**Effect of change.** (a) Failed commits stop reaching production — that is the goal.
(b) Deploys gain a latency equal to CI duration (today 2–5 minutes), so a hotfix lands
later than it does now. (c) Rollback becomes part of the normal path rather than an
incident response. (d) A CI outage now blocks deploys, so CI availability becomes part of
the release path. These are the trade-offs the operator is being asked to accept or
reject. **No production deployment configuration has been modified.**

---

## 7. Gate status

| Gate | Evidence required | Status |
|---|---|---|
| G1 ≥2 h representative stress | Timestamped cycle log + §3 results + §8 measurements | `FAILED` — execution 1 `38370753677` ran 2 h / 263 cycles (F1 ×11, F6, F7; no W6 v2/W7); execution 2 `38393992089` **cancelled** once three harness defects were root-caused (D-A eaten New Chat presses, D-A2 cold-start session create, D-B restart-tool refusal; accounting below); execution 3 `38403749350` **cancelled at 39 min** once W5's failures were root-caused — the Stop confirmation matched *pre-restart* history after W7 reset the draft-id counter (accounting below). A cancelled run passes nothing. Fixes `cf333d12`, `a8496a1e`, `cc8757a0`; validation cycle `38403233051` and validation soak `38406121122` green; execution 4 `38410095535` on `cc8757a0` in flight. |
| G2 Telegram Stop contract (S1–S10) | Per-row captured evidence | `PENDING` (S1/S5 unit+contract tests green; stress run: 252/252 Stops confirmed by the Bot's `result=confirmed` line, D1 ≤ 635 ms, D2 `lateDelta` 0 — per-row capture still incomplete) |
| G3 Two-Worker isolation (W3) | Interleaved message/file/state traces from both Topics | `PENDING` — not implementable yet: single Bot process, local stub mode |
| G4 Delete Chat cleanup + Worker reuse (W6) | Resource inventory before/after | `PENDING` — W6 v2 proven in cycle `38393937702` (`requested`/`completed` true, `topicGone: true` recorded, `reuse=10001` ≠ deleted `10000`, `lateStreams 0`, D4 303 ms); it must still be carried by the ≥2 h stress |
| G5 Recovery: retry, disconnect, restart (W7) | Generation/fence logs proving no duplicate and no stale output | `PENDING` — W7 proven in cycles `38393226494` and `38393937702`; must still be carried by the ≥2 h stress |
| G6 ≥24 h RC soak with active/idle phases | Full 24 h log | `PENDING` — per §1.1, built as 5 × 21000 s sequential segments (≥24 h total; the workflow's 360-minute job ceiling bounds each segment, and any gap is reported as a gap); not started. The phase scheduler is now **validated**: run `38406121122` (stage=soak, 180 s, active 30/idle 30) produced 13 `phase:"idle"` sample rows carrying the §8 columns (`cpuTimeS`, `memTotalKb`/`memAvailableKb`, RSS breakdown) with cycles confined to active windows, and its `summary.json` counts matched `cycles.jsonl` exactly (`unrecognized: 0`). G6 still cannot fully pass until G8 exists (§2 requires ≥1 rollback proof inside the soak). |
| G7 Controlled restart proof | Restart timeline vs D5 | `PENDING` — timeline recorded in cycles `38393226494` and `38393937702` (SIGTERM → this restart's own boot line → answer = 14,938 ms / 13,938 ms ≤ 120,000 ms, pre-restart Topic served); must still repeat inside the ≥2 h stress |
| G8 Rollback proof | Revision timeline vs D6 | `PENDING` — no rollback harness exists yet |
| G9 Resource evidence (§5) | Per-cycle RSS/CPU/process/headroom table (§8) | `FAILED` — §8 filled from run `38370753677`: F6 and F7 fired; CPU time and system headroom were never sampled by the harness, so those columns are also incomplete evidence. The sampling landed in bot `42034f5c` (`cpuTimeS`, `memTotalKb`/`memAvailableKb`, `phase` rows incl. idle); no run yet carries those columns, so the status stays `FAILED` until §8 is refilled |
| G10 Deployment gate fix | Operator decision on §6 | `PENDING — operator decision` |

**No stable release may be published while any row above is `PENDING`.**

### Evidence accounting for run `38370753677`

2026-10-13 `evidence/20261013T083958Z-stress/` — 263 cycles, 1,315 records,
2 h 00 m 59 s, `main@d95ed0ca`, job exit 1.

- **F1 fired in 11 of 263 cycles.** W1 recorded the *previous* cycle's deleted
  Topic id, so W2 prompted a Topic that no longer existed (90 s timeout), W5 was
  `not-executed`, and W6 failed against an already-deleted Topic. The Bot was
  correct in all 11 (`Rejected stale Topic metadata: chat=987654321, thread=…`);
  the harness was wrong. Cause and fix: `b5fb27c1` (a cycle may only bind a
  genuinely new id). Every failure had the stale id and no failure occurred
  without it; the repeat interval shrank from ~5 min to ~3 min as the run aged,
  i.e. the race window widened as the child slowed.
- **F6 fired (resource trend).** `opencode serve` grew 563,949,568 B →
  6,444,252,160 B (peak 6,655,377,408 B): 55 of 261 three-sample windows grew
  monotonically (bound: none), and 118 of 262 cycle deltas exceeded +150 MB
  (max +371,344 KB). The Bot daemon stayed inside the per-cycle bound
  (max delta 35,576 KB), its heap stayed flat (38–57 MB), `activeChildProcesses`
  returned 1 → 1, and the cgroup count ran 114–126 (126 at start, 118 at end,
  never above start) — so the process-count clause holds and only the RSS clause
  fires.
- **F7 fired.** Child peak 6,655,377,408 B = 55 × the 120,000,000-byte ceiling;
  Bot peak 191,864,832 B = 1.6 × it. Per ledger §6.1 item 9 that ceiling is
  also stricter than the product's own registered envelope and fails the Bot
  daemon itself — recorded as an open item for the registry owner and **not**
  re-interpreted here to let a gate pass.
- **What the run did demonstrate.** 252/252 Stops confirmed from the Bot's own
  `result=confirmed` log line with `source=stub-draft`, D1 303/311/635 ms
  (min/median/max), D2 `lateDelta` 0 in every cycle; no refusal was ever counted
  as success. W6 ran in its pre-v2 idle-delete form and W7 was not yet wired, so
  two registered workload rows are absent from this run by construction — the
  stress on `e436930b` is the first run carrying W6 v2 + W7 + the long-stream
  window together.

### Evidence accounting for run `38393992089` — cancelled after root cause

2026-10-13, dispatched 11:59:00Z on `main@e436930b`, cancelled 12:46Z,
`evidence/20261013T120033Z-stress/` (bot.log, cycles.jsonl, telegram-api.jsonl,
resource-samples.jsonl, model-api.jsonl, updates.jsonl — **no summary.json**: the
stage never ended). Cycles 1–11 ran; from cycle 1 every New Chat that mattered
was lost. The run was stopped rather than run to completion because the failures
were already explained — the remaining ~100 minutes would only have repeated
three known harness defects. **A cancelled run passes nothing**: G1 stays
`FAILED`. In each defect below the Bot behaved as designed and the workload or
tooling violated a precondition that it owns — none is a product regression.

| ID | Defect | Mechanism and evidence |
|---|---|---|
| D-A | A New Chat pressed during an active run is dropped without a trace | `reply-keyboard-router.ts` `menuAllowed` returns `false` whenever a run is active — *after* the router has already deleted the pressed button — so the update is consumed with no binding, no error and no reply. 3/3 during-stream presses died: consumed silently at 12:04:23.341 / 12:07:04.739 / 12:10:34.081, each surfacing only as W1's `new topic id timed out after 60000ms` 60 s later (12:05:23 / 12:08:04 / 12:11:34 — cycles 3, 5, 8). 6/6 at-rest presses passed (bindings 10000–10010). Trigger: cycle N+1 starts while cycle N's W6 reuse-run tail is still streaming ~13 s after W6 recorded on first growth (`promptChars=55`, `elapsedMs=15096`). A press that gets no reply cannot distinguish "eaten" from "slow" — the wait can only time out. |
| D-A2 | Cycle 1 pressed during the OpenCode server's startup recovery | `session.create` threw `TimeoutError` at +10.6 s (`bot.log` 12:00:55.184 `Error creating session: TimeoutError: The operation was aborted due to timeout`); the catch replies `new.create_error` but creates no Topic, so W1 waited for a thread that could never exist (fail at 12:01:44). The server had reported ready at 12:00:38.009, was already erroring by 12:00:41 (`OpencodeAutoRestartService.startServer` → `ready-lifecycle.notifyReady` async failure) and restarted at 12:01:06 — "ready" was not "ready for session creation". |
| D-B | `bot-restart.sh` killed the environment it was meant to refresh | The script allowed 15 s before SIGKILL; the Bot's own SIGTERM handler drains in-flight work for up to 45 000 ms (`Graceful shutdown requested … waiting up to 45000ms`, SIGTERM at 12:13:18.681). So every restart of an active Bot escalated to SIGKILL — and `kill -0` was then evaluated *immediately* after `kill -9`, succeeded against the not-yet-reaped process, and the script refused: `old bot pid=2562 is still alive after 15s; refusing to continue` (12:13:33.176, W7 fail). The old Bot's last line is 12:13:30.463; it died at its 45 s deadline with no new Bot started behind it → no Bot at all, and cycle 11's `/start` timed out against a dead environment. `flowRestart`'s own D5 = 120 s was never the constraint. |
| F4 check | Product behaviour on delete was correct | The deleted session's run aborted at delete (`ses_ecadb…Aborted`, 12:03:49); the 12:04:29 tail was the reuse Topic's legitimate PONG run. No cross-topic emission observed. |
| Fix | `cf333d12` | (a) **Rest is a precondition the workload waits for**: `restState(samples, stableMs)` decides rest purely (any signature change resets the clock; one reading can never claim it); `waitAtRest()` gates **both** New Chat presses (W1 and W6's recreate) on 5 s of unchanged output (Telegram output calls + model streams — `getUpdates`/typing/probe traffic excluded) **and** 2 s of `/global/health` answering `healthy`, bounded at 60 s; a timeout fails the flow with its observed `quiet=`/`healthyFor=` numbers instead of a mystery timeout, and each record carries `restWaitMs`. (b) **`bot-restart.sh` aligns with the Bot**: 50 s grace outlasts the 45 s deadline, SIGKILL is followed by a zombie-aware settle loop (`Z` state counts as dead; only a genuinely running pid refuses), and every path writes an `exit=graceful\|forced\|absent\|unkillable` marker into `bot.log`, which `flowRestart` parses into `restartExit` on every W7 record — which shutdown path ran is now evidence, not inference. (c) `run.sh` passes `--opencode-port` so the health probe targets the server the Bot spawned. W6's D4 window is untouched (`elapsed` freezes before the reuse press). |
| Guard | `tests/soak-harness.test.ts` — 18 cases at `cf333d12` (17 prior + the red-first `restState` case) |
| Proof | Validation cycle `38403233051` (success, 1 m 37 s) on `cf333d12`: W1 `restWaitMs=5228` → thread 10000; **W7 `restartExit=graceful`**, pid 2551→2696, `readyMs=13942` ≤ D5; W6 `restWaitMs=5030`, `topicGone=true`, reuse 10001, `lateStreams=0`. Re-run `38403749350` dispatched 13:17:20Z on `cf333d12`. |

### Evidence accounting for validation run `38397066002` — "success" with a failed W1

2026-10-13, dispatched 12:24:34Z, executed on `main@42034f5c` (the job checked
out before the fixes existed), `evidence/20261013T124702Z-soak/`, 151 s, workflow
verdict **success**. The verdict was false, and the run's own files prove it:

- `cycles.jsonl` holds `12:48:40.940 W1 new-chat fail "new topic id timed out
  after 60000ms"` (the D-A defect, un-fixed at that revision) plus
  `12:49:11.058 W5 not-executed` and `12:49:41.192 W6 not-executed`.
- `summary.json` says `counts: {pass: 5, fail: 0, not-executed: 2}` → exit 0.

**Cause:** `cycle()` pushed every flow's return into `results` except
`flowNewChat()`'s — the W1 record reached `cycles.jsonl` (written by `record()`)
and never reached the tally the exit code is built from. The tally had a second
hole: an unknown status was written to `counts[undefined]`, and the exit check
looked only at `counts.fail`.

**What else that run did not prove:** zero `phase:"idle"` samples exist — cycle
2's pre-fix 60 s W1 timeout spanned every idle window, so the phase scheduler's
idle branch never executed. The run is evidence of neither phasing nor its
absence.

- **Fix:** `a8496a1e` — `flowNewChat`'s pass path returns its record (spread with
  the threadId), `cycle()` and the smoke stage collect it, the tally moves to
  `signals.mjs` as `tallyResults(summaries)` and reports any status it cannot
  name as `unrecognized`, and the driver exits non-zero on `fail > 0 ||
  unrecognized > 0` with `unrecognized` carried in `summary.json`.
- **Guard:** two red-first harness cases (tally behaviour; source pin of the
  collection wiring, the same way `persist-evidence.sh` is pinned) — harness 20/20.
- **Re-validation (delivered):** run `38406121122` (stage=soak, 180 s,
  active 30 / idle 30, 2026-10-13) — `cycles.jsonl` 15 records / `pass=15`
  matched `summary.json` exactly with `unrecognized: 0`, and 13
  `phase:"idle"` sample rows carried the §8 columns with all 3 cycles
  confined to active windows.

**The rule this adds:** a workflow verdict is only as sound as the picture its
exit code was built from — gates read `cycles.jsonl`, never the verdict alone.

### Evidence accounting for run `38403749350` — cancelled: Stop confirmed against a Stop that was not its own

2026-10-13, dispatched 13:17:20Z on `main@cf333d12`, cancelled 13:56Z,
`evidence/20261013T131746Z-stress/` (9 cycles, 59 pass / 2 fail, no
summary.json — cancelled before stage end). All the `cf333d12` machinery
worked (W1 `restWaitMs` 5.2–25 s ×12, W6 `topicGone` ×12, W7
`restartExit=graceful` `readyMs=24054`) — but from cycle 10, W5 failed:

| ID | Defect | Mechanism and evidence |
|---|---|---|
| D-E | A Stop "confirmed" by a confirmation from an earlier cycle | W7's restart gave the new Bot process a fresh draft-id counter: pre-restart W5 ids ran 1, 4, 7 … 31, then cycle 10 issued **1**, cycle 11 **4**, cycle 12 **7**. `stopConfirmed` took the *first* `draft=<id>, result=` match in a 512 KB tail that still contained the pre-restart lines — cycle 10's Stop matched cycle 1's `13:18:08.827 draft=1 result=confirmed` and "confirmed" **2 ms** after the press, before the Bot had seen it; the still-streaming run then produced the late output charged to D2 (`lateDelta:1`, `withinD2:false` → fail). Cycle 12's identical fake confirmation passed only because its stream happened to be quiet — post-restart "passes" were unattributed too. **The product was correct**: the Bot's own lines exist and are right (`13:26:07.208 draft=1 thread=10018`, `13:26:48.960 draft=4 thread=10020`, zero refusals) — the harness judged against history |
| Fix | `cc8757a0` | `stopConfirmed(state, base, logText, draftId, sinceIso)` reads only lines the Bot wrote **after this press**: timestamped-line scan, first eligible match wins; a pre-press confirmation is history, a pre-press refusal is not this Stop's verdict, and an unparseable window never confirms (attribution fail-closed). `flowStop` passes its own `t0` captured before the enqueue |
| Guard | Red-first harness case carrying run `38403749350`'s actual lines (stale `13:18:08` vs real `13:26:07`, pre-press refusal ignored, unparseable window never confirms) — harness 21/21 |
| Proof | Validation soak `38406121122`: W5 confirmed with real timing on every cycle (no id reset — no restart in that stage). Re-run `38410095535` dispatched 14:03:23Z on `cc8757a0` |
| Cancellation basis | Root cause fully explained by the run's own bot.log; the remaining ~80 minutes would only have repeated the misattribution in cycles whose verdicts it already invalidates, and a run that ends `exit 1` cannot pass G1 either way. Same doctrine as `38393992089` |

---

## 8. Measurements (filled in only by an executed run)

Run `38370753677`, 2026-10-13, `ubuntu-24.04` (4 CPUs), 263 cycles.

| Cycle | Timestamp | Phase | RSS bytes (peak) | CPU time | Process count | Headroom | Notes |
|---|---|---|---|---|---|---|---|
| 1 | 2026-10-13T08:40:20.761Z | stress start (sample 1) | Bot 147,333,120 + child 563,949,568 = 711,282,688 | not sampled (loadavg 0.23–2.02 across run) | Bot children 1; cgroup 126 | not measured (runner RAM never recorded in evidence) | `main@d95ed0ca`; child already 4.4 × its 256 MiB reservation |
| 263 | 2026-10-13T10:40:10.012Z | stress end / run peak | Bot 191,864,832; child 6,655,377,408; combined peak 6,844,239,872 | not sampled (loadavg last 1.08) | Bot children 1 → 1 (±0 holds); cgroup 118 (range 114–126) | not measured | F7: child 55 × and Bot 1.6 × the 120,000,000 B ceiling. F6: 55 growing triples, 118/262 cycle deltas > 150 MB. Bot heap flat 43 MB; `health=healthy` (F9's warning applies — green health coexists with F6/F7) |

Per-sample series (`resource-samples.jsonl`, 263 points): Bot 143,880 → 182,304 KB,
peak 187,368 KB; child 550,732 → 6,293,140 KB, peak 6,499,392 KB; combined peak
6,683,828 KB. Sampled ~every 4.6 s. CPU **time** was never captured — only
`cpuLoad1` from the Bot's own heartbeats (241 heartbeats, min 0.02, max 2.02) —
and no system-wide memory sample exists, so those two columns stay honestly
empty rather than estimated.
