import { expect, test } from "bun:test"
import path from "node:path"

for (const flag of [undefined, "0"]) {
  test(`standalone headless enforces process admission with inherited flag ${flag ?? "unset"}`, async () => {
    const env = { ...process.env }
    if (flag === undefined) delete env.OPENCODE_TELEGRAM_PROCESS_BUDGET
    else env.OPENCODE_TELEGRAM_PROCESS_BUDGET = flag
    const child = Bun.spawn([process.execPath, path.join(import.meta.dir, "telegram-headless-governor.fixture.ts")], {
      env, stdout: "pipe", stderr: "pipe",
    })
    const [code, stdout, stderr] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ])
    expect({ code, stdout, stderr }).toEqual({ code: 0, stdout: "", stderr: "" })
  })
}
