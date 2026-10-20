#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")/.."

CORE_SOURCE_COMMIT="${CORE_SOURCE_COMMIT:-${GITHUB_SHA:-$(git rev-parse HEAD)}}"
IMAGE="${CORE_VALIDATION_IMAGE:-core-railway-validation:${GITHUB_RUN_ID:-local}}"
CONTAINER="core-railway-validation-${GITHUB_RUN_ID:-local}-$$"
PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')"
MEMORY_LIMIT_BYTES=1000000000

cleanup() {
  local status=$?
  trap - EXIT
  if (( status != 0 )); then
    docker logs --tail 300 "$CONTAINER" >&2 2>/dev/null || true
  fi
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT

printf 'Building compiled Railway validation image for Core commit %s (memory cap %s bytes)\n' "$CORE_SOURCE_COMMIT" "$MEMORY_LIMIT_BYTES"
docker build \
  --file Dockerfile.railway-runtime \
  --build-arg "CORE_SOURCE_COMMIT=$CORE_SOURCE_COMMIT" \
  --tag "$IMAGE" .

docker run --detach \
  --memory "$MEMORY_LIMIT_BYTES" \
  --memory-swap "$MEMORY_LIMIT_BYTES" \
  --name "$CONTAINER" \
  --publish "127.0.0.1:$PORT:3000" \
  "$IMAGE" >/dev/null

export CORE_SOURCE_COMMIT MEMORY_LIMIT_BYTES
python3 - "$PORT" "$CONTAINER" <<'PY'
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

port, container = sys.argv[1], sys.argv[2]
lock = json.loads(Path("upstream/lock.json").read_text())
expected_commit = os.environ["CORE_SOURCE_COMMIT"]
expected_memory_limit = int(os.environ["MEMORY_LIMIT_BYTES"])
url = f"http://127.0.0.1:{port}/"
deadline = time.monotonic() + 360
last = None

def container_state():
    result = subprocess.run(
        ["docker", "inspect", "--format", "{{.State.Status}}", container],
        check=False, capture_output=True, text=True,
    )
    return result.stdout.strip() if result.returncode == 0 else "missing"

while time.monotonic() < deadline:
    state = container_state()
    if state != "running":
        logs = subprocess.run(
            ["docker", "logs", "--tail", "200", container],
            check=False, capture_output=True, text=True,
        )
        raise SystemExit(f"validation container entered {state}:\n{logs.stdout}\n{logs.stderr}")
    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            last = json.loads(response.read())
    except urllib.error.HTTPError as error:
        try:
            last = json.loads(error.read())
        except (ValueError, OSError):
            last = None
    except (OSError, TimeoutError, ValueError):
        last = None

    if last and last.get("failures"):
        raise SystemExit(f"compiled-runtime soak reported failures: {last['failures']}")
    if last and last.get("healthy") and last.get("completedWorkloads", 0) >= 3:
        break
    time.sleep(2)
else:
    raise SystemExit(
        "compiled-runtime image never reached healthy state with three completed workloads; "
        f"last evidence={json.dumps(last, sort_keys=True)[:4000]}"
    )

build = last.get("build") or {}
assert build.get("upstreamVersion") == lock["version"], (build.get("upstreamVersion"), lock["version"])
assert build.get("upstreamCommit") == lock["commit"], (build.get("upstreamCommit"), lock["commit"])
assert build.get("telegramCoreCommit") == expected_commit, (build.get("telegramCoreCommit"), expected_commit)
assert build.get("runtimeProfile") == "telegram-headless", build
assert build.get("embeddedWebUi") is False, build
assert last.get("alive") is True and last.get("healthy") is True
assert last.get("runtimeBytes", lock["runtimeMaxBytes"] + 1) <= lock["runtimeMaxBytes"]
assert not last.get("failures"), last.get("failures")

browser = last.get("browser") or {}
required_browser_checks = (
    "persistentGenerationHandoff",
    "idleParked",
    "exclusiveTopicPause",
    "activeResumeSameDaemon",
    "pausedAbortConfirmedEmpty",
    "workspaceRetirementConfirmedEmpty",
    "privateProfilesRetired",
    "replacementDoesNotAdoptOldBrowser",
    "foreignTopicWorkWhilePaused",
)
failed_checks = [key for key in required_browser_checks if browser.get(key) is not True]
assert not failed_checks, f"browser/process-scope isolation checks failed: {failed_checks}"
descendants = last.get("descendantCounts") or []
assert descendants and all(value == 0 for value in descendants[-3:]), descendants[-3:]
cgroup_samples = last.get("cgroupSamples") or []
assert len(cgroup_samples) >= 3, f"missing cgroup resource observations: {cgroup_samples}"
recent_cgroups = cgroup_samples[-3:]
memory_limits = [sample.get("memoryMaxBytes") for sample in recent_cgroups]
assert all(value == expected_memory_limit for value in memory_limits), (
    f"container memory cap mismatch: expected {expected_memory_limit}, observed {memory_limits}"
)
memory_current = [sample.get("memoryCurrentBytes") for sample in recent_cgroups]
assert all(isinstance(value, int) and value <= expected_memory_limit for value in memory_current), (
    f"container cgroup memory exceeded its configured cap: {memory_current}"
)

print(json.dumps({
    "validation": "passed",
    "upstreamVersion": build["upstreamVersion"],
    "upstreamCommit": build["upstreamCommit"],
    "coreCommit": build["telegramCoreCommit"],
    "runtimeProfile": build["runtimeProfile"],
    "runtimeBytes": last["runtimeBytes"],
    "runtimeMaxBytes": lock["runtimeMaxBytes"],
    "completedWorkloads": last["completedWorkloads"],
    "maxRuntimeRssKiB": max(last.get("rssKiB") or [0]),
    "maxObservedDescendants": max(descendants or [0]),
    "browserTrees": browser.get("browserTrees"),
    "browserIsolationChecks": len(required_browser_checks),
    "containerMemoryLimitBytes": memory_limits[-1],
    "maxContainerMemoryCurrentBytes": max(memory_current),
    "failures": last["failures"],
}, sort_keys=True), flush=True)
PY
