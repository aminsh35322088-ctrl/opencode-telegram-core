#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

BUN="$("$CORE_ROOT/scripts/ensure-bun.sh")"
export PATH="$(dirname "$BUN"):$PATH"
export_upstream_build_environment
tree="$CORE_ROOT/.work/opencode"

"$CORE_ROOT/scripts/materialize-upstream.sh" "$tree"
"$CORE_ROOT/scripts/apply-patches.sh" "$tree"
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

python3 - "$CORE_ROOT/dist/build-info.json" <<'PY'
import json, sys
info = json.load(open(sys.argv[1], encoding="utf-8"))
if info.get("runtimeProfile") != "telegram-headless":
    raise SystemExit("runtime profile mismatch")
if info.get("embeddedWebUi") is not False:
    raise SystemExit("embedded Web UI must be disabled")
PY
