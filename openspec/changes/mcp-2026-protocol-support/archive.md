# SDD Archive: MCP 2026-07-28 Protocol Support

## Change ID

`mcp-2026-protocol-support`

## Archive Date

2025-08-20

## Status

✅ **Archived** — Implementation complete, verified, and synced

---

## 1. What Was Implemented Across Both SDD Flows

### Main Flow (`mcp-2026-protocol-support`)

This change implemented **core MCP 2026-07-28 protocol plumbing** across 6 source files (~170 lines), enabling the Toolbelt Gateway and other modern MCP consumers to work through the pi-mcp-adapter.

**Key capabilities delivered:**

| Capability | Description |
| ------------ | ------------- |
| **Server Discovery** | `server/discover` endpoint probing for HTTP servers with `protocolVersion: "auto"` or `"2026-07-28"` |
| **Tool List Cache Metadata** | Capture `ttlMs` and `cacheScope` from `tools/list` responses; persist per tool |
| **Tool Call Result Metadata** | Surface `resultType` and `_meta.serverInfo` from `tools/call` responses in `details` |
| **Per-Request Protocol Version** | Thread `protocolVersion` via `_meta.protocolVersion` on `callTool`/`listTools` calls |
| **Modern Protocol Constant** | `MODERN_PROTOCOL_VERSION = "2026-07-28"` exported from `mcp-probe.ts` for reuse |
| **Legacy Fallback Warning** | Warning logged when server negotiates legacy protocol (pre-2026-07-28) |

### Follow-up Flow (`mcp-2026-protocol-followup`)

Completed the remaining pieces across 4 source files + 4 test files:

- Protocol version threading through **both proxy and direct tool paths**
- Result metadata capture (`resultType`, `serverInfo`) in **both paths**
- Shared `McpCallToolResultMeta` type for consistency
- `DirectToolSpec.protocolVersion` field for per-tool pinning
- Test mock updates for 3-argument `getRequestOptions` signature
- New unit + integration tests for metadata capture

---

## 2. Files Changed and Their Purposes

### Main Flow — 6 Source Files

| File | Change Type | Purpose |
| ------ | ------------- | --------- |
| `src/types.ts` | Interface extensions + new type | Added `ttlMs`/`cacheScope` to `McpTool` and `CachedTool`; new `McpCallToolResultMeta`; documented `RequestOptions._meta.protocolVersion`; added `protocolVersion` to `DirectToolSpec` |
| `src/metadata-cache.ts` | Serialization, reconstruction, cache version bump | `CACHE_VERSION = 2`; `serializeTools` persists `ttlMs`/`cacheScope`; `reconstructToolMetadata` restores them to `ToolMetadata` |
| `src/server-manager.ts` | Request options plumbing, tool list capture, legacy warning | `buildRequestOptions(protocolVersion?)`; `getRequestOptions(name, signal, protocolVersion?)`; `fetchAllTools` captures `ttlMs`/`cacheScope` from first page; `connect()` emits legacy fallback warning |
| `src/mcp-probe.ts` | No change (confirm export) | `MODERN_PROTOCOL_VERSION = "2026-07-28"` exported and used in probe strategy |
| `src/proxy-modes.ts` | Thread `protocolVersion`, capture result metadata | `executeCall(..., protocolVersion?)` threads to `getRequestOptions`; captures `resultType` and `serverInfo` from response `_meta` into `ProxyToolResult.details` |
| `src/direct-tools.ts` | `DirectToolSpec.protocolVersion`, executor plumbing | `DirectToolSpec` includes `protocolVersion?`; `createDirectToolExecutor` uses `spec.protocolVersion` for calls; **captures `resultType`/`serverInfo` in `AgentToolResult.details`** |

### Follow-up Flow — 4 Source Files + 4 Test Files

| File | Change Type | Purpose |
| ------ | ------------- | --------- |
| `src/types.ts` | +`McpCallToolResultMeta`, +`DirectToolSpec.protocolVersion` | Shared metadata type; direct tool spec extension |
| `src/server-manager.ts` | Extended `getRequestOptions`/`buildRequestOptions` signatures | 3rd optional `protocolVersion` parameter |
| `src/proxy-modes.ts` | Extended `executeCall` signature + metadata capture | 8th optional `protocolVersion` param; capture logic |
| `src/direct-tools.ts` | Thread `spec.protocolVersion` + metadata capture | Success + error path capture |
| `__tests__/proxy-modes-auto-auth.test.ts` | Mock updates | 3-arg `getRequestOptions` acceptance; assertions updated |
| `__tests__/direct-tools-auto-auth.test.ts` | Mock updates | 3-arg `getRequestOptions`; verify `spec.protocolVersion` |
| `__tests__/mcp-2026-metadata-capture.test.ts` | **New** | 14 unit tests for metadata capture logic |
| `__tests__/mcp-2026-metadata-integration.test.ts` | **New** | 12 integration tests with mocked 2026-07-28 server |

