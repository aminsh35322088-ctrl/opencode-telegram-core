#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

BUN="$("$CORE_ROOT/scripts/ensure-bun.sh")"
export PATH="$(dirname "$BUN"):$PATH"
export_upstream_build_environment
tree="$CORE_ROOT/.work/opencode-test"
"$CORE_ROOT/scripts/materialize-upstream.sh" "$tree"
"$CORE_ROOT/scripts/apply-patches.sh" "$tree"
bash "$CORE_ROOT/scripts/install-runtime-overlays.sh" "$tree" --tests
"$BUN" install --cwd "$tree" --frozen-lockfile
"$BUN" run --cwd "$tree/packages/opencode" typecheck
rm -f "$tree/packages/sdk/js/tsconfig.tsbuildinfo"
"$BUN" run --cwd "$tree/packages/sdk/js" script/build.ts
"$BUN" "$CORE_ROOT/scripts/verify-bot-sdk-surface.ts" "$tree/packages/sdk/js/dist"
(
  cd "$tree/packages/core"
  "$BUN" test test/npm.test.ts test/npm-config.test.ts --timeout 30000
)
(
  cd "$tree/packages/opencode"
  "$BUN" test test/telegram test/effect/runner.test.ts test/effect/instance-state.test.ts test/project/instance.test.ts test/tool/task.test.ts test/session/prompt.test.ts test/server/session-actions.test.ts test/lsp test/util/process.test.ts test/mcp --timeout 30000
  # Exercise the two shell admission/cancellation races observed in Linux CI.
  # A single passing run cannot establish that the intermittent stall is fixed.
  for attempt in {1..5}; do
    "$BUN" test test/session/prompt.test.ts --timeout 30000 \
      --test-name-pattern 'cancel interrupts loop queued behind shell|shell rejects when another shell is already running'
  done
)
