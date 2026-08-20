## Review Workload Forecast

| Field | Value |
| ------- | ------- |
| Estimated changed lines | ~170 across 6 files |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | single-pr |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

---

## 1. Type Definitions (`types.ts`)

### 1.1 Extend `McpTool` interface with cache metadata fields

- [ ] Add optional `ttlMs?: number` and `cacheScope?: "session" | "global"` to `McpTool`
  - Acceptance: TypeScript compiles; `McpTool` accepts `ttlMs` and `cacheScope`; existing code using `McpTool` without new fields continues to compile

### 1.2 Extend `CachedTool` interface with cache metadata fields

- [ ] Add optional `ttlMs?: number` and `cacheScope?: "session" | "global"` to `CachedTool`
  - Acceptance: TypeScript compiles; `CachedTool` accepts `ttlMs` and `cacheScope`; serialization/deserialization paths type-check

### 1.3 Add new `McpCallToolResultMeta` interface

- [ ] Define `McpCallToolResultMeta` with optional `resultType` ("data" | "error" | "resource" | "ui") and optional `serverInfo` ({ name?, version?, protocolVersion? })
  - Acceptance: TypeScript compiles; interface constructible with all/none fields; used in proxy-modes.ts and direct-tools.ts without errors

### 1.4 Document `RequestOptions._meta.protocolVersion` usage convention

- [ ] Add JSDoc comment on `RequestOptions` re-export noting `_meta?.protocolVersion?: string` support
  - Acceptance: IDE shows documentation on hover; no type change required (SDK type already permits `_meta: Record<string, unknown>`)

---

## 2. Metadata Cache Updates (`metadata-cache.ts`)

### 2.1 Bump `CACHE_VERSION` from 1 to 2

- [ ] Change `const CACHE_VERSION = 1` to `const CACHE_VERSION = 2`
  - Acceptance: `loadMetadataCache` returns `null` for v1 cache files; new cache files written with version 2

### 2.2 Update `serializeTools` to persist `ttlMs` and `cacheScope`

- [ ] Spread `ttlMs` and `cacheScope` from `McpTool` to `CachedTool` when defined (use conditional spread pattern consistent with existing fields)
  - Acceptance: Tools with `ttlMs`/`cacheScope` serialize with those fields; tools without serialize without them; output matches `CachedTool` type

### 2.3 Update `reconstructToolMetadata` to restore `ttlMs` and `cacheScope`

- [ ] Spread `ttlMs` and `cacheScope` from `CachedTool` to `ToolMetadata` when defined
  - Acceptance: Cached tools with metadata restore to `ToolMetadata` with `ttlMs`/`cacheScope`; missing fields handled gracefully

### 2.4 Verify no changes needed to `isServerCacheValid` or `loadMetadataCache`/`saveMetadataCache` logic

- [ ] Confirm existing TTL/configHash validation handles `cacheScope: "session"` expiry naturally
  - Acceptance: Unit test: session-scoped tools with expired TTL return false from `isServerCacheValid`; global-scoped tools within TTL return true

---

## 3. Server Manager Updates (`server-manager.ts`)

### 3.1 Extend `buildRequestOptions` with optional `protocolVersion` parameter

- [ ] Add `protocolVersion?: string` parameter; include `_meta: { protocolVersion }` in returned `RequestOptions` when provided; merge with existing timeout/signal logic
  - Acceptance: `buildRequestOptions(def, signal, "2026-07-28")` returns `{ signal, timeout, _meta: { protocolVersion: "2026-07-28" } }`; omits `_meta` when `protocolVersion` undefined

### 3.2 Extend `getRequestOptions` with optional `protocolVersion` parameter

- [ ] Add `protocolVersion?: string` parameter; forward to `buildRequestOptions`
  - Acceptance: `getRequestOptions("server", signal, "2026-07-28")` returns request options with `_meta.protocolVersion`; callers in proxy-modes.ts and direct-tools.ts type-check

