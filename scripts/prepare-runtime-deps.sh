#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

BUN="$("$CORE_ROOT/scripts/ensure-bun.sh")"
export PATH="$(dirname "$BUN"):$PATH"
export_upstream_build_environment
tree="$CORE_ROOT/.work/opencode"

"$CORE_ROOT/scripts/materialize-upstream.sh" "$tree"
"$CORE_ROOT/scripts/apply-patches.sh" "$tree"
install_upstream_dependencies "$tree" "$BUN"
