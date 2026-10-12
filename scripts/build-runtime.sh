#!/usr/bin/env bash
set -Eeuo pipefail
CORE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
"$CORE_ROOT/scripts/prepare-runtime-deps.sh"
"$CORE_ROOT/scripts/compile-runtime.sh"
