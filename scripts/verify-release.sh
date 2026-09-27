#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

release="${1:-$CORE_ROOT/dist/release}"
runtime_archive="$release/opencode-telegram-core-linux-x64.tar.gz"
sdk_archive="$release/opencode-telegram-core-sdk.tar.gz"
native_archive="$release/opencode-telegram-native-runtime.tar.gz"
manifest="$release/release-manifest.json"
build_info="$release/build-info.json"
checksums="$release/SHA256SUMS"

for file in "$runtime_archive" "$sdk_archive" "$native_archive" "$manifest" "$build_info" "$checksums"; do
  [[ -f "$file" ]] || die "missing release file: $file"
done

(
  cd "$release"
  sha256sum -c SHA256SUMS
)

python3 - "$manifest" "$build_info" "$CORE_UPSTREAM_LOCK" <<'PY'
import json
import re
import sys

manifest_path, build_path, lock_path = sys.argv[1:]
manifest = json.load(open(manifest_path, encoding="utf-8"))
build = json.load(open(build_path, encoding="utf-8"))
lock = json.load(open(lock_path, encoding="utf-8"))

expected = {
    "upstreamVersion": lock["version"],
    "upstreamCommit": lock["commit"],
    "telegramCoreVersion": lock["telegramCoreVersion"],
    "sdkRevision": lock["commit"],
}
for key, value in expected.items():
    if manifest.get(key) != value:
        raise SystemExit(f"manifest {key} mismatch: expected {value}, got {manifest.get(key)}")
if manifest.get("platform") != "linux-x64":
    raise SystemExit("manifest platform mismatch")
expected_artifacts = [
    "opencode-telegram-core-linux-x64.tar.gz",
    "opencode-telegram-core-sdk.tar.gz",
    "opencode-telegram-native-runtime.tar.gz",
]
if manifest.get("artifacts") != expected_artifacts:
    raise SystemExit("manifest artifact list mismatch")
core_commit = manifest.get("telegramCoreCommit", "")
if not re.fullmatch(r"[0-9a-f]{40}", core_commit):
    raise SystemExit("manifest telegramCoreCommit is not a 40-hex commit")
for key in ["upstreamVersion", "upstreamCommit", "telegramCoreVersion", "telegramCoreCommit", "sdkRevision"]:
    if build.get(key) != manifest.get(key):
        raise SystemExit(f"build-info {key} does not match manifest")
PY

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/runtime" "$tmp/sdk" "$tmp/native"
tar -xzf "$runtime_archive" -C "$tmp/runtime"
tar -xzf "$sdk_archive" -C "$tmp/sdk"
tar -xzf "$native_archive" -C "$tmp/native"
runtime="$tmp/runtime/opencode"
[[ -x "$runtime" ]] || die "runtime archive does not contain executable opencode"

expected_version="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["upstreamVersion"])' "$manifest")"
actual_version="$("$runtime" --version)"
[[ "$actual_version" == "$expected_version" ]] || die "runtime version mismatch: expected $expected_version, got $actual_version"

"$runtime" debug build-info > "$tmp/runtime-build-info.json"
python3 - "$manifest" "$tmp/runtime-build-info.json" <<'PY'
import json
import sys
manifest = json.load(open(sys.argv[1], encoding="utf-8"))
runtime = json.load(open(sys.argv[2], encoding="utf-8"))
for key in ["upstreamVersion", "upstreamCommit", "telegramCoreVersion", "telegramCoreCommit", "sdkRevision"]:
    if runtime.get(key) != manifest.get(key):
        raise SystemExit(f"runtime build-info {key} does not match manifest")
PY

[[ -f "$tmp/sdk/UPSTREAM_REVISION" ]] || die "SDK archive missing UPSTREAM_REVISION"
sdk_revision="$(tr -d '\r\n' < "$tmp/sdk/UPSTREAM_REVISION")"
expected_sdk="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["sdkRevision"])' "$manifest")"
[[ "$sdk_revision" == "$expected_sdk" ]] || die "SDK revision mismatch: expected $expected_sdk, got $sdk_revision"

[[ -f "$tmp/native/index.js" ]] || die "native runtime archive missing index.js"
[[ -f "$tmp/native/runtime-info.json" ]] || die "native runtime archive missing runtime-info.json"
python3 - "$manifest" "$tmp/native/runtime-info.json" <<'PY'
import json
import sys
manifest = json.load(open(sys.argv[1], encoding="utf-8"))
native = json.load(open(sys.argv[2], encoding="utf-8"))
if manifest.get("nativeRuntime") != native:
    raise SystemExit("native runtime metadata does not match manifest")
for key in ["telegramCoreCommit", "upstreamVersion", "upstreamCommit"]:
    if native.get(key) != manifest.get(key):
        raise SystemExit(f"native runtime {key} does not match release identity")
PY

printf 'release verified: %s\n' "$(basename "$release")"
