import { describe, expect, test } from "bun:test";
import { SessionExecutionControl, type ExecutionOwner } from "../upstream/session-execution-control.js";

const owner = (sessionId: string, runId = "run-1", directory = "/topic-a"): ExecutionOwner => ({ sessionId, runId, directory });

describe("live session execution control", () => {
  test("an authorized background continuation does not revive earlier model callbacks", async () => {
    const control = new SessionExecutionControl();
    const parent = control.start(owner("parent"));
    const epoch = parent.epoch;
    const child = control.start(owner("child"), parent.owner);
    const frame = control.retain(child.owner);
    control.finish(parent.owner);
    frame.continue(parent.owner);
    await expect(parent.checkpoint(undefined, epoch)).rejects.toThrow("stale execution continuation");
    await parent.checkpoint(undefined, parent.epoch);
    control.close(parent.owner);
    frame.release();
  });
  test("a retained task frame keeps its original run alive through background completion", async () => {
    const control = new SessionExecutionControl();
    const parent = control.start(owner("parent"));
    const child = control.start(owner("child"), parent.owner);
    const frame = control.retain(child.owner);
    expect(control.finish(parent.owner)).toEqual([]);
    expect(control.finish(child.owner)).toEqual([]);
    await frame.checkpoint();
    expect(() => control.start(owner("late"), parent.owner)).toThrow("execution continuation finished");
    frame.continue(parent.owner);
    await parent.checkpoint();
    expect(frame.release()).toEqual([child.owner]);
    expect(control.finish(parent.owner)).toEqual([parent.owner]);
    expect(() => frame.continue(parent.owner)).toThrow("task frame retired");
  });

  test("a retained task frame cannot continue a replacement or another Topic", () => {
    const control = new SessionExecutionControl();
    const parent = control.start(owner("parent"));
    const child = control.start(owner("child"), parent.owner);
    const other = control.start(owner("other", "other-run", "/topic-b"));
    const frame = control.retain(child.owner);
    expect(() => frame.continue(other.owner)).toThrow("task frame is not owned by this execution");
    control.close(parent.owner);
    const replacement = control.start(owner("parent", "run-2"));
    expect(() => frame.continue(replacement.owner)).toThrow();
    expect(frame.release()).toEqual([]);
    expect(replacement.signal.aborted).toBe(false);
    control.close(replacement.owner);
    control.close(other.owner);
  });
  test("observer failure cannot skip other notifications or resource cleanup", () => {
    const control = new SessionExecutionControl();
    const run = control.start(owner("parent"));
    let terminated = false;
    let notified = false;
    run.attach({ pause: () => {}, resume: () => {}, terminate: () => { terminated = true; } });
    run.subscribe(() => { throw new Error("observer failed"); });
    run.subscribe(() => { notified = true; });
    expect(() => control.close(run.owner)).toThrow("execution resource cleanup failed");
    expect(terminated).toBe(true);
    expect(notified).toBe(true);
    expect(control.get(run.owner)).toBeUndefined();
  });

  test("ancestor attachment failure wakes a paused child and its activity observer", async () => {
    const control = new SessionExecutionControl();
    const parent = control.start(owner("parent"));
    const child = control.start(owner("child"), parent.owner);
    control.pause(parent.owner);
    const waiting = child.checkpoint();
    let observed: unknown;
    child.subscribe((error) => { observed = error; });
    expect(() => parent.attach({ pause: () => { throw new Error("attach suspend failed"); }, resume: () => {}, terminate: () => {} })).toThrow("attach suspend failed");
    expect(observed).toBeInstanceOf(Error);
    await expect(waiting).rejects.toThrow("attach suspend failed");
    control.close(parent.owner);
  });

  test("a finished parent controls existing children without admitting late work", () => {
    const control = new SessionExecutionControl();
    const parent = control.start(owner("parent"));
    const child = control.start(owner("child"), parent.owner);
    control.finish(parent.owner);
    expect(() => control.start(owner("late"), parent.owner)).toThrow("execution continuation finished");
    expect(() => control.start(owner("grandchild"), child.owner)).not.toThrow();
    control.close(parent.owner);
  });
  test("pause blocks the existing continuation and resume releases it without abort", async () => {
    const control = new SessionExecutionControl();
    const run = control.start(owner("parent"));
    control.pause(run.owner);
    let continued = false;
    const continuation = run.checkpoint().then(() => { continued = true; });
    await Promise.resolve();
    expect(continued).toBe(false);
    expect(run.signal.aborted).toBe(false);
    control.resume(run.owner);
    await continuation;
    expect(continued).toBe(true);
    expect(control.get(run.owner)).toBe(run);
  });

  test("children and children admitted while paused inherit the parent gate", async () => {
    const control = new SessionExecutionControl();
    const parent = control.start(owner("parent"));
    const child = control.start(owner("child"), parent.owner);
    control.pause(parent.owner);
    const lateChild = control.start(owner("late-child"), parent.owner);
    expect(child.paused).toBe(true);
    expect(lateChild.paused).toBe(true);
    expect(child.signal.aborted).toBe(false);
    control.resume(parent.owner);
    await Promise.all([child.checkpoint(), lateChild.checkpoint()]);
    expect(child.paused).toBe(false);
  });

  test("parent resume preserves a child's independent pause", async () => {
    const control = new SessionExecutionControl();
    const parent = control.start(owner("parent"));
    const child = control.start(owner("child"), parent.owner);
    control.pause(child.owner);
    control.pause(parent.owner);
    control.resume(parent.owner);
    expect(child.paused).toBe(true);
    control.resume(child.owner);
    await child.checkpoint();
  });

  test("abort after pause wakes blocked continuations with cancellation and aborts children", async () => {
    const control = new SessionExecutionControl();
    const parent = control.start(owner("parent"));
    const child = control.start(owner("child"), parent.owner);
    control.pause(parent.owner);
    const waiting = child.checkpoint();
    control.close(parent.owner);
    await expect(waiting).rejects.toThrow("execution owner retired");
    expect(parent.signal.aborted).toBe(true);
    expect(child.signal.aborted).toBe(true);
    expect(control.get(parent.owner)).toBeUndefined();
  });

  test("retired run controls cannot affect a replacement or accept late work", async () => {
    const control = new SessionExecutionControl();
    const old = control.start(owner("parent"));
    control.pause(old.owner);
    control.close(old.owner);
    const next = control.start(owner("parent", "run-2"));
    expect(() => control.resume(old.owner)).toThrow("stale execution owner");
    expect(() => control.pause(old.owner)).toThrow("stale execution owner");
    await expect(old.checkpoint()).rejects.toThrow("execution owner retired");
    expect(next.paused).toBe(false);
  });

  test("resource pause/resume and retirement follow the owning tree only", () => {
    const control = new SessionExecutionControl();
    const parent = control.start(owner("parent"));
    const child = control.start(owner("child"), parent.owner);
    const other = control.start(owner("other", "other-run", "/topic-b"));
    const events: string[] = [];
    child.attach({ pause: () => { events.push("pause"); }, resume: () => { events.push("resume"); }, terminate: () => { events.push("terminate"); } });
    other.attach({ pause: () => { events.push("other-pause"); }, resume: () => {}, terminate: () => { events.push("other-terminate"); } });
    control.pause(parent.owner);
    control.resume(parent.owner);
    control.close(parent.owner);
    expect(events).toEqual(["pause", "resume", "terminate"]);
    expect(other.signal.aborted).toBe(false);
  });

  test("resources attached after pause are suspended before returning admission", () => {
    const control = new SessionExecutionControl();
    const run = control.start(owner("parent"));
    control.pause(run.owner);
    let paused = false;
    run.attach({ pause: () => { paused = true; }, resume: () => {}, terminate: () => {} });
    expect(paused).toBe(true);
  });

  test("resource cleanup failure still retires every descendant and cannot reopen gates", async () => {
    const control = new SessionExecutionControl();
    const parent = control.start(owner("parent"));
    const child = control.start(owner("child"), parent.owner);
    let childTerminated = false;
    parent.attach({ pause: () => {}, resume: () => {}, terminate: () => { throw new Error("kill failed"); } });
    child.attach({ pause: () => {}, resume: () => {}, terminate: () => { childTerminated = true; } });
    expect(() => control.close(parent.owner)).toThrow("execution resource cleanup failed");
    expect(childTerminated).toBe(true);
    expect(child.signal.aborted).toBe(true);
    await expect(parent.checkpoint()).rejects.toThrow("execution owner retired");
  });

  test("a checkpoint signal cancels only its waiter while the paused run stays alive", async () => {
    const control = new SessionExecutionControl();
    const run = control.start(owner("parent"));
    control.pause(run.owner);
    const transport = new AbortController();
    const waiting = run.checkpoint(transport.signal);
    transport.abort(new Error("transport cancelled"));
    await expect(waiting).rejects.toThrow("transport cancelled");
    expect(run.signal.aborted).toBe(false);
    control.resume(run.owner);
    await run.checkpoint();
  });

  test("same session in separate directories never shares control", async () => {
    const control = new SessionExecutionControl();
    const a = control.start(owner("same"));
    const b = control.start(owner("same", "run-1", "/topic-b"));
    control.pause(a.owner);
    await b.checkpoint();
    expect(b.paused).toBe(false);
  });

  test("a failed parent resource transition fences children until destructive cleanup", async () => {
    const control = new SessionExecutionControl();
    const parent = control.start(owner("parent"));
    const child = control.start(owner("child"), parent.owner);
    parent.attach({ pause: () => { throw new Error("suspend failed"); }, resume: () => {}, terminate: () => {} });
    expect(() => control.pause(parent.owner)).toThrow("execution resource transition failed");
    await expect(child.checkpoint()).rejects.toThrow("execution resource transition failed");
    expect(parent.signal.aborted).toBe(false);
    expect(() => control.resume(parent.owner)).toThrow("execution resource transition failed");
    control.close(parent.owner);
    expect(child.signal.aborted).toBe(true);
  });

  test("failed termination prevents admitting a replacement into the same workspace", () => {
    const control = new SessionExecutionControl();
    const run = control.start(owner("parent"));
    run.attach({ pause: () => {}, resume: () => {}, terminate: () => { throw new Error("kill failed"); } });
    expect(() => control.close(run.owner)).toThrow("execution resource cleanup failed");
    expect(() => control.start(owner("parent", "run-2"))).toThrow("execution resource isolation failed");
  });

  test("runtime disposal rejects paused continuations instead of replaying them", async () => {
    const control = new SessionExecutionControl();
    const run = control.start(owner("parent"));
    control.pause(run.owner);
    const waiting = run.checkpoint();
    control.dispose();
    await expect(waiting).rejects.toThrow("execution owner retired");
    expect(() => control.resume(run.owner)).toThrow("stale execution owner");
  });

  test("abort listeners cannot admit a replacement before resource cleanup finishes", () => {
    const control = new SessionExecutionControl();
    const run = control.start(owner("parent"));
    let admissionError: unknown;
    run.signal.addEventListener("abort", () => {
      try { control.start(owner("parent", "run-2")); } catch (error) { admissionError = error; }
    });
    run.attach({ pause: () => {}, resume: () => {}, terminate: () => { throw new Error("kill failed"); } });
    expect(() => control.close(run.owner)).toThrow("execution resource cleanup failed");
    expect(admissionError).toBeInstanceOf(Error);
    expect(control.get(owner("parent", "run-2"))).toBeUndefined();
  });

  test("disposal cannot admit new executions from synchronous cancellation callbacks", () => {
    const control = new SessionExecutionControl();
    const run = control.start(owner("parent"));
    let admissionError: unknown;
    run.signal.addEventListener("abort", () => {
      try { control.start(owner("other", "run-2", "/topic-b")); } catch (error) { admissionError = error; }
    });
    control.dispose();
    expect(admissionError).toBeInstanceOf(Error);
    expect(() => control.start(owner("after-disposal"))).toThrow("execution control is disposed");
  });

  test("failed descendant termination fences new root and child IDs in the owning workspace", () => {
    const control = new SessionExecutionControl();
    const parent = control.start(owner("parent"));
    const child = control.start(owner("child"), parent.owner);
    child.attach({ pause: () => {}, resume: () => {}, terminate: () => { throw new Error("kill failed"); } });
    expect(() => control.close(parent.owner)).toThrow("execution resource cleanup failed");
    expect(() => control.start(owner("parent", "run-2"))).toThrow("execution resource isolation failed");
    expect(() => control.start(owner("new-child", "run-2"))).toThrow("execution resource isolation failed");
    expect(() => control.start(owner("other", "run-2", "/topic-b"))).not.toThrow();
  });

  test("an independently paused child observes ancestor failure without needing resume", async () => {
    const control = new SessionExecutionControl();
    const parent = control.start(owner("parent"));
    const child = control.start(owner("child"), parent.owner);
    control.pause(child.owner);
    const waiting = child.checkpoint();
    parent.attach({ pause: () => { throw new Error("suspend failed"); }, resume: () => {}, terminate: () => {} });
    expect(() => control.pause(parent.owner)).toThrow("execution resource transition failed");
    await expect(waiting).rejects.toThrow("execution resource transition failed");
    control.close(parent.owner);
  });

  test("retirement also reserves alternate session IDs in the same workspace", () => {
    const control = new SessionExecutionControl();
    const run = control.start(owner("parent"));
    let admissionError: unknown;
    run.signal.addEventListener("abort", () => {
      try { control.start(owner("different-session", "run-2")); } catch (error) { admissionError = error; }
    });
    run.attach({ pause: () => {}, resume: () => {}, terminate: () => { throw new Error("kill failed"); } });
    expect(() => control.close(run.owner)).toThrow("execution resource cleanup failed");
    expect(admissionError).toBeInstanceOf(Error);
    expect(control.get(owner("different-session", "run-2"))).toBeUndefined();
  });

  test("failed child cleanup also fences and wakes existing owners in its workspace", async () => {
    const control = new SessionExecutionControl();
    const parent = control.start(owner("parent"));
    const child = control.start(owner("child"), parent.owner);
    const sibling = control.start(owner("sibling"), parent.owner);
    control.pause(parent.owner);
    const waiting = sibling.checkpoint();
    child.attach({ pause: () => {}, resume: () => {}, terminate: () => { throw new Error("kill failed"); } });
    expect(() => control.close(child.owner)).toThrow("execution resource cleanup failed");
    await expect(parent.checkpoint()).rejects.toThrow("execution resource cleanup failed");
    await expect(waiting).rejects.toThrow("execution resource cleanup failed");
    control.close(parent.owner);
  });

  test("failed parent resume never resumes descendant resources", async () => {
    const control = new SessionExecutionControl();
    const parent = control.start(owner("parent"));
    const child = control.start(owner("child"), parent.owner);
    let childResumed = false;
    parent.attach({ pause: () => {}, resume: () => { throw new Error("resume failed"); }, terminate: () => {} });
    child.attach({ pause: () => {}, resume: () => { childResumed = true; }, terminate: () => {} });
    control.pause(parent.owner);
    expect(() => control.resume(parent.owner)).toThrow("execution resource transition failed");
    expect(childResumed).toBe(false);
    await expect(child.checkpoint()).rejects.toThrow("execution resource transition failed");
    control.close(parent.owner);
  });

  test("ordinary parent completion preserves background children and their pause authority", async () => {
    const control = new SessionExecutionControl();
    const parent = control.start(owner("parent"));
    const child = control.start(owner("child"), parent.owner);
    expect(control.finish(parent.owner)).toEqual([]);
    await expect(parent.checkpoint()).rejects.toThrow("execution continuation finished");
    await child.checkpoint();
    expect(child.signal.aborted).toBe(false);
    control.pause(parent.owner);
    expect(child.paused).toBe(true);
    control.resume(parent.owner);
    await child.checkpoint();
    expect(control.finish(child.owner)).toEqual([child.owner, parent.owner]);
    expect(control.get(parent.owner)).toBeUndefined();
  });

  test("a held background child accepts an update only from its current parent phase", () => {
    const control = new SessionExecutionControl();
    const parent = control.start(owner("parent"));
    const other = control.start(owner("other"));
    const child = control.start(owner("child"), parent.owner);
    const original = control.retain(child.owner);
    control.finish(child.owner);
    expect(() => control.retain(child.owner)).toThrow();
    expect(() => control.retain(child.owner, { owner: other.owner, epoch: other.epoch })).toThrow();
    expect(() => control.retain(child.owner, { owner: parent.owner, epoch: parent.epoch + 1 })).toThrow();
    const update = control.retain(child.owner, { owner: parent.owner, epoch: parent.epoch });
    original.release();
    expect(control.get(child.owner)).toBe(child);
    update.continue(child.owner);
    expect(child.finished).toBe(false);
    control.finish(child.owner);
    update.release();
    expect(control.get(child.owner)).toBeUndefined();
    control.close(parent.owner);
    control.close(other.owner);
  });

  test("ordinary finish refuses live owned resources rather than orphaning them", () => {
    const control = new SessionExecutionControl();
    const run = control.start(owner("parent"));
    let terminated = false;
    run.attach({ pause: () => {}, resume: () => {}, terminate: () => { terminated = true; } });
    expect(() => control.finish(run.owner)).toThrow("cannot finish execution with live owned resources");
    expect(terminated).toBe(false);
    control.close(run.owner);
    expect(terminated).toBe(true);
  });

  test("failed child resume fences the whole tree and re-suspends resumed resources", async () => {
    const control = new SessionExecutionControl();
    const parent = control.start(owner("parent"));
    const child = control.start(owner("child"), parent.owner);
    let parentPauses = 0;
    parent.attach({ pause: () => { parentPauses += 1; }, resume: () => {}, terminate: () => {} });
    child.attach({ pause: () => {}, resume: () => { throw new Error("child resume failed"); }, terminate: () => {} });
    control.pause(parent.owner);
    expect(() => control.resume(parent.owner)).toThrow("execution resource transition failed");
    expect(parentPauses).toBe(2);
    expect(parent.paused).toBe(true);
    await expect(parent.checkpoint()).rejects.toThrow("execution resource transition failed");
    await expect(child.checkpoint()).rejects.toThrow("execution resource transition failed");
    control.close(parent.owner);
  });
});