### 3.3 Update `fetchAllTools` to capture `ttlMs` and `cacheScope` from first page

- [ ] Declare `pageTtlMs` and `pageCacheScope` outside loop; capture from first page result only; spread into each tool object
  - Acceptance: Multi-page tool list: all tools get first page's `ttlMs`/`cacheScope`; legacy server (no metadata) produces tools without new fields; no TypeScript errors

### 3.4 Add legacy fallback warning in `connect()`

- [ ] After connection established, check negotiated protocol version; if legacy ("legacy" or "2025-06-18"), log warning via `logger.warn` with server name and message about unavailable modern features
  - Acceptance: Connecting to legacy-configured server emits warning; connecting to modern server does not; warning message matches spec exactly

---

## 4. MCP Probe (`mcp-probe.ts`)

### 4.1 Verify `MODERN_PROTOCOL_VERSION` export

- [ ] Confirm `export const MODERN_PROTOCOL_VERSION = "2026-07-28"` exists and is importable
  - Acceptance: `import { MODERN_PROTOCOL_VERSION } from "./mcp-probe"` resolves to `"2026-07-28"`; used in server-manager.ts for version resolution

---

## 5. Proxy Modes Updates (`proxy-modes.ts`)

### 5.1 Extend `executeCall` signature with optional `protocolVersion` parameter

- [ ] Add `protocolVersion?: string` as last parameter; pass to `state.manager.getRequestOptions(serverName, ownedSignal, protocolVersion)`
  - Acceptance: Callers can pass `protocolVersion`; TypeScript compiles; existing callers without parameter continue working

### 5.2 Capture `resultType` and `serverInfo` from `CallToolResult`

- [ ] Create `resultMeta: McpCallToolResultMeta = {}`; populate from `result.resultType` and `result._meta?.serverInfo` using optional chaining
  - Acceptance: Modern server response populates both fields; legacy server response (no metadata) produces empty `resultMeta`

### 5.3 Include result metadata in `ProxyToolResult.details`

- [ ] Conditionally spread `resultType` and `serverInfo` into `details` object when present
  - Acceptance: Proxy tool result `details` contains `resultType` and `serverInfo` for 2026-07-28 servers; omits keys for legacy servers

---

## 6. Direct Tools Updates (`direct-tools.ts`)

### 6.1 Extend `DirectToolSpec` with optional `protocolVersion` field

- [ ] Add `protocolVersion?: string` to interface
  - Acceptance: `DirectToolSpec` accepts `protocolVersion`; registration code type-checks

### 6.2 Update `createDirectToolExecutor` to use `spec.protocolVersion`

- [ ] Pass `spec.protocolVersion` to `state.manager.getRequestOptions(spec.serverName, ownedSignal, spec.protocolVersion)`
  - Acceptance: Direct tool with `protocolVersion` in spec sends `_meta.protocolVersion` in call; without spec field sends nothing

### 6.3 Capture `resultType` and `serverInfo` in direct tool executor

- [ ] Same pattern as proxy-modes.ts: create `resultMeta`, populate from response, conditionally include in `AgentToolResult.details`
  - Acceptance: Direct tool invocation returns `details` with `resultType`/`serverInfo` for modern servers; clean `details` for legacy

---

## 7. Unit Tests

### 7.1 Types tests (`types.test.ts`)

- [ ] `McpTool` accepts `ttlMs` and `cacheScope` fields
  - Acceptance: `const tool: McpTool = { name: "t", ttlMs: 300000, cacheScope: "global" }` compiles
- [ ] `CachedTool` accepts `ttlMs` and `cacheScope` fields
  - Acceptance: `const cached: CachedTool = { name: "t", ttlMs: 300000, cacheScope: "session" }` compiles
- [ ] `McpCallToolResultMeta` constructs with all/none fields
  - Acceptance: `const meta: McpCallToolResultMeta = { resultType: "data", serverInfo: { name: "s", version: "1.0", protocolVersion: "2026-07-28" } }` compiles; empty object compiles

