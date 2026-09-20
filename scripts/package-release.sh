#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

runtime="$CORE_ROOT/dist/runtime/opencode"
sdk="$CORE_ROOT/dist/sdk"
build_info="$CORE_ROOT/dist/build-info.json"
release="$CORE_ROOT/dist/release"

[[ -x "$runtime" ]] || die "runtime artifact missing"
[[ -d "$sdk" ]] || die "SDK artifact missing"
[[ -f "$sdk/UPSTREAM_REVISION" ]] || die "SDK revision marker missing"
[[ -f "$build_info" ]] || die "build-info artifact missing"

source_commit="$(git -C "$CORE_ROOT" rev-parse HEAD)"
python3 - "$build_info" "$CORE_UPSTREAM_LOCK" "$source_commit" <<'PY'
import json
import sys

build_path, lock_path, source_commit = sys.argv[1:]
build = json.load(open(build_path, encoding="utf-8"))
lock = json.load(open(lock_path, encoding="utf-8"))
expected = {
    "upstreamVersion": lock["version"],
    "upstreamCommit": lock["commit"],
    "telegramCoreVersion": lock["telegramCoreVersion"],
    "telegramCoreCommit": source_commit,
    "sdkRevision": lock["commit"],
}
for key, value in expected.items():
    if build.get(key) != value:
        raise SystemExit(f"stale or mismatched build-info {key}: expected {value}, got {build.get(key)}")
PY

sdk_revision="$(tr -d '\r\n' < "$sdk/UPSTREAM_REVISION")"
[[ "$sdk_revision" == "$(json_get commit)" ]] || die "SDK revision does not match upstream lock"

rm -rf "$release"
mkdir -p "$release"

tar --sort=name --mtime='UTC 1970-01-01' --owner=0 --group=0 --numeric-owner   -czf "$release/opencode-telegram-core-linux-x64.tar.gz" -C "$CORE_ROOT/dist/runtime" opencode
tar --sort=name --mtime='UTC 1970-01-01' --owner=0 --group=0 --numeric-owner   -czf "$release/opencode-telegram-core-sdk.tar.gz" -C "$sdk" .

cp "$build_info" "$release/build-info.json"
python3 - "$build_info" "$release/release-manifest.json" <<'PY'
import json
import sys

build = json.load(open(sys.argv[1], encoding="utf-8"))
manifest = {
    **build,
    "platform": "linux-x64",
    "artifacts": [
        "opencode-telegram-core-linux-x64.tar.gz",
        "opencode-telegram-core-sdk.tar.gz",
    ],
}
with open(sys.argv[2], "w", encoding="utf-8") as fh:
    json.dump(manifest, fh, indent=2, sort_keys=True)
    fh.write("\n")
PY

(
  cd "$release"
  sha256sum     opencode-telegram-core-linux-x64.tar.gz     opencode-telegram-core-sdk.tar.gz     build-info.json     release-manifest.json > SHA256SUMS
)

printf 'release packaged: %s\n' "$release"
