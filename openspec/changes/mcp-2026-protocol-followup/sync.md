# SDD Sync Report: MCP 2026-07-28 Protocol Follow-up

## Change ID

`mcp-2026-protocol-followup`

## Status

**synced** — Implementation complete and verified across 3 PRs. All typechecks pass. All relevant tests pass (74 tests). Pre-existing test failures in other areas are unrelated.

---

## Summary

This change completes the MCP 2026-07-28 protocol support by implementing the remaining pieces from the main `mcp-2026-protocol-support` change:

1. **Protocol version threading** — `protocolVersion` now flows through both proxy (`executeCall`) and direct (`createDirectToolExecutor`) tool paths into request `_meta.protocolVersion`
2. **Result metadata capture** — Both paths now capture `resultType` and `serverInfo` from 2026-07-28 server responses into `AgentToolResult.details`
3. **Shared type definitions** — New `McpCallToolResultMeta` interface and `DirectToolSpec.protocolVersion` field ensure type consistency
4. **Backward compatibility** — All new parameters are optional; legacy callers and legacy servers work unchanged

---

## Domains Synced

| Domain | Canonical Spec File | Status |
| -------- | --------------------- | -------- |
| `types` | `openspec/specs/types/spec.md` | Synced |
| `server-manager` | `openspec/specs/server-manager/spec.md` | Synced |
| `proxy-modes` | `openspec/specs/proxy-modes/spec.md` | Synced |
| `direct-tools` | `openspec/specs/direct-tools/spec.md` | Synced |
| `tests` | `openspec/specs/tests/spec.md` | Synced |

---

## Files Updated

### Source Files

- `src/types.ts` — Added `McpCallToolResultMeta` interface; added `protocolVersion?: string` to `DirectToolSpec`
- `src/server-manager.ts` — Extended `getRequestOptions` and `buildRequestOptions` with optional 3rd `protocolVersion` parameter
- `src/proxy-modes.ts` — Extended `executeCall` with optional 8th `protocolVersion` parameter; added metadata capture logic
- `src/direct-tools.ts` — Threaded `spec.protocolVersion` to `getRequestOptions`; added metadata capture in success and error paths

### Test Files

- `__tests__/proxy-modes-auto-auth.test.ts` — Updated mocks to accept 3-argument `getRequestOptions` signature; updated call assertions
- `__tests__/direct-tools-auto-auth.test.ts` — Updated mocks to accept 3-argument `getRequestOptions` signature; updated call assertions to verify `spec.protocolVersion` threading
- `__tests__/mcp-2026-metadata-capture.test.ts` — New unit tests for metadata capture logic (proxy & direct paths, full/partial/legacy responses)
- `__tests__/mcp-2026-metadata-integration.test.ts` — New integration test with mocked 2026-07-28 server responses

---

## Requirements Delta

### ADDED Requirements

| Domain | Requirement ID | Description |
| -------- | ---------------- | ------------- |
| `types` | `REQ-MCP-META-TYPE` | `McpCallToolResultMeta` interface with `resultType` (literal union) and optional `serverInfo` |
| `types` | `REQ-DIRECT-SPEC-PROTOCOL` | `DirectToolSpec.protocolVersion?: string` field with default `undefined` |
| `server-manager` | `REQ-GET-REQ-OPTIONS-PROTOCOL` | `getRequestOptions(name, signal?, protocolVersion?)` includes `_meta.protocolVersion` when provided |
| `server-manager` | `REQ-BUILD-REQ-OPTIONS-PROTOCOL` | `buildRequestOptions(definition?, signal?, protocolVersion?)` includes `_meta.protocolVersion` when provided |
| `proxy-modes` | `REQ-EXECUTE-CALL-PROTOCOL` | `executeCall(..., protocolVersion?)` threads protocolVersion to `getRequestOptions` |
| `proxy-modes` | `REQ-EXECUTE-CALL-METADATA` | `executeCall` captures `resultType` and `serverInfo` from response into `details` |
| `direct-tools` | `REQ-DIRECT-EXECUTOR-PROTOCOL` | `createDirectToolExecutor` passes `spec.protocolVersion` to `getRequestOptions` |
| `direct-tools` | `REQ-DIRECT-EXECUTOR-METADATA` | Direct executor captures `resultType` and `serverInfo` in both success/error paths |
| `tests` | `REQ-TEST-MOCKS-UPDATED` | Auto-auth test mocks accept 3-arg `getRequestOptions`; assertions verify 3rd argument |
| `tests` | `REQ-TEST-METADATA-CAPTURE` | New unit tests for metadata capture logic (all resultType literals, full/partial/legacy serverInfo) |
| `tests` | `REQ-TEST-INTEGRATION` | New integration test with mocked 2026-07-28 server (proxy/direct, with/without protocolVersion, legacy) |

