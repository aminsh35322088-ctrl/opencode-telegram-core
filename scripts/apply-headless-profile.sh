#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
tree="${1:?usage: apply-headless-profile.sh WORKTREE}"
[[ "$(git -C "$tree" rev-parse HEAD)" == "$(json_get commit)" ]] || die "headless profile upstream mismatch"
patch="$CORE_ROOT/patches/telegram-headless/0001-minimum-production-composition.patch"
git -C "$tree" apply --check "$patch"
git -C "$tree" apply --whitespace=error "$patch"
