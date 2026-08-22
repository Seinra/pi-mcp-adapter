## Review Workload Forecast

| Field | Value |
| ------- | ------- |
| Estimated changed lines | ~285 across 5 files |
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

## Phase 1: Types Foundation

### T01: Add new interfaces to types.ts

- [ ] Add `McpResourceTemplate`, `ListResourceTemplatesResult`, `McpCompletionArgument`, `McpCompletionContext`, `McpCompletionResult`, `McpProgressNotification` interfaces to `types.ts`
  - **Files**: `src/types.ts`
  - **Verification**: TypeScript compiles; all interfaces constructible with required/optional fields; `McpCompletionContext.type` accepts `"ref/prompt" | "ref/resource" | string`
  - **Dependencies**: None
  <!-- sdd-owner: implementation -->

### T02: Extend McpContent with resource_link and resource types

- [ ] Extend `McpContent` discriminant union to include `type: "resource_link"` and `type: "resource"` with respective fields (`uri`, `name`, `description` for link; `resource: { uri, text?, blob?, mimeType? }` for resource)
  - **Files**: `src/types.ts`
  - **Verification**: TypeScript compiles; `McpContent` values with `type: "resource_link"` and `type: "resource"` type-check; discriminant narrowing works in switch/if on `type`
  - **Dependencies**: T01
  <!-- sdd-owner: implementation -->

### T03: Extend McpCallToolResultMeta with structuredContent, outputSchema, progressToken

- [ ] Add optional `structuredContent?: Record<string, unknown>`, `outputSchema?: Record<string, unknown>`, `progressToken?: string | number` to `McpCallToolResultMeta`
  - **Files**: `src/types.ts`
  - **Verification**: TypeScript compiles; interface accepts all new fields individually and together; existing uses of `McpCallToolResultMeta` continue to compile
  - **Dependencies**: T01
  <!-- sdd-owner: implementation -->

### T04: Extend ServerConnection with resourceTemplates field

- [ ] Add `resourceTemplates: McpResourceTemplate[]` to `ServerConnection` interface (initialized to empty array when no capability)
  - **Files**: `src/types.ts`
  - **Verification**: TypeScript compiles; `ServerConnection` values with `resourceTemplates` type-check; empty array default works
  - **Dependencies**: T01
  <!-- sdd-owner: implementation -->

---

## Phase 2: P0 Fix + Server Manager Core

### T05: Modify buildClientCapabilities(protocolVersion?) to omit sampling for "2026-07-28"

- [ ] Update `buildClientCapabilities` signature to accept `protocolVersion?: string`; omit `sampling` capability when `protocolVersion === "2026-07-28"`; include sampling for other versions when `samplingConfig` exists
  - **Files**: `src/server-manager.ts`
  - **Verification**: Unit test: `buildClientCapabilities("2026-07-28")` returns object without `sampling` key; `buildClientCapabilities("legacy")` returns `sampling: {}` when config present; `buildClientCapabilities(undefined)` includes sampling when config present
  - **Dependencies**: T01, T04
  <!-- sdd-owner: implementation -->

### T06: Update createClient (stdio/Unix) to pass resolved protocolVersion to buildClientCapabilities

- [x] In `createClient`, resolve protocol version from `definition.protocolVersion` ("2026-07-28" → pass version; "legacy" → pass version; "auto"/undefined → pass undefined) and pass to `buildClientCapabilities`
  - **Files**: `src/server-manager.ts`
  - **Verification**: Code inspection shows resolved version passed; TypeScript compiles; no runtime errors on client creation
  - **Dependencies**: T05
  <!-- sdd-owner: implementation -->

### T07: Update connectHttpClient to pass resolved protocolVersion to buildClientCapabilities

- [x] In `connectHttpClient`, apply same version resolution logic as `createClient` and pass to `buildClientCapabilities`
  - **Files**: `src/server-manager.ts`
  - **Verification**: Code inspection shows resolved version passed; HTTP client connections work with correct capabilities
  - **Dependencies**: T05
  <!-- sdd-owner: implementation -->

### T08: Add fetchAllResourceTemplates with pagination and SDK fallback

