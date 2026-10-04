import { expect, test } from "bun:test"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { telegramAwsCredentialPolicy } from "../../scripts/telegram-aws-credential-policy"

const packageDir = process.env.OPENCODE_PACKAGE_DIR
if (!packageDir) throw new Error("OPENCODE_PACKAGE_DIR is required for SDK policy verification")
// Resolve from the runtime importer, not an installation-layout assumption.
// The frozen workspace install may place this dependency at the tree root.
const sdk = Bun.resolveSync("@aws-sdk/credential-providers", packageDir)

async function probe(config: string, credentials: string, body: string, env: Record<string, string> = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "core-aws-policy-"))
  try {
    const configFilepath = path.join(root, "config"), filepath = path.join(root, "credentials")
    await writeFile(configFilepath, config.replaceAll("HELPER_MARKER", path.join(root, "started")))
    await writeFile(filepath, credentials)
    const entry = path.join(root, "entry.ts")
    await writeFile(entry, `import {fromNodeProviderChain,fromProcess} from ${JSON.stringify(sdk)};
      const init = {profile:'fixture',configFilepath:${JSON.stringify(configFilepath)},filepath:${JSON.stringify(filepath)},ignoreCache:true};
      ${body}`)
    const built = await Bun.build({entrypoints:[entry],target:"bun",plugins:[telegramAwsCredentialPolicy]})
    expect(built.success).toBe(true)
    const bundle = path.join(root,"bundle.js"); await Bun.write(bundle,built.outputs[0])
    const child = Bun.spawn([process.execPath,bundle], {stdout:"pipe",stderr:"pipe",
      env:{PATH:process.env.PATH,AWS_EC2_METADATA_DISABLED:"true",...env}})
    const output = await new Response(child.stdout).text()
    expect(await child.exited).toBe(0)
    return {result:JSON.parse(output), started:await Bun.file(path.join(root,"started")).exists()}
  } finally {await rm(root,{recursive:true,force:true})}
}
const failure = `try {await fromNodeProviderChain(init)();throw Error('unexpected credentials')} catch(error) {console.log(JSON.stringify({message:error.message,tryNextLink:error.tryNextLink}))}`

test("production rejects credential_process without executing it or falling back", async () => {
  const {result,started}=await probe('[profile fixture]\ncredential_process = touch HELPER_MARKER\n', '', failure)
  expect(result.message).toContain("credential_process is unsupported in Telegram Core")
  expect(result.tryNextLink).toBe(false)
  expect(started).toBe(false)
})
test("production retains static AWS profile credentials", async () => {
  const {result}=await probe('[profile fixture]\nregion = us-east-1\n',
    '[fixture]\naws_access_key_id = fixture-key\naws_secret_access_key = fixture-secret\n',
    `const credentials=await fromNodeProviderChain(init)();console.log(JSON.stringify({valid:credentials.accessKeyId==='fixture-key'&&credentials.secretAccessKey==='fixture-secret'}))`)
  expect(result.valid).toBe(true)
})
test("missing process credentials allow remaining credential-chain links", async () => {
  const {result}=await probe('', '', failure.replace('fromNodeProviderChain(init)', 'fromProcess(init)'))
  expect(result.message).not.toContain("credential_process is unsupported")
  expect(result.tryNextLink).toBe(true)
})

test("production retains HTTP container credentials after non-process chain links", async () => {
  let requests = 0
  const peer = Bun.serve({port:0,hostname:"127.0.0.1",fetch() {
    requests++
    return Response.json({AccessKeyId:"http-fixture",SecretAccessKey:"fixture-secret",Token:"fixture-token",Expiration:"2099-01-01T00:00:00Z"})
  }})
  try {
    const {result}=await probe('', '',
      `const credentials=await fromNodeProviderChain(init)();console.log(JSON.stringify({valid:credentials.accessKeyId==='http-fixture'}))`,
      {AWS_CONTAINER_CREDENTIALS_FULL_URI:`http://127.0.0.1:${peer.port}/credentials`})
    expect(result.valid).toBe(true)
    expect(requests).toBeGreaterThan(0)
  } finally {peer.stop(true)}
})
test("process source_profile cannot fall back to HTTP credentials", async () => {
  let requests = 0
  const peer = Bun.serve({port:0,hostname:"127.0.0.1",fetch() {requests++;return Response.json({})}})
  try {
    const {result,started}=await probe('[profile fixture]\nrole_arn = arn:aws:iam::123456789012:role/fixture\nsource_profile = source\n[profile source]\ncredential_process = touch HELPER_MARKER\n', '', failure,
      {AWS_CONTAINER_CREDENTIALS_FULL_URI:`http://127.0.0.1:${peer.port}/credentials`})
    expect(result.message).toContain("credential_process is unsupported in Telegram Core")
    expect(result.tryNextLink).toBe(false)
    expect(started).toBe(false)
    expect(requests).toBe(0)
  } finally {peer.stop(true)}
})
