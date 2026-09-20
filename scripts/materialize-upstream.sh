#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

dest="${1:-$CORE_ROOT/.work/opencode}"
repo="$(json_get repository)"
tag="$(json_get tag)"
expected="$(json_get commit)"

rm -rf "$dest"
mkdir -p "$(dirname "$dest")"
git init -q "$dest"
git -C "$dest" remote add origin "$repo"
git -C "$dest" fetch -q --depth=1 origin "refs/tags/$tag:refs/tags/$tag"
actual="$(git -C "$dest" rev-parse "$tag^{commit}")"
[[ "$actual" == "$expected" ]] || die "upstream commit mismatch: expected $expected, got $actual"
git -C "$dest" checkout -q --detach "$actual"
[[ -z "$(git -C "$dest" status --porcelain)" ]] || die "materialized upstream is dirty"
printf '%s\n' "$actual"
