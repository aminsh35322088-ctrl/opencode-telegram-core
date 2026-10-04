#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
BUN="$("$CORE_ROOT/scripts/ensure-bun.sh")"
export PATH="$(dirname "$BUN"):$PATH"
export_upstream_build_environment
tree="$CORE_ROOT/.work/opencode"
[[ -f "$tree/packages/opencode/tsconfig.telegram.json" ]] || die "build the production runtime first"
python3 "$CORE_ROOT/scripts/verify-production-graph.py" "$CORE_ROOT/dist/runtime/opencode.metafile.json"
bash "$CORE_ROOT/scripts/install-runtime-overlays.sh" "$tree" --tests
OPENCODE_PACKAGE_DIR="$tree/packages/opencode" "$BUN" test "$CORE_ROOT/tests/compatibility/aws-credential-policy.test.ts" --timeout 30000
(
  cd "$tree/packages/opencode"
  "$BUN" x tsc -p tsconfig.telegram.json --noEmit
  # These nine assertions concern retired production APIs/schema export or the
  # OS browser opener. They still run in the full upstream compatibility suite;
  # compiled negative-route and graph checks enforce their production exclusion.
  "$BUN" test test/telegram test/effect/runner.test.ts test/effect/instance-state.test.ts test/project/instance.test.ts test/tool/task.test.ts \
    test/session/prompt.test.ts test/server/session-actions.test.ts test/lsp \
    test/util/process.test.ts test/mcp --timeout 30000 \
    --test-name-pattern '^(?!.*(?:experimental background route|authenticate\(\)|BrowserOpenFailed|browser launch|generated SDK event schemas)).*'
  for attempt in {1..5}; do
    "$BUN" test test/session/prompt.test.ts --timeout 30000 \
      --test-name-pattern 'cancel interrupts loop queued behind shell|shell rejects when another shell is already running'
  done
)
(cd "$tree/packages/core" && "$BUN" test test/filesystem/search.test.ts test/ripgrep.test.ts test/npm.test.ts test/npm-config.test.ts --timeout 30000)
"$CORE_ROOT/scripts/run-compatibility.sh"
