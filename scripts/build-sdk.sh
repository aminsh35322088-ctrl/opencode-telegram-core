#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

BUN="$("$CORE_ROOT/scripts/ensure-bun.sh")"
bun_dir="$(dirname "$BUN")"
tree="$CORE_ROOT/.work/opencode"
export PATH="$bun_dir:$tree/node_modules/.bin:$PATH"
export_upstream_build_environment
expected="$(json_get commit)"

[[ -d "$tree/.git" ]] || die "upstream worktree missing; run build-runtime.sh first"
actual="$(git -C "$tree" rev-parse HEAD)"
[[ "$actual" == "$expected" ]] || die "SDK source mismatch: expected $expected, got $actual"

rm -f "$tree/packages/sdk/js/tsconfig.tsbuildinfo"
"$BUN" run --cwd "$tree/packages/sdk/js" script/build.ts
src="$tree/packages/sdk/js/dist"
[[ -d "$src" ]] || die "SDK build did not produce $src"

rm -rf "$CORE_ROOT/dist/sdk"
mkdir -p "$CORE_ROOT/dist/sdk"
cp -a "$src/." "$CORE_ROOT/dist/sdk/"
printf '%s\n' "$expected" > "$CORE_ROOT/dist/sdk/UPSTREAM_REVISION"
"$BUN" "$CORE_ROOT/scripts/verify-bot-sdk-surface.ts"
