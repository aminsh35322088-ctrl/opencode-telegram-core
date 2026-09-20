#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

expected="$(json_get bun)"
candidate=""

if command -v bun >/dev/null 2>&1; then
  candidate="$(command -v bun)"
  actual="$("$candidate" --version)"
  if [[ "$actual" == "$expected" ]]; then
    printf '%s\n' "$candidate"
    exit 0
  fi
fi

if [[ "${CORE_BUN_NO_INSTALL:-0}" == "1" ]]; then
  actual="${actual:-missing}"
  die "expected Bun $expected, got $actual"
fi

curl -fsSL https://bun.com/install | bash -s "bun-v$expected" >/dev/null
candidate="$HOME/.bun/bin/bun"
[[ -x "$candidate" ]] || die "Bun installer did not create $candidate"
actual="$("$candidate" --version)"
[[ "$actual" == "$expected" ]] || die "expected Bun $expected, got $actual"
printf '%s\n' "$candidate"
