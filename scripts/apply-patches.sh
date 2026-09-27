#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

tree="${1:?usage: apply-patches.sh WORKTREE}"
mapfile -t patches < <(sed -e 's/#.*$//' -e '/^[[:space:]]*$/d' "$CORE_ROOT/patches/series")

for patch in "${patches[@]}"; do
  git -C "$tree" apply --check "$CORE_ROOT/patches/$patch"
done
for patch in "${patches[@]}"; do
  git -C "$tree" apply --whitespace=error "$CORE_ROOT/patches/$patch"
done
