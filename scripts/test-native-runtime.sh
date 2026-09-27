#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUN="$("$ROOT/scripts/ensure-bun.sh")"
cd "$ROOT/runtime"
"$BUN" install
"$BUN" run check
