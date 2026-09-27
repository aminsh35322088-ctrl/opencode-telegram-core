#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

BUN="$("$CORE_ROOT/scripts/ensure-bun.sh")"
export PATH="$(dirname "$BUN"):$PATH"

runtime_root="$CORE_ROOT/runtime"
out="$CORE_ROOT/dist/native-runtime"
rm -rf "$out"
mkdir -p "$out"

(
  cd "$runtime_root"
  "$BUN" install --frozen-lockfile
  "$BUN" run typecheck
  "$BUN" test
  "$BUN" build src/index.ts     --target=bun     --format=esm     --minify     --outfile "$out/index.js"
)

source_commit="$(git -C "$CORE_ROOT" rev-parse HEAD)"
python3 - "$runtime_root/package.json" "$CORE_UPSTREAM_LOCK" "$source_commit" "$out/runtime-info.json" <<'PY'
import json
import sys

package_path, lock_path, source_commit, output_path = sys.argv[1:]
package = json.load(open(package_path, encoding="utf-8"))
lock = json.load(open(lock_path, encoding="utf-8"))
info = {
    "nativeRuntimeVersion": package["version"],
    "telegramCoreCommit": source_commit,
    "grammyVersion": package["dependencies"]["grammy"],
    "bunVersion": lock["bun"],
    "upstreamVersion": lock["version"],
    "upstreamCommit": lock["commit"],
}
with open(output_path, "w", encoding="utf-8") as fh:
    json.dump(info, fh, indent=2, sort_keys=True)
    fh.write("\n")
PY

"$BUN" -e "await import('file://$out/index.js'); console.log('native-runtime-import-ok')" >/dev/null
printf 'native runtime built: %s\n' "$out"
