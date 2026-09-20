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

export OPENCODE_TELEGRAM_CORE_VERSION="$(json_get telegramCoreVersion)"
export OPENCODE_TELEGRAM_CORE_COMMIT="${CORE_SOURCE_COMMIT:-$(git -C "$CORE_ROOT" rev-parse HEAD)}"
export OPENCODE_TELEGRAM_CORE_UPSTREAM_COMMIT="$(json_get commit)"
export OPENCODE_TELEGRAM_CORE_SDK_REVISION="$(json_get commit)"

"$BUN" run --cwd "$tree/packages/opencode" script/build.ts --single

mapfile -t binaries < <(find "$tree/packages/opencode/dist" -type f -path '*/opencode-linux-x64/bin/opencode' -print)
[[ "${#binaries[@]}" -eq 1 ]] || die "expected exactly one linux-x64 runtime, found ${#binaries[@]}"

mkdir -p "$CORE_ROOT/dist/runtime"
cp "${binaries[0]}" "$CORE_ROOT/dist/runtime/opencode"
chmod +x "$CORE_ROOT/dist/runtime/opencode"
"$CORE_ROOT/dist/runtime/opencode" --version
"$CORE_ROOT/dist/runtime/opencode" debug build-info > "$CORE_ROOT/dist/build-info.json"
