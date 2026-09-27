import path from "node:path"

const packageDir = process.env.OPENCODE_PACKAGE_DIR
const output = process.env.OPENCODE_HEADLESS_OUTPUT
if (!packageDir) throw new Error("OPENCODE_PACKAGE_DIR is required")
if (!output) throw new Error("OPENCODE_HEADLESS_OUTPUT is required")

process.chdir(packageDir)
const generated = await import(path.join(packageDir, "script/generate.ts"))

const required = (name: string): string => {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

const result = await Bun.build({
  conditions: ["bun", "node"],
  tsconfig: "./tsconfig.json",
  external: ["node-gyp"],
  format: "esm",
  minify: true,
  splitting: true,
  sourcemap: "none",
  compile: {
    autoloadBunfig: false,
    autoloadDotenv: false,
    autoloadTsconfig: true,
    autoloadPackageJson: true,
    target: "bun-linux-x64",
    outfile: output,
    execArgv: [
      `--user-agent=opencode-telegram/${required("OPENCODE_VERSION")}`,
      "--use-system-ca",
      "--",
    ],
  },
  entrypoints: ["./src/telegram-headless.ts"],
  define: {
    FFF_LIBC: JSON.stringify("gnu"),
    OPENCODE_VERSION: JSON.stringify(required("OPENCODE_VERSION")),
    OPENCODE_MODELS_DEV: generated.modelsData,
    OPENCODE_CHANNEL: JSON.stringify("telegram"),
    OPENCODE_LIBC: JSON.stringify("glibc"),
    "process.env.OPENTUI_LIBC": JSON.stringify("glibc"),
    OPENCODE_TELEGRAM_CORE_VERSION: JSON.stringify(required("OPENCODE_TELEGRAM_CORE_VERSION")),
    OPENCODE_TELEGRAM_CORE_COMMIT: JSON.stringify(required("OPENCODE_TELEGRAM_CORE_COMMIT")),
    OPENCODE_TELEGRAM_CORE_UPSTREAM_COMMIT: JSON.stringify(required("OPENCODE_TELEGRAM_CORE_UPSTREAM_COMMIT")),
    OPENCODE_TELEGRAM_CORE_SDK_REVISION: JSON.stringify(required("OPENCODE_TELEGRAM_CORE_SDK_REVISION")),
  },
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}
