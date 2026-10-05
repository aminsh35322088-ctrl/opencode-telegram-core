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

export_upstream_build_environment() {
  local version
  version="$(json_get version)"
  export OPENCODE_VERSION="$version"
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

assert_clean_source_tree() {
  local repo="$1"
  local dirty
  dirty="$(git -C "$repo" status --porcelain --untracked-files=normal)"
  [[ -z "$dirty" ]] || die "source tree is dirty; commit or clean changes before packaging"
}

assert_safe_materialize_destination() {
  local target="$1"
  local home="$2"
  local core="$3"
  local tmp="${4:-${TMPDIR:-/tmp}}"
  tmp="${tmp%/}"

  [[ "$target" != "/" ]] || die "refusing dangerous materialization destination: $target"
  [[ "$target" != "$home" && "$home" != "$target/"* ]] || die "refusing destination that contains HOME: $target"
  [[ "$target" != "$core" && "$core" != "$target/"* ]] || die "refusing destination that contains source tree: $target"

  case "$target" in
    "$core/.work/"*|"$tmp/"*) ;;
    *) die "materialization destination must be under $core/.work or $tmp: $target" ;;
  esac
}

# Keep the pinned lock intact, but install only the runtime/SDK workspace closure.
# Unused Console/Web previews must not make a Telegram build depend on an expired
# upstream preview URL. Bun includes transitive workspace dependencies. Hoisting
# preserves the pinned source's ambient SDK/type/build-tool lookup at the root.
install_upstream_dependencies() {
  local tree="${1:?upstream tree required}"
  local bun="${2:?Bun executable required}"
  "$bun" install --cwd "$tree" --frozen-lockfile --linker hoisted \
    --filter './packages/opencode' --filter './packages/sdk/js'
}