### 7.2 Metadata cache tests (`metadata-cache.test.ts`)

- [ ] `serializeTools` includes `ttlMs`/`cacheScope` when present
  - Acceptance: Input `[{ name: "t", ttlMs: 300000, cacheScope: "global" }]` → output includes both fields
- [ ] `serializeTools` omits `ttlMs`/`cacheScope` when undefined
  - Acceptance: Input `[{ name: "t" }]` → output has no `ttlMs`/`cacheScope` keys
- [ ] `reconstructToolMetadata` restores `ttlMs`/`cacheScope` to `ToolMetadata`
  - Acceptance: Cached entry with fields → metadata array includes them
- [ ] `CACHE_VERSION = 2` invalidates v1 cache
  - Acceptance: `loadMetadataCache` with v1 fixture returns `null`; v2 fixture loads successfully

### 7.3 Server manager tests (`server-manager.test.ts`)

- [ ] `buildRequestOptions` returns `_meta.protocolVersion` when provided
  - Acceptance: Call with `"2026-07-28"` → `_meta: { protocolVersion: "2026-07-28" }`
- [ ] `buildRequestOptions` omits `_meta` when `protocolVersion` undefined
  - Acceptance: Call without version → no `_meta` key (unless timeout/signal require options object)
- [ ] `getRequestOptions` forwards `protocolVersion` to `buildRequestOptions`
  - Acceptance: Spy on `buildRequestOptions`; verify third argument passed through
- [ ] `fetchAllTools` captures `ttlMs`/`cacheScope` from first page only
  - Acceptance: Mock client returns page 1 with `ttlMs: 300000, cacheScope: "global"`, page 2 without; all tools have metadata
- [ ] `fetchAllTools` handles legacy server (no metadata)
  - Acceptance: Mock returns no `ttlMs`/`cacheScope` → tools array has no new fields
- [ ] `connect()` logs warning for legacy fallback
  - Acceptance: Mock SDK returns legacy negotiated version; `logger.warn` called with expected message

### 7.4 Proxy modes tests (`proxy-modes.test.ts`)

- [ ] `executeCall` threads `protocolVersion` to `getRequestOptions`
  - Acceptance: Spy on `getRequestOptions`; verify `protocolVersion` argument passed
- [ ] `executeCall` captures `resultType` and `serverInfo` from response
  - Acceptance: Mock `CallToolResult` with metadata → `result.details` contains both
- [ ] `executeCall` handles legacy response (no metadata)
  - Acceptance: Mock standard `CallToolResult` → `details` has no `resultType`/`serverInfo` keys

### 7.5 Direct tools tests (`direct-tools.test.ts`)

- [ ] `DirectToolSpec` accepts `protocolVersion`
  - Acceptance: Spec with `protocolVersion: "2026-07-28"` compiles
- [ ] `createDirectToolExecutor` uses `spec.protocolVersion` for calls
  - Acceptance: Spy on `getRequestOptions`; verify spec's `protocolVersion` passed
- [ ] Direct tool executor captures result metadata in `details`
  - Acceptance: Mock modern response → `AgentToolResult.details` has `resultType`/`serverInfo`

### 7.6 MCP probe tests (`mcp-probe.test.ts`)

- [ ] `MODERN_PROTOCOL_VERSION` equals `"2026-07-28"`
  - Acceptance: `expect(MODERN_PROTOCOL_VERSION).toBe("2026-07-28")`

---

## 8. Integration Tests

### 8.1 Gateway discovery test

- [ ] `probeMcpEndpoint` against HTTP endpoint with `server/discover` returns classification containing "2026-07-28 server/discover"
  - Acceptance: Integration test against test gateway; assertion on `classification` string

### 8.2 Tool list cache metadata integration

- [ ] Connect to 2026-07-28 test server; verify `manager.getConnection(name).tools[0].ttlMs` and `.cacheScope` populated
  - Acceptance: Live server connection; tools array has expected metadata fields

