#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

tree="${1:?usage: apply-patches.sh WORKTREE}"
series="$CORE_ROOT/patches/series"

# An unreadable or effectively empty series must abort: process substitution
# hides sed's failure and would otherwise leave an empty loop that exits 0
# while silently shipping an unpatched upstream.
[[ -r "$series" ]] || die "missing or unreadable patch series: $series"
mapfile -t patches < <(sed -e 's/#.*$//' -e '/^[[:space:]]*$/d' "$series")
(( ${#patches[@]} > 0 )) || die "patch series lists no patches: $series"

for patch in "${patches[@]}"; do
  git -C "$tree" apply --check "$CORE_ROOT/patches/$patch"
done
for patch in "${patches[@]}"; do
  git -C "$tree" apply --whitespace=error "$CORE_ROOT/patches/$patch"
done