- [ ] Implement private `fetchAllResourceTemplates(client, requestOptions?)`: loops with `nextCursor`, tries `client.listResourceTemplates()` first, falls back to `client.request({ method: "resources/templates/list" })`, returns combined `McpResourceTemplate[]`
  - **Files**: `src/server-manager.ts`
  - **Verification**: Unit test: pagination across multiple pages returns all templates; empty result when no capability; SDK method called when available; fallback to raw request works
  - **Dependencies**: T01, T04
  <!-- sdd-owner: implementation -->

### T09: Modify createConnection to populate resourceTemplates during connection

- [x] In `createConnection`, add `fetchAllResourceTemplates` to the `Promise.all` for metadata fetching (only when `client.getServerCapabilities?.()?.resources?.templates` is truthy); assign to `connection.resourceTemplates`
  - **Files**: `src/server-manager.ts`
  - **Verification**: Connection to server with templates capability populates `resourceTemplates`; connection without capability has empty array; no regression on existing metadata fetching
  - **Dependencies**: T08
  <!-- sdd-owner: implementation -->

### T10: Add listResourceTemplates(name) public method

- [ ] Implement public `listResourceTemplates(name: string): Promise<McpResourceTemplate[]>`: throws if server not connected; returns `connection.resourceTemplates` (empty array if no capability advertised)
  - **Files**: `src/server-manager.ts`
  - **Verification**: Unit test: returns typed array when connected; throws `Error` when server not connected; returns `[]` when no capability
  - **Dependencies**: T09
  <!-- sdd-owner: implementation -->

### T11: Add complete(name, ref, argument, signal?) method with SDK + fallback

- [ ] Implement public `complete(name, ref, argument, signal?)`: validates connection and completions capability; tries `client.complete()` first, falls back to `client.request({ method: "completions/complete" })`; returns `McpCompletionResult`; throws on missing capability or disconnected
  - **Files**: `src/server-manager.ts`
  - **Verification**: Unit test: returns typed result on success; throws `Error: Server "name" does not support completions` when capability missing; throws when disconnected; SDK + fallback both work
  - **Dependencies**: T01, T04
  <!-- sdd-owner: implementation -->

### T12: Add progressListeners Map and attachProgressNotificationHandler

- [ ] Add private `progressListeners = new Map<string, (notification: McpProgressNotification) => void>()`; implement private `attachProgressNotificationHandler(serverName, client)` that registers `notifications/progress` handler looking up listener by `progressToken` and invoking if found
  - **Files**: `src/server-manager.ts`
  - **Verification**: Handler registered on connection; notification with matching token invokes listener; notification with unknown token dropped silently; no error on handler registration
  - **Dependencies**: T01, T04
  <!-- sdd-owner: implementation -->

### T13: Add registerProgressListener / unregisterProgressListener

- [ ] Implement public `registerProgressListener(progressToken, handler)` and `unregisterProgressListener(progressToken)` methods on `McpServerManager` class
  - **Files**: `src/server-manager.ts`
  - **Verification**: Unit test: listener registered and retrievable by token; unregister removes listener; string/number token normalized to string key
  - **Dependencies**: T12
  <!-- sdd-owner: implementation -->

---

## Phase 3: Proxy Modes

### T14: In executeCall: capture structuredContent, outputSchema, progressToken from CallToolResult

- [x] In `executeCall`, after `callTool` returns, extract `structuredContent`, `outputSchema`, `progressToken` from result (using type assertion for SDK 1.9+ fields) into `resultMeta: McpCallToolResultMeta`
  - **Files**: `src/proxy-modes.ts`
  - **Verification**: Unit test: mock `CallToolResult` with new fields → `resultMeta` populated; legacy result without fields → `resultMeta` has undefined for new fields
  - **Dependencies**: T03
  <!-- sdd-owner: implementation -->

### T15: In executeCall: surface captured fields in ProxyToolResult.details

- [x] Conditionally spread `structuredContent`, `outputSchema`, `progressToken`, `resultType`, `serverInfo` into `details` object when present
  - **Files**: `src/proxy-modes.ts`
  - **Verification**: Unit test: `ProxyToolResult.details` contains all captured fields when present; omits keys when undefined; existing `guardedMcpDetails` still included
  - **Dependencies**: T14
  <!-- sdd-owner: implementation -->

### T16: In executeCall: register one-shot progress listener when progressToken provided

