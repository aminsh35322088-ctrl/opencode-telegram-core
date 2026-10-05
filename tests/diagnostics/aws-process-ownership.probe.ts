import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
const repository = path.resolve(import.meta.dir, "../..")
const { fromNodeProviderChain } = await import(path.join(repository, ".work/opencode-test/packages/opencode/node_modules/@aws-sdk/credential-providers"))
const { telegramProcessBudgetSnapshot } = await import(path.join(repository, ".work/opencode-test/packages/core/src/telegram-process-budget"))
const root = await mkdtemp(path.join(tmpdir(), "core-aws-helper-"))
const marker = path.join(root, "started.json"); const gate = path.join(root, "release")
const script = path.join(root, "helper.ts"); const config = path.join(root, "config"); const credentials = path.join(root, "credentials")
await writeFile(script, `await Bun.write(${JSON.stringify(marker)}, JSON.stringify({pid:process.pid,ppid:process.ppid})); for(let i=0;i<500;i++){if(await Bun.file(${JSON.stringify(gate)}).exists())break;await Bun.sleep(10)} console.log(JSON.stringify({Version:1,AccessKeyId:'fixture',SecretAccessKey:'fixture'}));`)
await writeFile(config, `[profile core-fixture]\ncredential_process = ${process.execPath} ${script}\n`)
await writeFile(credentials, "")
process.env.OPENCODE_TELEGRAM_PROCESS_BUDGET = "1"
process.env.AWS_EC2_METADATA_DISABLED = "true"
const resolving = fromNodeProviderChain({ profile: "core-fixture", configFilepath: config, filepath: credentials, ignoreCache: true })()
try {
  let owner
  for (let i=0;i<500;i++) { try { owner=JSON.parse(await readFile(marker,"utf8"));break } catch {} await Bun.sleep(10) }
  if(!owner)throw new Error("helper did not start")
  console.log(JSON.stringify({helperStarted:true,helper:owner,governorActiveCount:telegramProcessBudgetSnapshot().activeCount}))
} finally { await writeFile(gate, "release"); await resolving; await rm(root,{recursive:true,force:true}) }
