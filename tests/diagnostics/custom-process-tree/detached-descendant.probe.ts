// Diagnostic, not installed into the cumulative suite while its invariant is red.
// Run beneath the test-only Linux subreaper, with OPENCODE_PACKAGE_DIR set.
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

const packageDir = process.env.OPENCODE_PACKAGE_DIR
if (!packageDir) throw new Error("OPENCODE_PACKAGE_DIR required")
const { SessionExecutionControl } = await import(Bun.resolveSync("@opencode-ai/core/session-execution-control", packageDir))
const { createToolProcessScope } = await import(Bun.resolveSync("@opencode-ai/core/telegram-tool-process", packageDir))
const { telegramProcessBudgetSnapshot } = await import(Bun.resolveSync("@opencode-ai/core/telegram-process-budget", packageDir))
process.env.OPENCODE_TELEGRAM_PROCESS_BUDGET = "1"
const directory = await mkdtemp(path.join(tmpdir(), "core-detached-probe-"))
const control = new SessionExecutionControl()
const execution = control.start({ sessionId: "probe", runId: "probe", directory })
const scope = createToolProcessScope(execution, execution.epoch, "probe", directory, new AbortController().signal)
const before = telegramProcessBudgetSnapshot().activeCount
let captured: { pid: number, start: string } | undefined
async function identity(pid: number) {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8")
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ")
    return { state: fields[0], ppid: Number(fields[1]), group: Number(fields[2]), start: fields[19] }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}
try {
  const result = await scope.port.execFile(process.execPath, ["-e", `
    const {spawn}=require('node:child_process');
    const fs=require('node:fs');
    const child=spawn('/bin/sleep',['60'],{detached:true,stdio:'ignore'});
    child.once('spawn',()=>{
      const stat=fs.readFileSync('/proc/'+child.pid+'/stat','utf8');
      const fields=stat.slice(stat.lastIndexOf(')')+2).split(' ');
      console.log(JSON.stringify({pid:child.pid,start:fields[19]}));child.unref();
    });
  `])
  captured = JSON.parse(result.stdout)
  await scope.close()
  const survivor = await identity(captured!.pid)
  console.log(JSON.stringify({ before, after: telegramProcessBudgetSnapshot().activeCount, captured, survivor }))
  if (survivor?.start === captured!.start && survivor.state !== "Z") {
    throw new Error("Core released invocation/admission with an escaped descendant alive")
  }
} finally {
  // Only fixture-owned identity, never an arbitrary/reused PID.
  if (captured && (await identity(captured.pid))?.start === captured.start) {
    try { process.kill(captured.pid, "SIGKILL") } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
    }
  }
  await scope.close()
  control.close(execution.owner)
  await rm(directory, { recursive: true, force: true })
}
