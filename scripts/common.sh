#!/usr/bin/env bash
set -Eeuo pipefail

CORE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CORE_UPSTREAM_LOCK="${CORE_UPSTREAM_LOCK:-$CORE_ROOT/upstream/lock.json}"

json_get() {
  python3 - "$CORE_UPSTREAM_LOCK" "$1" <<'PY'
import json
import sys
with open(sys.argv[1], "r", encoding="utf-8") as fh:
    print(json.load(fh)[sys.argv[2]])
PY
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}
