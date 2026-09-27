#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

BUN="$("$CORE_ROOT/scripts/ensure-bun.sh")"
bun_dir="$(dirname "$BUN")"
export PATH="$bun_dir:$PATH"
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

"$BUN" run --cwd "$tree/packages/opencode" script/build.ts --single --skip-embed-web-ui

mapfile -t binaries < <(find "$tree/packages/opencode/dist" -type f -path '*/opencode-linux-x64/bin/opencode' -print)
[[ "${#binaries[@]}" -eq 1 ]] || die "expected exactly one linux-x64 runtime, found ${#binaries[@]}"

mkdir -p "$CORE_ROOT/dist/compat"
cp "${binaries[0]}" "$CORE_ROOT/dist/compat/opencode"
chmod +x "$CORE_ROOT/dist/compat/opencode"
"$CORE_ROOT/dist/compat/opencode" --version
