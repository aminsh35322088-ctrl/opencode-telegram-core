#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
BUN="$("$CORE_ROOT/scripts/ensure-bun.sh")"
mkdir -p "$CORE_ROOT/dist/compat"
(cd "$CORE_ROOT/runtime" && "$BUN" install --frozen-lockfile && "$BUN" build src/compat.ts --target=bun --format=esm --minify --outfile "$CORE_ROOT/dist/compat/native-runtime.js")