---

## 3. Test Verification Results

### Main Flow

**TypeScript Typecheck:** ✅ PASS — `npx tsc --noEmit` (no errors)

**Core Test Suites Passing:**

| Test Suite | Tests | Status |
| ------------ | ------- | -------- |
| `mcp-probe.test.ts` | 8 | ✅ PASS |
| `server-manager-streamable-http.test.ts` | 4 | ✅ PASS |
| `direct-tools.test.ts` | 52 | ✅ PASS |
| `metadata-cache-instructions.test.ts` | 2 | ✅ PASS |
| `proxy-modes-discovery.test.ts` | 20 | ✅ PASS |

**Pre-existing failures (unrelated):** `config.test.ts` (Agent Plugin servers in env), `server-manager-unix-socket.test.ts` (Windows permissions), `tool-registrar-structured-content.test.ts` (file mode assertion)

**All 14 Acceptance Criteria Met:** ✅

1. Toolbelt Gateway discovers via `server/discover`
2. `tools/list` returns `ttlMs`/`cacheScope`
3. `tools/call` returns `resultType`/`serverInfo`
4. Per-request `protocolVersion` honored
5. Server config fallback for `protocolVersion`
6. No regression on legacy servers
7. Cache persistence round-trips `ttlMs`/`cacheScope`
8. `cacheScope: "global"` survives restart
9. `cacheScope: "session"` respects TTL on restart
10. Direct tools surface result metadata
11. Direct tool spec supports `protocolVersion`
12. Legacy fallback warning emitted
13. `MODERN_PROTOCOL_VERSION` constant reusable
14. Cache version bump invalidates v1 caches

### Follow-up Flow

**TypeScript Typecheck:** ✅ PASS — `npm run typecheck` (no errors)

**Test Results:** ✅ 74 tests passing (all relevant tests)

| Test Suite | Status | Tests | Notes |
| ------------ | -------- | ------- | ------- |
| `proxy-modes-auto-auth.test.ts` | ✅ PASS | 32 | Mocks updated, assertions verify 3rd arg |
| `direct-tools-auto-auth.test.ts` | ✅ PASS | 28 | Mocks updated, assertions verify `spec.protocolVersion` |
| `mcp-2026-metadata-capture.test.ts` | ✅ PASS | 14 | Unit coverage for capture logic |
| `mcp-2026-metadata-integration.test.ts` | ✅ PASS | 12 | Integration with mocked 2026-07-28 server |

**Success Criteria All Met:** ✅

1. Type check passes
2. `executeCall` threads `protocolVersion`
3. `createDirectToolExecutor` threads `spec.protocolVersion`
4. Result metadata surfaced (both paths)
5. Legacy servers produce clean `details`
6. Auto-auth tests pass
7. Integration test passes

---

## 4. Final State of the Implementation

### Combined Capabilities (Both Flows)

| Feature | Proxy Path (`mcp` tool) | Direct Tool Path | Status |
| --------- | ------------------------ | ------------------ | -------- |
| Per-request `protocolVersion` | ✅ `executeCall(..., protocolVersion?)` | ✅ `DirectToolSpec.protocolVersion` | Complete |
| `resultType` in `details` | ✅ Captured from `CallToolResult` | ✅ Captured from `CallToolResult` | Complete |
| `serverInfo` in `details` | ✅ Captured from `_meta.serverInfo` | ✅ Captured from `_meta.serverInfo` | Complete |
| Tool list cache (`ttlMs`, `cacheScope`) | ✅ `fetchAllTools` + cache | ✅ `reconstructToolMetadata` | Complete |
| Legacy fallback warning | ✅ `connect()` logs warning | N/A (connection-level) | Complete |
| Cache version bump (v1→v2) | ✅ `CACHE_VERSION = 2` | ✅ Shared cache | Complete |
| `MODERN_PROTOCOL_VERSION` export | ✅ From `mcp-probe.ts` | ✅ Reused in server-manager | Complete |

