#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

BUN="$("$CORE_ROOT/scripts/ensure-bun.sh")"
export PATH="$(dirname "$BUN"):$PATH"
export_upstream_build_environment
tree="$CORE_ROOT/.work/opencode-compat"
expected="$(json_get commit)"

"$CORE_ROOT/scripts/materialize-upstream.sh" "$tree"
"$CORE_ROOT/scripts/apply-patches.sh" "$tree"
bash "$CORE_ROOT/scripts/install-runtime-overlays.sh" "$tree"
install_upstream_dependencies "$tree" "$BUN"
actual="$(git -C "$tree" rev-parse HEAD)"
[[ "$actual" == "$expected" ]] || die "compat CLI source mismatch: expected $expected, got $actual"

telegram_core_version="$(json_get telegramCoreVersion)"
if [[ -n "${CORE_SOURCE_COMMIT:-}" ]]; then
  core_commit="$CORE_SOURCE_COMMIT"
else
  core_commit="$(git -C "$CORE_ROOT" rev-parse HEAD)"
fi
export OPENCODE_TELEGRAM_CORE_VERSION="$telegram_core_version"
export OPENCODE_TELEGRAM_CORE_COMMIT="$core_commit"
export OPENCODE_TELEGRAM_CORE_UPSTREAM_COMMIT="$expected"
export OPENCODE_TELEGRAM_CORE_SDK_REVISION="$expected"

"$BUN" run --cwd "$tree/packages/opencode" script/build.ts --single --skip-install --skip-embed-web-ui

mapfile -t binaries < <(find "$tree/packages/opencode/dist" -type f -path '*/opencode-linux-x64/bin/opencode' -print)
[[ "${#binaries[@]}" -eq 1 ]] || die "expected exactly one linux-x64 compat CLI, found ${#binaries[@]}"

mkdir -p "$CORE_ROOT/dist/compat"
cp "${binaries[0]}" "$CORE_ROOT/dist/compat/opencode"
chmod +x "$CORE_ROOT/dist/compat/opencode"
"$CORE_ROOT/dist/compat/opencode" --version
"$CORE_ROOT/dist/compat/opencode" debug build-info >/dev/null
printf 'compat CLI built: %s\n' "$CORE_ROOT/dist/compat/opencode"
