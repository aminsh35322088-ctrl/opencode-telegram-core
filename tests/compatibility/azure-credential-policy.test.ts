import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { telegramAzureCredentialPolicy } from "../../scripts/telegram-aws-credential-policy";
const packageDir = process.env.OPENCODE_PACKAGE_DIR;
if (!packageDir) throw new Error("OPENCODE_PACKAGE_DIR is required");
async function probe(type: "api" | "oauth") {
  const root = await mkdtemp(path.join(tmpdir(), "core-azure-policy-"));
  try {
    const entry = path.join(root, "entry.ts");
    await Bun.write(
      entry,
      `import {AzureAuthPlugin} from ${JSON.stringify(path.join(packageDir!, "src/plugin/azure.ts"))};
      const hooks=await AzureAuthPlugin(); const options=await hooks.auth.loader(async()=>({type:${JSON.stringify(type)},key:'fixture',access:'fixture',refresh:'fixture',expires:4102444800000}));
      if(!options.fetch) console.log(JSON.stringify({unmodified:true}));
      else try {await options.fetch('http://127.0.0.1:1');console.log(JSON.stringify({unexpected:true}))}
      catch(error){console.log(JSON.stringify({message:error.message,retryable:error.isRetryable}))}`,
    );
    const build = await Bun.build({
      entrypoints: [entry],
      target: "bun",
      tsconfig: path.join(packageDir!, "tsconfig.json"),
      plugins: [telegramAzureCredentialPolicy],
    });
    expect(build.success).toBe(true);
    const bundle = path.join(root, "bundle.js");
    await Bun.write(bundle, build.outputs[0]);
    const child = Bun.spawn([process.execPath, bundle], {
      stdout: "pipe",
      stderr: "pipe",
      env: { PATH: process.env.PATH },
    });
    const output = await new Response(child.stdout).text();
    expect(await child.exited).toBe(0);
    return JSON.parse(output);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test("unsupported Azure CLI OAuth is terminal before token acquisition", async () => {
  const result = await probe("oauth");
  expect(result.message).toContain(
    "Azure CLI OAuth is unsupported in Telegram Core",
  );
  expect(result.retryable).toBe(false);
});
test("Azure API-key credentials retain the provider's original transport", async () => {
  expect((await probe("api")).unmodified).toBe(true);
});
