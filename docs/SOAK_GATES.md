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
| Address | `100.93.106.19` (Tailscale peer `github-lab`, `tagged-devices`) |
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
| G1 ≥2 h representative stress | Timestamped cycle log + §3 results + §8 measurements | `PENDING` |
| G2 Telegram Stop contract (S1–S10) | Per-row captured evidence | `PENDING` (unit/contract tests for S1/S5 are committed and green) |
| G3 Two-Worker isolation (W3) | Interleaved message/file/state traces from both Topics | `PENDING` |
| G4 Delete Chat cleanup + Worker reuse (W6) | Resource inventory before/after | `PENDING` |
| G5 Recovery: retry, disconnect, restart (W7) | Generation/fence logs proving no duplicate and no stale output | `PENDING` |
| G6 ≥24 h RC soak with active/idle phases | Full 24 h log | `PENDING` |
| G7 Controlled restart proof | Restart timeline vs D5 | `PENDING` |
| G8 Rollback proof | Revision timeline vs D6 | `PENDING` |
| G9 Resource evidence (§5) | Per-cycle RSS/CPU/process/headroom table (§8) | `PENDING` |
| G10 Deployment gate fix | Operator decision on §6 | `PENDING — operator decision` |

**No stable release may be published while any row above is `PENDING`.**

---

## 8. Measurements (filled in only by an executed run)

| Cycle | Timestamp | Phase | RSS bytes (peak) | CPU time | Process count | Headroom | Notes |
|---|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — | no run yet |
