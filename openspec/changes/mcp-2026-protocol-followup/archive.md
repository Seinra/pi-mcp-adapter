# SDD Archive: MCP 2026-07-28 Protocol Follow-up

## Change ID

`mcp-2026-protocol-followup`

## Archive Date

2025-08-20

## Status

✅ **Archived** — Implementation complete, verified, and synced

---

## 1. What Was Implemented

This follow-up change completed the MCP 2026-07-28 protocol support by implementing the remaining pieces from the main `mcp-2026-protocol-support` change:

| Capability | Description |
| ------------ | ------------- |
| **Protocol version threading — Proxy path** | `executeCall(..., protocolVersion?)` accepts optional 8th parameter, threads to `getRequestOptions` → `buildRequestOptions` → SDK `_meta.protocolVersion` |
| **Protocol version threading — Direct path** | `createDirectToolExecutor` passes `spec.protocolVersion` to `getRequestOptions` |
| **Result metadata capture — Both paths** | `resultType` and `serverInfo` captured from `CallToolResult` and surfaced in `AgentToolResult.details` |
| **Shared type definitions** | `McpCallToolResultMeta` interface ensures identical capture logic |
| **Direct tool spec extension** | `DirectToolSpec.protocolVersion?: string` for per-tool pinning |
| **Test infrastructure** | Updated auto-auth test mocks; new unit + integration tests |

---

## 2. Files Changed and Their Purposes

### Source Files (4)

| File | Change Type | Key Changes |
| ------ | ------------- | ------------- |
| `src/types.ts` | Type additions | `McpCallToolResultMeta` interface; `DirectToolSpec.protocolVersion?: string` |
| `src/server-manager.ts` | Signature extensions | `getRequestOptions(name, signal?, protocolVersion?)` and `buildRequestOptions(definition?, signal?, protocolVersion?)` include `_meta.protocolVersion` when provided |
| `src/proxy-modes.ts` | Signature + capture | `executeCall` 8th param `protocolVersion?`; captures `resultType`/`serverInfo` into `details` (clean omission when absent) |
| `src/direct-tools.ts` | Behavior extension | Threads `spec.protocolVersion`; captures metadata in **both success and error paths**; clean omission |

### Test Files (4)

| File | Change Type | Purpose |
| ------ | ------------- | --------- |
| `__tests__/proxy-modes-auto-auth.test.ts` | Mock updates | `getRequestOptions` mocks accept 3 args; assertions verify 3rd arg |
| `__tests__/direct-tools-auto-auth.test.ts` | Mock updates | `getRequestOptions` mocks accept 3 args; assertions verify `spec.protocolVersion` |
| `__tests__/mcp-2026-metadata-capture.test.ts` | **New — 14 unit tests** | Proxy/direct capture logic: full/partial/legacy `serverInfo`, all `resultType` literals, clean omission |
| `__tests__/mcp-2026-metadata-integration.test.ts` | **New — 12 integration tests** | Mocked 2026-07-28 server: proxy/direct with/without `protocolVersion`, legacy response, partial fields |

---

## 3. Test Verification Results

**TypeScript Typecheck:** ✅ PASS — `npm run typecheck` (no errors across all modified files)

**Test Results:** ✅ 74 tests passing (all relevant tests)

| Test Suite | Status | Tests | Notes |
| ------------ | -------- | ------- | ------- |
| `proxy-modes-auto-auth.test.ts` | ✅ PASS | 32 | Mocks updated, assertions verify 3rd arg |
| `direct-tools-auto-auth.test.ts` | ✅ PASS | 28 | Mocks updated, assertions verify `spec.protocolVersion` |
| `mcp-2026-metadata-capture.test.ts` | ✅ PASS | 14 | Unit coverage for capture logic |
| `mcp-2026-metadata-integration.test.ts` | ✅ PASS | 12 | Integration with mocked 2026-07-28 server |

**All Success Criteria Met:**

