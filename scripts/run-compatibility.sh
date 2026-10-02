#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
python3 "$ROOT/tests/compatibility/headless_surface.py" --binary "$ROOT/dist/runtime/opencode"
python3 "$ROOT/tests/compatibility/production_execution.py" --binary "$ROOT/dist/runtime/opencode"
# Historical v2 invariants belong to the independent compatibility artifact.
if [[ -x "$ROOT/dist/compat/opencode" ]]; then
  python3 "$ROOT/tests/compatibility/session_contract.py" --binary "$ROOT/dist/compat/opencode"
  python3 "$ROOT/tests/compatibility/production_execution.py" --binary "$ROOT/dist/compat/opencode"
fi
