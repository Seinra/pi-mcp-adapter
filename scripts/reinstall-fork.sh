#!/usr/bin/env bash
# Reinstall OUR forked pi-mcp-adapter build into Pi's extension prefix.
#
# Why this exists: every `pi install npm:gentle-pi` resolves pi-mcp-adapter
# from the npm registry and silently overwrites our custom build (envelope
# reshape for spec-literal 2026-07-28) with the official one. Run this right
# after any gentle-pi / pi extension reinstall.
#
# Usage:
#   ./scripts/reinstall-fork.sh          # copy + verify
#   ./scripts/reinstall-fork.sh --check  # verify only, no copy
#
# Env:
#   PI_MCP_ADAPTER_DEST  override for the installed package dir
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${PI_MCP_ADAPTER_DEST:-C:/Users/Seinra/.pi/agent/npm/node_modules/pi-mcp-adapter}"
FILES=(envelope-reshape.ts server-manager.ts bearer-command-resolver.ts package.json)

fail() {
  echo "ERROR: $*" >&2
  exit 1
}
info() { echo "-- $*"; }

[[ -d "$DEST" ]] || fail "installed adapter not found at $DEST (set PI_MCP_ADAPTER_DEST?)"
for f in "${FILES[@]}"; do
  [[ -f "$REPO/$f" ]] || fail "repo file missing: $REPO/$f"
done

if [[ "${1:-}" == "--check" ]]; then
  info "check-only mode, no files copied"
else
  info "copying ${#FILES[@]} file(s) to $DEST"
  for f in "${FILES[@]}"; do
    cp "$REPO/$f" "$DEST/$f"
  done
fi

info "verifying installed build"
[[ -f "$DEST/envelope-reshape.ts" ]] || fail "envelope-reshape.ts missing in $DEST"
[[ -f "$DEST/bearer-command-resolver.ts" ]] || fail "bearer-command-resolver.ts missing in $DEST (server-manager.ts imports it since upstream #615)"
grep -q "installEnvelopeReshaping" "$DEST/server-manager.ts" ||
  fail "server-manager.ts in $DEST has no reshape hooks (official build?)"
grep -q "envelope-reshape" "$DEST/package.json" ||
  fail "package.json in $DEST lacks the envelope-reshape files entry"
grep -q '"version": "2.36.0"' "$DEST/package.json" ||
  fail "unexpected version in $DEST/package.json (expected fork on 2.36.0)"

info "checking for dangling relative imports in installed build"
missing=0
for mod in "$DEST"/*.ts; do
  while IFS= read -r dep; do
    [[ -f "$DEST/$dep" ]] || { echo "ERROR: $mod imports missing $dep" >&2; missing=1; }
  done < <(grep -oE 'from "\./[^"]+\.ts"' "$mod" | sed -E 's/from "\.\///; s/"$//' | sort -u)
done
[[ "$missing" -eq 0 ]] || fail "dangling imports found (see above)"

info "OK: fork build installed (reshape hooks + files entry present)"