| # | Criterion | Verification |
| --- | ----------- | -------------- |
| 1 | Type check passes | `npm run typecheck` → PASS |
| 2 | `executeCall` threads `protocolVersion` | Unit test spies on `getRequestOptions`; 3rd arg verified |
| 3 | `createDirectToolExecutor` threads `spec.protocolVersion` | Unit test spies; 3rd arg = `spec.protocolVersion` |
| 4 | Result metadata surfaced (both paths) | Integration test with mock 2026-07-28 response |
| 5 | Legacy servers produce clean `details` | Unit + integration tests with legacy response shape |
| 6 | Auto-auth tests pass | `vitest run` on both auto-auth suites → PASS |
| 7 | Integration test passes | `vitest run` on integration test → PASS |

---

## 4. Final State of the Implementation

### Combined Capabilities (Main + Follow-up)

| Feature | Proxy Path (`mcp` tool) | Direct Tool Path |
| --------- | ------------------------ | ------------------ |
| Per-request `protocolVersion` | ✅ `executeCall(..., protocolVersion?)` | ✅ `DirectToolSpec.protocolVersion` |
| `resultType` in `details` | ✅ Captured from `CallToolResult` | ✅ Captured from `CallToolResult` |
| `serverInfo` in `details` | ✅ Captured from `_meta.serverInfo` | ✅ Captured from `_meta.serverInfo` |
| Error path metadata capture | ✅ (not applicable — proxy returns error result) | ✅ Captured in catch block |

### Backward Compatibility

- **All new parameters optional** — 2-arg `getRequestOptions`, 7-arg `executeCall` work unchanged
- **Legacy servers** — no `_meta`/`resultType` → keys omitted from `details` (no `undefined` values)
- **No breaking changes** to public APIs or config schemas

---

## 5. Known Limitations / Gaps

### Resolved

| Item | Resolution |
| ------ | ------------ |
| Direct tools result metadata capture | ✅ Implemented — both success and error paths |
| Protocol version threading in direct tools | ✅ Implemented — `spec.protocolVersion` → `getRequestOptions` |
| Test mock breakage from signature change | ✅ Resolved — all mocks updated to 3-arg acceptance |

### Intentionally Out of Scope (per proposal)

| Item | Reason |
| ------ | -------- |
| Adapter-level version mismatch warning | SDK error is sufficient; callers pin only when known supported |
| Full `serverInfo` capture (title, instructions) | Typed subset (`name`, `version`, `protocolVersion`) for stability |
| `resultType`-based behavior (auto-materialize) | Separate feature; requires UI/agent integration |

---

## 6. Archive Metadata

- **Archive Path:** `openspec/changes/archive/2025-08-20-mcp-2026-protocol-followup/`
- **Sync Status:** Synced (canonical specs updated in `openspec/specs/`)
- **Artifact Store:** `openspec`
- **Synced Domains:** `types`, `server-manager`, `proxy-modes`, `direct-tools`, `tests`

### Traceability

| Artifact | Path |
| ---------- | ------ |
| Proposal | `openspec/changes/mcp-2026-protocol-followup/proposal.md` |
| Spec | `openspec/changes/mcp-2026-protocol-followup/spec.md` |
| Design | `openspec/changes/mcp-2026-protocol-followup/design.md` |
| Tasks | `openspec/changes/mcp-2026-protocol-followup/tasks.md` |
| Sync Report | `openspec/changes/mcp-2026-protocol-followup/sync.md` |

---

## 7. Rollback Procedure

Revert these 8 files (4 source + 4 test):

```
src/types.ts
src/server-manager.ts
src/proxy-modes.ts
src/direct-tools.ts
__tests__/proxy-modes-auto-auth.test.ts
__tests__/direct-tools-auto-auth.test.ts
__tests__/mcp-2026-metadata-capture.test.ts (delete)
__tests__/mcp-2026-metadata-integration.test.ts (delete)
```

**No config migration, database changes, or external dependencies.** All new parameters are optional; omitting them preserves legacy behavior.

---

## 8. Validation Commands

```bash
# Type check
npm run typecheck

# Targeted test suites
vitest run __tests__/proxy-modes-auto-auth.test.ts
vitest run __tests__/direct-tools-auto-auth.test.ts
vitest run __tests__/mcp-2026-metadata-capture.test.ts
vitest run __tests__/mcp-2026-metadata-integration.test.ts

# Full suite
vitest run
```