- [x] When `progressToken` parameter provided, build `requestOptions._meta.progressToken`; register listener via `state.manager.registerProgressListener` that calls `state.ui?.notify(message, "progress" | "info")` with formatted progress message
  - **Files**: `src/proxy-modes.ts`
  - **Verification**: Unit test: progressToken in request `_meta`; listener registered before call; notification triggers `ui.notify` with formatted message including progress/total
  - **Dependencies**: T13
  <!-- sdd-owner: implementation -->

### T17: In executeCall: cleanup progress listener in finally block

- [x] Store cleanup function from registration; call it in `finally` block after `callTool` completes (success or error)
  - **Files**: `src/proxy-modes.ts`
  - **Verification**: Unit test: listener removed after successful call; listener removed after error; no listener leak across multiple calls
  - **Dependencies**: T16
  <!-- sdd-owner: implementation -->

### T18: Transform content to include typed resource_link and resource blocks

- [x] Ensure `transformMcpContent` (or inline transformation) produces `McpContent` with proper typing for `resource_link` and `resource` types; verify `details.content` array elements are typed `McpContent`
  - **Files**: `src/proxy-modes.ts`
  - **Verification**: Unit test: tool returning `resource_link` block → `details.content` element has `type: "resource_link"` with `uri`, `name`, `description`; tool returning `resource` block → element has `type: "resource"` with `resource` object
  - **Dependencies**: T02
  <!-- sdd-owner: implementation -->

---

## Phase 4: Direct Tools

### T19: In createDirectToolExecutor: capture structuredContent, outputSchema, progressToken

- [x] In `createDirectToolExecutor`, after `callTool` returns, extract `structuredContent`, `outputSchema`, `progressToken`, `resultType`, `serverInfo` into `resultMeta: McpCallToolResultMeta` (same pattern as proxy)
  - **Files**: `src/direct-tools.ts`
  - **Verification**: Unit test: mock result with new fields → `resultMeta` populated; legacy result → fields undefined
  - **Dependencies**: T03
  <!-- sdd-owner: implementation -->

### T20: In createDirectToolExecutor: surface captured fields in AgentToolResult.details

- [x] Conditionally spread captured metadata fields into `AgentToolResult.details` object (same fields as proxy: `structuredContent`, `outputSchema`, `progressToken`, `resultType`, `serverInfo`)
  - **Files**: `src/direct-tools.ts`
  - **Verification**: Unit test: `AgentToolResult.details` contains all captured fields when present; omits when undefined; existing `guardedMcpDetails` still included
  - **Dependencies**: T19
  <!-- sdd-owner: implementation -->

---

## Phase 5: Metadata Cache (Optional)

### T21: Add CachedResourceTemplate interface

- [ ] Add `CachedResourceTemplate` interface to `metadata-cache.ts` with `uriTemplate`, `name`, `description?`, `mimeType?` fields
  - **Files**: `src/metadata-cache.ts`
  - **Verification**: TypeScript compiles; interface constructible
  - **Dependencies**: T01
  <!-- sdd-owner: implementation -->

### T22: Extend ServerCacheEntry with optional resourceTemplates

- [ ] Add optional `resourceTemplates?: CachedResourceTemplate[]` to `ServerCacheEntry` interface
  - **Files**: `src/metadata-cache.ts`
  - **Verification**: TypeScript compiles; cache entry with/without templates type-checks
  - **Dependencies**: T21
  <!-- sdd-owner: implementation -->

### T23: Update CACHE_VERSION if caching templates

- [ ] If template caching is implemented, bump `CACHE_VERSION` from 1 to 2; update `loadMetadataCache`/`saveMetadataCache` to handle version
  - **Files**: `src/metadata-cache.ts`
  - **Verification**: Unit test: v1 cache file returns `null`; v2 cache loads successfully; `serializeTools`/`reconstructToolMetadata` unchanged
  - **Dependencies**: T22
  <!-- sdd-owner: implementation -->

---

## Phase 6: Documentation

### T24: Update MCP_2026_PARITY_ANALYSIS.md — move P0/P2 to Done, keep P3 as Blocked

