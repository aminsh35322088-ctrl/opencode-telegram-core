#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

BUN="$("$CORE_ROOT/scripts/ensure-bun.sh")"
export PATH="$(dirname "$BUN"):$PATH"
runtime_root="$CORE_ROOT/runtime"
out="$CORE_ROOT/dist/native-runtime-node"
rm -rf "$out"

(
  cd "$runtime_root"
  "$BUN" install --frozen-lockfile
  "$BUN" run typecheck
  "$BUN" test
  "$BUN" x tsc -p tsconfig.node.json
)

for retired in compat opencode/session-client opencode/session-event-pump ipc/json-line-worker-channel opencode/run-reconciler telegram/conformance; do
  [[ ! -f "$out/$retired.js" ]] || die "retired native implementation shipped: $retired"
done

source_commit="$(git -C "$CORE_ROOT" rev-parse HEAD)"
python3 - "$runtime_root/package.json" "$CORE_UPSTREAM_LOCK" "$source_commit" "$out/package.json" "$out/runtime-info.json" <<'PY'
import json
import sys
package_path, lock_path, source_commit, package_out, info_out = sys.argv[1:]
package = json.load(open(package_path, encoding="utf-8"))
lock = json.load(open(lock_path, encoding="utf-8"))
pkg = {
    "name": "@opencode-telegram/native-runtime",
    "version": package["version"],
    "type": "module",
    "main": "./index.js",
    "types": "./index.d.ts",
    "exports": {".": {"import": "./index.js", "types": "./index.d.ts"}},
    "dependencies": package["dependencies"],
}
with open(package_out, "w", encoding="utf-8") as fh:
    json.dump(pkg, fh, indent=2, sort_keys=True)
    fh.write("\n")
info = {
    "nativeRuntimeVersion": package["version"],
    "telegramCoreCommit": source_commit,
    "grammyVersion": package["dependencies"]["grammy"],
    "bunVersion": lock["bun"],
    "upstreamVersion": lock["version"],
    "upstreamCommit": lock["commit"],
    "consumerRuntime": "node",
}
with open(info_out, "w", encoding="utf-8") as fh:
    json.dump(info, fh, indent=2, sort_keys=True)
    fh.write("\n")
PY

(cd "$out" && npm install --omit=dev --ignore-scripts --package-lock=false --silent && node --input-type=module -e "const m=await import('./index.js'); if(typeof m.TelegramNativeCore!=='function') process.exit(2)") >/dev/null
rm -rf "$out/node_modules"
printf 'Node native runtime built: %s\n' "$out"
