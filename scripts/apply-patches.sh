#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

tree="${1:?usage: apply-patches.sh WORKTREE}"
series="$CORE_ROOT/patches/series"

# Read and filter the series through command substitution so sed's exit status
# is observable by the parent shell. Process substitution would mask a partial
# read failure and could otherwise ship only a prefix of the intended patches.
[[ -r "$series" ]] || die "missing or unreadable patch series: $series"
filtered="$(sed -e 's/#.*$//' -e '/^[[:space:]]*$/d' "$series")" ||
  die "failed to read patch series: $series"
[[ -n "$filtered" ]] || die "patch series lists no patches: $series"
mapfile -t patches <<< "$filtered"

for patch in "${patches[@]}"; do
  git -C "$tree" apply --check "$CORE_ROOT/patches/$patch"
done
for patch in "${patches[@]}"; do
  git -C "$tree" apply --whitespace=error "$CORE_ROOT/patches/$patch"
done
