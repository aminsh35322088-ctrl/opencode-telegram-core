#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

tree="${1:?usage: install-runtime-overlays.sh WORKTREE [--tests]}"
[[ -d "$tree/packages/core/src" ]] || die "upstream Core source missing"
cp "$CORE_ROOT/runtime/upstream/session-execution-control.ts" "$tree/packages/core/src/session-execution-control.ts"
cp "$CORE_ROOT/runtime/upstream/telegram-execution-context.ts" "$tree/packages/core/src/telegram-execution-context.ts"
cp "$CORE_ROOT/runtime/src/opencode/event-provenance.ts" "$tree/packages/core/src/telegram-event-provenance.ts"
cp "$CORE_ROOT/runtime/src/runtime/deadline.ts" "$tree/packages/core/src/telegram-deadline.ts"
cp "$CORE_ROOT/runtime/upstream/telegram-mcp-stdio.ts" "$tree/packages/opencode/src/mcp/telegram-stdio.ts"
cp "$CORE_ROOT/runtime/upstream/telegram-service-process.ts" "$tree/packages/core/src/telegram-service-process.ts"
cp "$CORE_ROOT/runtime/upstream/telegram-owned-process.ts" "$tree/packages/core/src/telegram-owned-process.ts"
cp "$CORE_ROOT/runtime/upstream/telegram-tool-process.ts" "$tree/packages/core/src/telegram-tool-process.ts"
cp "$CORE_ROOT/runtime/src/opencode/tool-process.ts" "$tree/packages/core/src/telegram-tool-process-contract.ts"
cp "$CORE_ROOT/runtime/src/opencode/tool-process.ts" "$tree/packages/plugin/src/tool-process.ts"
if [[ "${2:-}" == "--tests" ]]; then
  mkdir -p "$tree/packages/opencode/test/telegram"
  cp "$CORE_ROOT/runtime/upstream/telegram-headless.ts" "$tree/packages/opencode/src/telegram-headless.ts"
  cp "$CORE_ROOT/runtime/upstream/test/telegram-headless-governor.fixture.ts" "$tree/packages/opencode/test/telegram/"
  cp "$CORE_ROOT/runtime/upstream/test/telegram-mcp-service.fixture.ts" "$tree/packages/opencode/test/telegram/"
  cp "$CORE_ROOT"/runtime/upstream/test/*.test.ts "$tree/packages/opencode/test/telegram/"
fi