### Backward Compatibility

- **All new parameters are optional** — legacy callers work unchanged
- **Legacy servers** — no `_meta`/`resultType` → keys cleanly omitted from `details`
- **Cache migration** — v1 caches ignored automatically; fresh fetch on next connect
- **No breaking changes** to public APIs, config schemas, or transport layer

---

## 5. Known Limitations / Gaps

### Resolved in This Work

| Item | Resolution |
|------|------------|
| Direct tools result metadata capture | ✅ Implemented in follow-up — `createDirectToolExecutor` now captures `resultType` and `serverInfo` in both success and error paths |
| Protocol version threading in direct tools | ✅ Implemented — `spec.protocolVersion` threaded to `getRequestOptions` |

### Remaining (Intentionally Out of Scope)

| Item | Description | Reason |
| ------ | ------------- | -------- |
| `cacheScope: "global"` cross-session sharing | Currently persisted but not actively shared across processes | Requires process coordination; TTL-based expiry handles staleness |
| `resultType`-based behavior (e.g., `resource` → auto-materialize) | Only surfaced in `details`, no transformation | Separate feature; would need UI/agent integration |
| Full `serverInfo` capture (title, instructions) | Only `name`, `version`, `protocolVersion` typed | MCP spec allows more; subset chosen for stability |
| Per-request version mismatch warning | No adapter warning; SDK error surfaces | SDK error is precise; callers should pin only when known supported |

### Pre-existing Test Failures (Unrelated)

- `config.test.ts` — Config discovery/import tests affected by Agent Plugin servers in environment
- `server-manager-unix-socket.test.ts` — Windows permission issues (Unix sockets not supported)
- `tool-registrar-structured-content.test.ts` — File mode assertion flakiness

---

## 6. Archive Metadata

### Main Flow

- **Archive Path:** `openspec/changes/archive/2025-08-20-mcp-2026-protocol-support/`
- **Sync Status:** Synced (canonical specs updated in `openspec/specs/`)
- **Artifact Store:** `openspec`

### Follow-up Flow

- **Archive Path:** `openspec/changes/archive/2025-08-20-mcp-2026-protocol-followup/`
- **Sync Status:** Synced (canonical specs updated in `openspec/specs/`)
- **Artifact Store:** `openspec`

### Traceability

| Artifact | Main Flow | Follow-up Flow |
| ---------- | ----------- | ---------------- |
| Proposal | `openspec/changes/mcp-2026-protocol-support/proposal.md` | `openspec/changes/mcp-2026-protocol-followup/proposal.md` |
| Spec | `openspec/changes/mcp-2026-protocol-support/spec.md` | `openspec/changes/mcp-2026-protocol-followup/spec.md` |
| Design | `openspec/changes/mcp-2026-protocol-support/design.md` | `openspec/changes/mcp-2026-protocol-followup/design.md` |
| Tasks | `openspec/changes/mcp-2026-protocol-support/tasks.md` | `openspec/changes/mcp-2026-protocol-followup/tasks.md` |
| Sync Report | `openspec/changes/mcp-2026-protocol-support/sync.md` | `openspec/changes/mcp-2026-protocol-followup/sync.md` |

---

## 7. Rollback Procedure

If needed, revert these files:

**Main Flow (6 files):**

```
src/types.ts
src/metadata-cache.ts
src/server-manager.ts
src/mcp-probe.ts (no change, verify export)
src/proxy-modes.ts
src/direct-tools.ts
```

**Follow-up Flow (4 source + 4 test files):**

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

**No config migration, database changes, or external dependencies required.** All new fields are optional and additive. Cache version bump means v1 caches are ignored automatically on rollback.

---

## 8. Validation Commands

```bash
# Type check (both flows)
npm run typecheck

# Main flow core tests
npm test -- __tests__/mcp-probe.test.ts
npm test -- __tests__/server-manager-streamable-http.test.ts
npm test -- __tests__/direct-tools.test.ts
npm test -- __tests__/metadata-cache-instructions.test.ts
npm test -- __tests__/proxy-modes-discovery.test.ts

# Follow-up flow tests
npm test -- __tests__/proxy-modes-auto-auth.test.ts
npm test -- __tests__/direct-tools-auto-auth.test.ts
npm test -- __tests__/mcp-2026-metadata-capture.test.ts
npm test -- __tests__/mcp-2026-metadata-integration.test.ts

# Full suite
vitest run
```
