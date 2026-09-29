#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

sdk="$CORE_ROOT/dist/sdk"
out="$CORE_ROOT/dist/sdk-node"
[[ -d "$sdk" ]] || die "SDK artifact missing; run build-sdk.sh first"
[[ -f "$sdk/UPSTREAM_REVISION" ]] || die "SDK revision marker missing"

rm -rf "$out"
mkdir -p "$out/dist"
cp -a "$sdk/." "$out/dist/"
mv "$out/dist/UPSTREAM_REVISION" "$out/UPSTREAM_REVISION"

version="$(json_get version)"
commit="$(json_get commit)"
core_commit="$(git -C "$CORE_ROOT" rev-parse HEAD)"
cat > "$out/package.json" <<JSON
{
  "name": "@opencode-ai/sdk",
  "version": "$version",
  "type": "module",
  "exports": {
    ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" },
    "./client": { "import": "./dist/client.js", "types": "./dist/client.d.ts" },
    "./server": { "import": "./dist/server.js", "types": "./dist/server.d.ts" },
    "./v2": { "import": "./dist/v2/index.js", "types": "./dist/v2/index.d.ts" },
    "./v2/client": { "import": "./dist/v2/client.js", "types": "./dist/v2/client.d.ts" },
    "./v2/gen/client": { "import": "./dist/v2/gen/client/index.js", "types": "./dist/v2/gen/client/index.d.ts" },
    "./v2/server": { "import": "./dist/v2/server.js", "types": "./dist/v2/server.d.ts" },
    "./v2/types": { "import": "./dist/v2/gen/types.gen.js", "types": "./dist/v2/gen/types.gen.d.ts" }
  },
  "dependencies": {
    "cross-spawn": "7.0.6"
  }
}
JSON
cat > "$out/sdk-info.json" <<JSON
{
  "telegramCoreCommit": "$core_commit",
  "upstreamVersion": "$version",
  "upstreamCommit": "$commit",
  "consumerRuntime": "node"
}
JSON

(
  cd "$out"
  npm install --omit=dev --ignore-scripts --package-lock=false --silent
  node --input-type=module -e "const m=await import('./dist/v2/index.js'); if(typeof m.createOpencodeClient !== 'function') process.exit(2)"
)
rm -rf "$out/node_modules"
printf 'Node SDK package built: %s\n' "$out"
