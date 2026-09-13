#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
bash -n "$ROOT/bin/dreamctl"

tmp="$(mktemp -d "${TMPDIR:-/tmp}/dreamctl-test.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/data"

acquired="$(DREAMCTL_DREAM_DIR="$tmp/dream" "$ROOT/bin/dreamctl" lock acquire --ttl 60 --trigger smoke)"
token="${acquired##* token=}"
printf '%s\n' "$(DREAMCTL_DREAM_DIR="$tmp/dream" "$ROOT/bin/dreamctl" lock status)" | grep -q '"locked":true'
printf '%s\n' "$(DREAMCTL_DREAM_DIR="$tmp/dream" DREAMCTL_MEM_DATA="$tmp/data" "$ROOT/bin/dreamctl" stats)" | jq -e '.lock.locked == true' >/dev/null

if DREAMCTL_DREAM_DIR="$tmp/dream" "$ROOT/bin/dreamctl" lock acquire --ttl 60 --trigger second >/dev/null 2>&1; then
  printf 'expected active lock to reject a second acquire\n' >&2
  exit 1
fi

if DREAMCTL_DREAM_DIR="$tmp/dream" "$ROOT/bin/dreamctl" lock release --token wrong >/dev/null 2>&1; then
  printf 'expected a wrong token to be rejected\n' >&2
  exit 1
fi

DREAMCTL_DREAM_DIR="$tmp/dream" "$ROOT/bin/dreamctl" lock release --token "$token" >/dev/null
test "$(DREAMCTL_DREAM_DIR="$tmp/dream" "$ROOT/bin/dreamctl" lock status)" = '{"locked":false,"age_seconds":null,"owner":null}'
printf 'memory evolution smoke test passed\n'
