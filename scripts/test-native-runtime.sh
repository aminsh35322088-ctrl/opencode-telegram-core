#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUN="$("$ROOT/scripts/ensure-bun.sh")"
export PATH="$(dirname "$BUN"):$PATH"
cd "$ROOT/runtime"
"$BUN" install
"$BUN" run check
