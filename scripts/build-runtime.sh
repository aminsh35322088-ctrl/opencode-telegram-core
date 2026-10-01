#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

BUN="$("$CORE_ROOT/scripts/ensure-bun.sh")"
export PATH="$(dirname "$BUN"):$PATH"
export_upstream_build_environment
tree="$CORE_ROOT/.work/opencode"

"$CORE_ROOT/scripts/materialize-upstream.sh" "$tree"
"$CORE_ROOT/scripts/apply-patches.sh" "$tree"
bash "$CORE_ROOT/scripts/install-runtime-overlays.sh" "$tree"
"$BUN" install --cwd "$tree" --frozen-lockfile

telegram_core_version="$(json_get telegramCoreVersion)"
upstream_commit="$(json_get commit)"
if [[ -n "${CORE_SOURCE_COMMIT:-}" ]]; then
  core_commit="$CORE_SOURCE_COMMIT"
else
  core_commit="$(git -C "$CORE_ROOT" rev-parse HEAD)"
fi

export OPENCODE_TELEGRAM_CORE_VERSION="$telegram_core_version"
export OPENCODE_TELEGRAM_CORE_COMMIT="$core_commit"
export OPENCODE_TELEGRAM_CORE_UPSTREAM_COMMIT="$upstream_commit"
export OPENCODE_TELEGRAM_CORE_SDK_REVISION="$upstream_commit"

cp "$CORE_ROOT/runtime/upstream/telegram-headless.ts" "$tree/packages/opencode/src/telegram-headless.ts"
mkdir -p "$CORE_ROOT/dist/runtime"
export OPENCODE_PACKAGE_DIR="$tree/packages/opencode"
export OPENCODE_HEADLESS_OUTPUT="$CORE_ROOT/dist/runtime/opencode"
"$BUN" "$CORE_ROOT/scripts/build-headless-runtime.ts"
chmod +x "$CORE_ROOT/dist/runtime/opencode"

"$CORE_ROOT/dist/runtime/opencode" --version
"$CORE_ROOT/dist/runtime/opencode" debug build-info > "$CORE_ROOT/dist/build-info.json"

python3 - "$CORE_ROOT/dist/build-info.json" "$CORE_UPSTREAM_LOCK" "$CORE_ROOT/dist/runtime/opencode" <<'PY'
import json
import os
import sys

build_path, lock_path, runtime_path = sys.argv[1:]
info = json.load(open(build_path, encoding="utf-8"))
lock = json.load(open(lock_path, encoding="utf-8"))
if info.get("runtimeProfile") != lock["runtimeProfile"]:
    raise SystemExit("runtime profile mismatch")
if info.get("embeddedWebUi") is not False:
    raise SystemExit("embedded Web UI must be disabled")
runtime_bytes = os.path.getsize(runtime_path)
runtime_max = lock["runtimeMaxBytes"]
if runtime_bytes > runtime_max:
    raise SystemExit(f"runtime size budget exceeded: {runtime_bytes} > {runtime_max}")
info["runtimeBytes"] = runtime_bytes
info["runtimeMaxBytes"] = runtime_max
with open(build_path, "w", encoding="utf-8") as fh:
    json.dump(info, fh, indent=2, sort_keys=True)
    fh.write("\n")
PY