### 8.3 Tool call result metadata integration

- [ ] Execute `mcp({ tool: "test", protocolVersion: "2026-07-28" })`; verify result `details` has `resultType` and `serverInfo`
  - Acceptance: Proxy tool invocation; `details` object contains both fields with expected structure

### 8.4 Per-request protocol version honored

- [ ] Configure server `protocolVersion: "auto"`; call with explicit `protocolVersion: "2026-07-28"`; verify SDK request includes `_meta.protocolVersion`
  - Acceptance: Intercept or log SDK call; verify `_meta.protocolVersion: "2026-07-28"`

### 8.5 Server config fallback for protocol version

- [ ] Configure server `protocolVersion: "2026-07-28"`; call without explicit version; verify SDK request includes `_meta.protocolVersion: "2026-07-28"`
  - Acceptance: Same interception; version from config used

### 8.6 Legacy server no regression

- [ ] Configure server `protocolVersion: "legacy"`; connect and call tool; verify works without `_meta.protocolVersion`; warning logged
  - Acceptance: Connection succeeds; tool call succeeds; no `_meta.protocolVersion` in request; warning in logs

### 8.7 Cache persistence round-trip

- [ ] Connect to 2026-07-28 server; restart adapter; verify cached tools have `ttlMs`/`cacheScope` intact
  - Acceptance: Process restart; `loadMetadataCache` returns v2 cache; tools have metadata

### 8.8 Global scope survives restart

- [ ] Cache tools with `cacheScope: "global"`, valid hash, within TTL; restart; verify `loadMetadataCache` returns tools with `cacheScope: "global"`
  - Acceptance: Cache file written with global scope; fresh load preserves it

### 8.9 Session scope respects TTL on restart

- [ ] Cache tools with `cacheScope: "session"`, `ttlMs: 1000`; wait >1s; restart; verify `isServerCacheValid` returns false
  - Acceptance: Age > TTL; validation fails; fresh `tools/list` triggered on connect

### 8.10 Direct tools surface metadata

- [ ] Register direct tool for 2026-07-28 server; invoke via agent; verify result `details` has `resultType`/`serverInfo`
  - Acceptance: Direct tool execution; `AgentToolResult.details` populated

### 8.11 Direct tool spec protocolVersion

- [ ] Create `DirectToolSpec` with `protocolVersion: "2026-07-28"`; verify executor uses it
  - Acceptance: Spy on `getRequestOptions`; spec's protocolVersion passed through

### 8.12 Legacy fallback warning integration

- [ ] Configure server `protocolVersion: "legacy"`; connect; verify log contains legacy warning
  - Acceptance: `logger.warn` captured with exact message from spec

### 8.13 Constant reusability

- [ ] Import `MODERN_PROTOCOL_VERSION` from `mcp-probe` in another module; verify value
  - Acceptance: Cross-module import resolves to `"2026-07-28"`

### 8.14 Cache version bump invalidates v1 caches

- [ ] Place v1 cache fixture file; start adapter; verify `loadMetadataCache()` returns `null`
  - Acceptance: Version mismatch detected; cache ignored; fresh fetch on connect

---

## 9. Verification & Documentation

### 9.1 Run full test suite

- [ ] Execute all unit and integration tests; verify 100% pass
  - Acceptance: `npm test` (or project test command) exits with 0; no regressions

### 9.2 Manual smoke test with real 2026-07-28 server

- [ ] Connect to real MCP 2026-07-28 server; exercise proxy tool, direct tool, cache persistence
  - Acceptance: All features work end-to-end; no console errors

### 9.3 Update CHANGELOG/release notes

- [ ] Document new features: per-request protocol version, cache metadata, result metadata, cache version bump
  - Acceptance: CHANGELOG.md updated with user-visible changes; migration note for cache version bump

---

## Task Ownership

All implementation tasks above are owned by the implementation agent. Parent/bounded-review tasks (if any) would be added after apply phase.