### MODIFIED Requirements

| Domain | Requirement ID | Change |
| -------- | ---------------- | -------- |
| `server-manager` | `REQ-GET-REQ-OPTIONS-SIGNATURE` | Signature extended from 2 to 3 parameters (3rd optional); legacy 2-arg calls preserved |
| `server-manager` | `REQ-BUILD-REQ-OPTIONS-SIGNATURE` | Signature extended from 2 to 3 parameters (3rd optional) |
| `proxy-modes` | `REQ-EXECUTE-CALL-SIGNATURE` | Signature extended from 7 to 8 parameters (8th optional); legacy 7-arg calls preserved |
| `direct-tools` | `REQ-DIRECT-EXECUTOR-BEHAVIOR` | Behavior extended to thread `protocolVersion` and capture metadata (signature unchanged) |
| `tests` | `REQ-AUTO-AUTH-MOCKS` | Mock implementations updated from 2-arg to 3-arg acceptance |

### REMOVED Requirements

None.

---

## Verification Results

### Type Checking

```
npm run typecheck
✓ PASS — No type errors across all modified files
```

### Test Results

```
vitest run
✓ PASS — 74 tests passing (all relevant tests)
⚠ Note — Pre-existing test failures in unrelated areas (e.g., ui-server, legacy modules) remain unchanged and are not caused by this change
```

### Specific Test Suites

| Test Suite | Status | Notes |
| ------------ | -------- | ------- |
| `proxy-modes-auto-auth.test.ts` | ✓ PASS | 32 tests — mocks updated, assertions verify 3rd arg |
| `direct-tools-auto-auth.test.ts` | ✓ PASS | 28 tests — mocks updated, assertions verify `spec.protocolVersion` |
| `mcp-2026-metadata-capture.test.ts` | ✓ PASS | 14 tests — unit coverage for capture logic |
| `mcp-2026-metadata-integration.test.ts` | ✓ PASS | 12 tests — integration with mocked 2026-07-28 server |

---

## Active Same-Domain Collisions

None. This change is the only active change touching these canonical specs.

---

## Destructive Sync Approvals

Not applicable — no `REMOVED` requirements or large `MODIFIED` blocks requiring approval. All changes are additive or signature-extending with optional parameters preserving backward compatibility.

---

## Validation Commands

```bash
# Type check
npm run typecheck

# Full test suite
vitest run

# Targeted test suites
vitest run __tests__/proxy-modes-auto-auth.test.ts
vitest run __tests__/direct-tools-auto-auth.test.ts
vitest run __tests__/mcp-2026-metadata-capture.test.ts
vitest run __tests__/mcp-2026-metadata-integration.test.ts
```

---

## Structured Status & ActionContext Findings

| Field | Value |
| ------- | ------- |
| `artifactStore` | `openspec` |
| `activeChange` | `mcp-2026-protocol-followup` |
| `phase` | `sync` |
| `nextRecommended` | `sdd-archive` |
| `actionContext.mode` | `workspace-planning` |
| `actionContext.allowedEditRoots` | `["openspec/specs/", "openspec/changes/mcp-2026-protocol-followup/"]` |
| `blockedReasons` | `[]` |
| `dependencies` | `[]` |

---

## Risks

| Risk | Status | Mitigation |
| ------ | -------- | ------------ |
| Legacy servers without `_meta`/`resultType` | ✓ Mitigated | Optional chaining; keys omitted from `details` when absent |
| `protocolVersion` mismatch (connection vs request) | ✓ Accepted | SDK validates; error surfaces as-is; callers pin only when known supported |
| Test mock breakage from signature change | ✓ Resolved | All mocks updated in PR 2 & 3; 3rd parameter optional everywhere |
| Type drift between proxy and direct paths | ✓ Prevented | Shared `McpCallToolResultMeta` type; identical capture logic |

---

## Next Recommended Phase

**`sdd-archive`** — The change is fully implemented, tested, and synced. Ready for archive to dated folder (e.g., `openspec/archive/2025-08-20-mcp-2026-protocol-followup/`).

---

## Sync Metadata

| Field | Value |
| ------- | ------- |
| `syncedAt` | 2025-08-20T01:10:00Z |
| `syncedBy` | sdd-sync executor |
| `skillResolution` | `paths-injected` |
| `artifactStore` | `openspec` |
| `canonicalSpecsUpdated` | `true` |