- [ ] Update parity analysis document: mark P0 (Sampling removal) and P2 items as Done; P3 items remain Blocked
  - **Files**: `docs/MCP_2026_PARITY_ANALYSIS.md`
  - **Verification**: Document reflects current implementation status; no stale claims
  - **Dependencies**: T05, T10, T11, T18
  <!-- sdd-owner: implementation -->

---

## Phase 7: Tests

### T25: Unit tests for buildClientCapabilities protocolVersion behavior

- [ ] Test cases: `"2026-07-28"` omits sampling; `"legacy"` includes sampling when config exists; `undefined` includes sampling when config exists; no config omits sampling regardless
  - **Files**: `tests/server-manager.test.ts`
  - **Verification**: All test cases pass; TypeScript compiles
  - **Dependencies**: T05
  <!-- sdd-owner: implementation -->

### T26: Unit tests for fetchAllResourceTemplates (pagination, fallback, no capability)

- [ ] Test cases: multi-page pagination returns all templates; single page works; SDK method called when available; fallback to raw request works; empty array when no capability
  - **Files**: `tests/server-manager.test.ts`
  - **Verification**: All test cases pass
  - **Dependencies**: T08
  <!-- sdd-owner: implementation -->

### T27: Unit tests for listResourceTemplates (connected, not connected, no capability)

- [ ] Test cases: returns typed array when connected; throws `Error` when server not connected; returns `[]` when no capability advertised
  - **Files**: `tests/server-manager.test.ts`
  - **Verification**: All test cases pass
  - **Dependencies**: T10
  <!-- sdd-owner: implementation -->

### T28: Unit tests for complete (success, missing capability, disconnected, fallback)

- [ ] Test cases: returns `McpCompletionResult` on success; throws on missing capability; throws on disconnected; SDK method + fallback both tested
  - **Files**: `tests/server-manager.test.ts`
  - **Verification**: All test cases pass
  - **Dependencies**: T11
  <!-- sdd-owner: implementation -->

### T29: Unit tests for progress listeners (register/cleanup, token correlation, Pi notify)

- [ ] Test cases: register/unregister works; token correlation (string/number); notification with matching token invokes handler; unknown token dropped; mocked `ui.notify` called with correct message
  - **Files**: `tests/server-manager.test.ts`
  - **Verification**: All test cases pass
  - **Dependencies**: T12, T13
  <!-- sdd-owner: implementation -->

### T30: Unit tests for executeCall structured content + progress

- [ ] Test cases: `structuredContent`/`outputSchema`/`progressToken` in `details`; progress listener cleanup on success and error; `resource_link`/`resource` content typed; per-request `protocolVersion` threaded
  - **Files**: `tests/proxy-modes.test.ts`
  - **Verification**: All test cases pass
  - **Dependencies**: T14, T15, T16, T17, T18
  <!-- sdd-owner: implementation -->

### T31: Unit tests for createDirectToolExecutor structured content

- [x] Test cases: same capture as proxy (`structuredContent`, `outputSchema`, `progressToken`, `resultType`, `serverInfo` in `details`); `DirectToolSpec.protocolVersion` used in request
  - **Files**: `tests/direct-tools.test.ts`
  - **Verification**: All test cases pass
  - **Dependencies**: T19, T20
  <!-- sdd-owner: implementation -->

### T32: Unit tests for resource_link/resource content typing

- [x] Test cases: `transformMcpContent` produces correct `McpContent` discriminant types for `resource_link` and `resource`; proxy and direct paths both verified
  - **Files**: `tests/proxy-modes.test.ts`, `tests/direct-tools.test.ts`
  - **Verification**: All test cases pass
  - **Dependencies**: T02, T18
  <!-- sdd-owner: implementation -->

### T33: Integration tests for all new features

- [x] Integration test scenarios per design §7.2: P0 fix sampling, structured content proxy/direct, resource templates list/pagination, completions raw, progress notifications surfaced, resource links typed, TypeScript passes, no regression
  - **Files**: `tests/integration.test.ts` (or existing integration test file)
  - **Verification**: All 15 integration scenarios from design §7.2 pass; full test suite passes
  - **Dependencies**: T05, T10, T11, T14, T15, T16, T17, T18, T19, T20
  <!-- sdd-owner: implementation -->

---

## Task Ownership

All implementation tasks above are owned by the implementation agent. Parent/bounded-review tasks (if any) would be added after apply phase.
