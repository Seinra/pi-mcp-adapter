# Delta for MCP 2026-07-28 Protocol Support

## ADDED Requirements

### Requirement: Per-Request Protocol Version on Tool Calls

The system MUST allow callers to specify an MCP protocol version per tool call via an explicit `protocolVersion` argument, falling back to the server's configured `protocolVersion` when not provided.

#### Scenario: Explicit per-request protocol version via proxy tool

- GIVEN a connected MCP server with `protocolVersion: "auto"`
- WHEN the caller invokes `mcp({ tool: "example", args: {}, protocolVersion: "2026-07-28" })`
- THEN the SDK `callTool` request includes `_meta: { protocolVersion: "2026-07-28" }`
- AND the result `details` includes the response `resultType` and `serverInfo` when present

#### Scenario: Per-request protocol version via direct tool executor

- GIVEN a direct tool registered for an MCP server
- WHEN the direct tool is invoked with `protocolVersion: "2026-07-28"` in the call metadata
- THEN the SDK `callTool` request includes `_meta: { protocolVersion: "2026-07-28" }`
- AND the result `details` includes the response `resultType` and `serverInfo` when present

#### Scenario: Server config fallback when per-request version omitted

- GIVEN a server configured with `protocolVersion: "2026-07-28"`
- WHEN a tool call is made without an explicit `protocolVersion` argument
- THEN the SDK `callTool` request includes `_meta: { protocolVersion: "2026-07-28" }` from server config

#### Scenario: Legacy server config does not inject protocol version

- GIVEN a server configured with `protocolVersion: "legacy"` (or undefined)
- WHEN a tool call is made without an explicit `protocolVersion` argument
- THEN the SDK `callTool` request does NOT include `_meta.protocolVersion`

---

### Requirement: Tool List Cache Metadata (ttlMs, cacheScope)

The system MUST capture `ttlMs` and `cacheScope` from `tools/list` responses and persist them per tool.

#### Scenario: Tool list refresh captures cache metadata

- GIVEN a 2026-07-28 MCP server that returns `ttlMs: 300000, cacheScope: "global"` in `tools/list`
- WHEN `fetchAllTools` completes (initial connect or keep-alive refresh)
- THEN each `McpTool` in `ServerConnection.tools` has `ttlMs: 300000` and `cacheScope: "global"`

#### Scenario: Cache scope "global" persists to disk for cross-session sharing

- GIVEN tools with `cacheScope: "global"` and `ttlMs: 300000`
- WHEN `serializeTools` runs during `saveMetadataCache`
- THEN the cached `CachedTool` entries include `ttlMs` and `cacheScope: "global"`
- AND the cache file is written to disk (survives process restart)

#### Scenario: Cache scope "session" persists only in memory for current session

- GIVEN tools with `cacheScope: "session"` and `ttlMs: 60000`
- WHEN `serializeTools` runs during `saveMetadataCache`
- THEN the cached `CachedTool` entries include `ttlMs` and `cacheScope: "session"`
- AND the cache file is written to disk (survives process restart)
- BUT a subsequent fresh process load treats `session`-scoped tools as stale for metadata purposes unless re-validated by `isServerCacheValid`

#### Scenario: Tools without cache metadata serialize without those fields

- GIVEN a legacy server that does not return `ttlMs` or `cacheScope`
- WHEN `serializeTools` runs
- THEN the cached `CachedTool` entries omit `ttlMs` and `cacheScope`

---

### Requirement: Tool Call Result Metadata (resultType, serverInfo)

The system MUST surface `resultType` and `_meta.serverInfo` from `tools/call` responses in the tool result `details`.

#### Scenario: Proxy tool call surfaces result metadata

- GIVEN a 2026-07-28 server returning `resultType: "data"` and `_meta: { serverInfo: { name: "example", version: "1.0", protocolVersion: "2026-07-28" } }`
- WHEN `executeCall` completes a tool invocation
- THEN the `ProxyToolResult.details` includes `resultType: "data"` and `serverInfo: { name: "example", version: "1.0", protocolVersion: "2026-07-28" }`

#### Scenario: Direct tool call surfaces result metadata

- GIVEN a 2026-07-28 server returning `resultType: "resource"` and `_meta.serverInfo`
- WHEN a direct tool executes via `createDirectToolExecutor`
- THEN the `AgentToolResult.details` includes `resultType` and `serverInfo`

#### Scenario: Legacy server responses do not add unexpected fields

- GIVEN a legacy server returning a standard `CallToolResult` without `_meta.serverInfo` or `resultType`
- WHEN a tool call completes
- THEN the result `details` does not contain `resultType` or `serverInfo` keys

---

### Requirement: Modern Protocol Version Constant Export

The system MUST export `MODERN_PROTOCOL_VERSION` from `mcp-probe.ts` for reuse across the codebase.

#### Scenario: Constant available for import

- GIVEN any module importing from `mcp-probe.ts`
- WHEN it references `MODERN_PROTOCOL_VERSION`
- THEN the value is `"2026-07-28"`

---

### Requirement: Version Mismatch Handling with Warning

The system MUST prefer the modern SDK (2026-07-28) as primary, fall back to legacy when explicitly configured, and emit a Pi warning when legacy fallback occurs.

#### Scenario: Connection with protocolVersion "auto" uses modern first

- GIVEN a server configured with `protocolVersion: "auto"`
- WHEN connecting via HTTP transport
- THEN the SDK attempts modern protocol version negotiation
- AND if the server rejects modern, the SDK falls back to legacy per its own logic

#### Scenario: Connection with protocolVersion "2026-07-28" pins to modern

- GIVEN a server configured with `protocolVersion: "2026-07-28"`
- WHEN connecting via HTTP transport
- THEN the SDK pins to `2026-07-28` with no legacy fallback

#### Scenario: Legacy fallback emits Pi warning

- GIVEN a server configured with `protocolVersion: "legacy"` or legacy-only server encountered during `auto` negotiation
- WHEN the connection uses legacy protocol
- THEN a warning is logged: `"MCP server '<name>' is using legacy protocol (pre-2026-07-28). Modern features (cache metadata, per-request version, result metadata) are unavailable."`

---

### Requirement: Request Options Plumbing for Per-Request Protocol Version

The system MUST provide `buildRequestOptions` accepting an optional `protocolVersion` parameter and `getRequestOptions` exposing it for callers.

#### Scenario: buildRequestOptions includes protocolVersion in _meta

- GIVEN `buildRequestOptions(definition, signal, "2026-07-28")`
- WHEN called
- THEN returns `RequestOptions` with `_meta: { protocolVersion: "2026-07-28" }` merged with timeout/signal

#### Scenario: getRequestOptions exposes request options builder

- GIVEN a connected server
- WHEN `getRequestOptions(name, signal, protocolVersion?)` is called
- THEN returns `RequestOptions` with `_meta.protocolVersion` when provided

---

## MODIFIED Requirements

### Requirement: McpTool Type Extension

The `McpTool` interface MUST include optional `ttlMs` and `cacheScope` fields.

```typescript
export interface McpTool {
  name: SdkTool["name"];
  title?: SdkTool["title"];
  description?: SdkTool["description"];
  inputSchema?: SdkTool["inputSchema"];
  _meta?: SdkTool["_meta"];
  ttlMs?: number;                    // NEW
  cacheScope?: "session" | "global"; // NEW
}
```

(Previously: `McpTool` had only `name`, `title`, `description`, `inputSchema`, `_meta`)

#### Scenario: Tool with cache metadata from modern server

- GIVEN a `ListToolsResult` item with `ttlMs: 300000, cacheScope: "global"`
- WHEN mapped to `McpTool`
- THEN the resulting object includes `ttlMs: 300000` and `cacheScope: "global"`

---

### Requirement: CachedTool Type Extension

The `CachedTool` interface MUST include optional `ttlMs` and `cacheScope` fields for persistence.

```typescript
export interface CachedTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
  uiResourceUri?: string;
  uiVisibility?: UiToolVisibility[];
  uiStreamMode?: "eager" | "stream-first";
  ttlMs?: number;                    // NEW
  cacheScope?: "session" | "global"; // NEW
}
```

(Previously: `CachedTool` had only `name`, `description`, `inputSchema`, `uiResourceUri`, `uiVisibility`, `uiStreamMode`)

#### Scenario: Persisted tool retains cache metadata

- GIVEN a `McpTool` with `ttlMs: 300000, cacheScope: "global"`
- WHEN `serializeTools` runs
- THEN the `CachedTool` includes `ttlMs: 300000, cacheScope: "global"`

---

### Requirement: McpCallToolResultMeta Type Added

A new `McpCallToolResultMeta` interface MUST be defined to type tool call result metadata.

```typescript
export interface McpCallToolResultMeta {
  resultType?: "data" | "error" | "resource" | "ui";
  serverInfo?: {
    name?: string;
    version?: string;
    protocolVersion?: string;
  };
}
```

#### Scenario: Result metadata captured from SDK response

- GIVEN an SDK `CallToolResult` with `resultType: "data"` and `_meta: { serverInfo: { name: "srv", version: "1.0", protocolVersion: "2026-07-28" } }`
- WHEN the result is processed
- THEN `McpCallToolResultMeta` is populated with `resultType: "data"` and `serverInfo`

---

### Requirement: RequestOptions Extension for _meta.protocolVersion

The `RequestOptions` type (re-exported from SDK) MUST be documented as supporting `_meta.protocolVersion` for per-request version pinning. No local type change required; this is a usage convention.

#### Scenario: Per-request protocol version in request options

- GIVEN `RequestOptions` built with `_meta: { protocolVersion: "2026-07-28" }`
- WHEN passed to `client.callTool`
- THEN the SDK includes the version in the outbound request `_meta`

---

### Requirement: fetchAllTools Captures Cache Metadata

The `fetchAllTools` method in `McpServerManager` MUST capture `ttlMs` and `cacheScope` from each tool in the `ListToolsResult` pages.

```typescript
private async fetchAllTools(client: Client, requestOptions?: CacheableRequestOptions): Promise<McpTool[]> {
  const allTools: McpTool[] = [];
  let cursor: string | undefined;

  do {
    const result = await client.listTools(cursor ? { cursor } : undefined, requestOptions);
    // NEW: Capture ttlMs and cacheScope from result if present
    const pageTtlMs = (result as ListToolsResult & { ttlMs?: number }).ttlMs;
    const pageCacheScope = (result as ListToolsResult & { cacheScope?: "session" | "global" }).cacheScope;
    for (const tool of result.tools ?? []) {
      allTools.push({
        ...tool,
        ...(pageTtlMs !== undefined ? { ttlMs: pageTtlMs } : {}),
        ...(pageCacheScope !== undefined ? { cacheScope: pageCacheScope } : {}),
      });
    }
    cursor = result.nextCursor;
  } while (cursor);

  return allTools;
}
```

(Previously: `fetchAllTools` returned raw SDK tools without cache metadata)

#### Scenario: Multi-page tool list with cache metadata on first page

- GIVEN a server returning paginated `tools/list` with `ttlMs`/`cacheScope` on the first page only
- WHEN `fetchAllTools` iterates all pages
- THEN all tools receive the `ttlMs` and `cacheScope` from the first page

---

### Requirement: buildRequestOptions Accepts Per-Request protocolVersion

The `buildRequestOptions` method MUST accept an optional third parameter `protocolVersion` and include it in `_meta`.

```typescript
private buildRequestOptions(
  definition?: ServerDefinition,
  signal?: AbortSignal,
  protocolVersion?: string, // NEW
): RequestOptions | undefined {
  const timeout = this.getResolvedRequestTimeoutMs(definition);
  const ownedSignal = combineAbortSignals(this.runtimeSignal, signal);

  if (!ownedSignal && timeout === undefined && !protocolVersion) {
    return undefined;
  }

  return {
    ...(ownedSignal ? { signal: ownedSignal } : {}),
    ...(timeout !== undefined ? { timeout } : {}),
    ...(protocolVersion ? { _meta: { protocolVersion } } : {}),
  };
}
```

(Previously: `buildRequestOptions` only handled timeout and signal)

#### Scenario: Request options with protocol version

- GIVEN `buildRequestOptions(definition, signal, "2026-07-28")`
- WHEN called
- THEN returns `{ signal, timeout, _meta: { protocolVersion: "2026-07-28" } }`

---

### Requirement: getRequestOptions Exposes Per-Request Protocol Version

The public `getRequestOptions` method MUST accept and forward an optional `protocolVersion`.

```typescript
getRequestOptions(name: string, signal?: AbortSignal, protocolVersion?: string): RequestOptions | undefined {
  const connection = this.connections.get(name);
  return this.buildRequestOptions(connection?.definition, signal, protocolVersion);
}
```

(Previously: `getRequestOptions(name, signal)` only)

#### Scenario: Proxy/direct callers request options with protocol version

- GIVEN a connected server `"example"`
- WHEN `getRequestOptions("example", signal, "2026-07-28")` is called
- THEN returns request options with `_meta.protocolVersion: "2026-07-28"`

---

### Requirement: executeCall Threads protocolVersion and Captures Result Metadata

The `executeCall` function in `proxy-modes.ts` MUST:

- Accept optional `protocolVersion` in call args
- Pass it via `requestOptions._meta.protocolVersion` to `callTool`
- Capture `resultType` and `serverInfo` from response `_meta`
- Include them in `ProxyToolResult.details`

```typescript
export async function executeCall(
  state: McpExtensionState,
  toolName: string,
  args?: Record<string, unknown>,
  serverOverride?: string,
  getPiTools?: () => ToolInfo[],
  signal?: AbortSignal,
  origin?: "proxy" | "script",
  protocolVersion?: string, // NEW
): Promise<ProxyToolResult> {
  // ... existing logic ...
  
  const requestOptions = state.manager.getRequestOptions(serverName, ownedSignal, protocolVersion);
  
  const result = await withSessionRecovery<ClientCallToolResult>(
    // ...
    (conn) => abortable(conn.client.callTool({
      name: toolMeta.originalName,
      arguments: normalizedArgs,
      _meta: uiSession?.requestMeta,
    }, requestOptions), ownedSignal),
  );
  
  // NEW: Capture result metadata
  const resultMeta: McpCallToolResultMeta = {};
  if (result.resultType) resultMeta.resultType = result.resultType;
  if (result._meta?.serverInfo) resultMeta.serverInfo = result._meta.serverInfo;
  
  // Include in details
  const details = {
    server: serverName,
    tool: toolMeta.originalName,
    ...(resultMeta.resultType ? { resultType: resultMeta.resultType } : {}),
    ...(resultMeta.serverInfo ? { serverInfo: resultMeta.serverInfo } : {}),
    ...guardedMcpDetails(guarded),
  };
}
```

(Previously: `executeCall` did not accept `protocolVersion` and did not surface `resultType`/`serverInfo`)

#### Scenario: Proxy call with explicit protocol version

- GIVEN `executeCall(state, "tool", args, "server", ..., ..., "2026-07-28")`
- WHEN the tool executes
- THEN the SDK call includes `_meta.protocolVersion: "2026-07-28"`
- AND the result `details` includes `resultType` and `serverInfo` when present

---

### Requirement: createDirectToolExecutor Threads protocolVersion and Captures Result Metadata

The `createDirectToolExecutor` function in `direct-tools.ts` MUST:

- Accept `protocolVersion` from the direct tool spec or call context
- Pass it via `requestOptions._meta.protocolVersion` to `callTool`
- Capture `resultType` and `serverInfo` from response
- Include them in `AgentToolResult.details`

```typescript
export function createDirectToolExecutor(
  getState: () => McpExtensionState | null,
  getInitPromise: () => Promise<McpExtensionState> | null,
  spec: DirectToolSpec
): DirectToolExecute {
  return async function execute(_toolCallId, params, signal) {
    // ... existing logic ...
    
    const requestOptions = state.manager.getRequestOptions(spec.serverName, ownedSignal, spec.protocolVersion);
    
    const result = await withSessionRecovery<ClientCallToolResult>(
      // ...
      (conn) => abortable(conn.client.callTool({
        name: spec.originalName,
        arguments: normalizedParams,
        _meta: uiSession?.requestMeta,
      }, requestOptions), ownedSignal),
    );
    
    // NEW: Capture result metadata
    const resultMeta: McpCallToolResultMeta = {};
    if (result.resultType) resultMeta.resultType = result.resultType;
    if (result._meta?.serverInfo) resultMeta.serverInfo = result._meta.serverInfo;
    
    const details = {
      server: spec.serverName,
      tool: spec.originalName,
      ...(resultMeta.resultType ? { resultType: resultMeta.resultType } : {}),
      ...(resultMeta.serverInfo ? { serverInfo: resultMeta.serverInfo } : {}),
      ...guardedMcpDetails(guarded),
    };
  };
}
```

(Previously: `createDirectToolExecutor` did not pass `protocolVersion` or capture `resultType`/`serverInfo`)

#### Scenario: Direct tool with protocol version from spec

- GIVEN a `DirectToolSpec` with `protocolVersion: "2026-07-28"` (new optional field)
- WHEN the direct tool executes
- THEN the SDK call includes `_meta.protocolVersion: "2026-07-28"`
- AND the result `details` includes `resultType` and `serverInfo` when present

---

### Requirement: serializeTools Handles ttlMs and cacheScope

The `serializeTools` function in `metadata-cache.ts` MUST persist `ttlMs` and `cacheScope` from `McpTool` to `CachedTool`.

```typescript
export function serializeTools(tools: McpTool[]): CachedTool[] {
  return tools
    .filter(t => t?.name)
    .map(t => {
      const uiResourceUri = tryGetToolUiResourceUri(t);
      const uiVisibility = extractUiToolVisibility(t._meta);
      const uiStreamMode = extractToolUiStreamMode(t._meta);
      return {
        name: t.name,
        ...(t.description !== undefined ? { description: t.description } : {}),
        ...(t.inputSchema !== undefined ? { inputSchema: t.inputSchema } : {}),
        ...(uiResourceUri !== undefined ? { uiResourceUri } : {}),
        ...(uiVisibility !== undefined ? { uiVisibility } : {}),
        ...(uiStreamMode !== undefined ? { uiStreamMode } : {}),
        ...(t.ttlMs !== undefined ? { ttlMs: t.ttlMs } : {}),           // NEW
        ...(t.cacheScope !== undefined ? { cacheScope: t.cacheScope } : {}), // NEW
      };
    });
}
```

(Previously: `serializeTools` did not include `ttlMs` or `cacheScope`)

#### Scenario: Tools with cache metadata serialize correctly

- GIVEN `McpTool[]` with mixed `ttlMs`/`cacheScope` values
- WHEN `serializeTools` runs
- THEN each `CachedTool` preserves the cache metadata fields

---

### Requirement: reconstructToolMetadata Restores Cache Metadata

The `reconstructToolMetadata` function MUST restore `ttlMs` and `cacheScope` from `CachedTool` to `ToolMetadata` for runtime use (e.g., cache invalidation logic).

```typescript
export function reconstructToolMetadata(
  serverName: string,
  entry: ServerCacheEntry,
  prefix: ToolPrefix,
  definition: Pick<ServerEntry, "exposeResources" | "includeTools" | "excludeTools" | "toolPrefix">,
  configuredServers?: Record<string, ServerEntry>,
  cache?: MetadataCache,
): ToolMetadata[] {
  // ... existing logic ...
  
  for (const tool of entry.tools ?? []) {
    // ...
    metadata.push({
      name,
      originalName: tool.name,
      description: tool.description ?? "",
      ...(tool.inputSchema !== undefined ? { inputSchema: tool.inputSchema } : {}),
      ...(tool.uiResourceUri !== undefined ? { uiResourceUri: tool.uiResourceUri } : {}),
      ...(tool.uiVisibility !== undefined ? { uiVisibility: tool.uiVisibility } : {}),
      ...(tool.uiStreamMode !== undefined ? { uiStreamMode: tool.uiStreamMode } : {}),
      ...(tool.ttlMs !== undefined ? { ttlMs: tool.ttlMs } : {}),           // NEW
      ...(tool.cacheScope !== undefined ? { cacheScope: tool.cacheScope } : {}), // NEW
    });
  }
  // ...
}
```

(Previously: `reconstructToolMetadata` did not restore `ttlMs` or `cacheScope`)

#### Scenario: Cached tool metadata restored with cache fields

- GIVEN a `ServerCacheEntry` with tools containing `ttlMs`/`cacheScope`
- WHEN `reconstructToolMetadata` runs
- THEN the returned `ToolMetadata[]` includes `ttlMs` and `cacheScope` per tool

---

### Requirement: Cache Persistence Logic for Global vs Session Scope

The `saveMetadataCache` and `loadMetadataCache` functions MUST handle `cacheScope` semantics:

- `cacheScope: "global"`: Tools are fully persistent across sessions (current behavior, no change)
- `cacheScope: "session"`: Tools persist to disk but are treated as metadata-stale on fresh load unless `isServerCacheValid` passes (TTL-based invalidation handles expiry)

```typescript
// isServerCacheValid already validates configHash and maxAgeMs
// For session-scoped tools, the cache file persists but tools are refreshed
// on next connect because TTL expires or configHash validation ensures freshness.
// No code change needed beyond field persistence; TTL expiration handles it.
```

#### Scenario: Global-scoped tools available after restart

- GIVEN cache file with `cacheScope: "global"` tools, valid `configHash`, within `ttlMs`
- WHEN new process loads cache via `loadMetadataCache`
- THEN tools are available immediately without reconnect

#### Scenario: Session-scoped tools refreshed after restart

- GIVEN cache file with `cacheScope: "session"` tools, valid `configHash`, but TTL expired or near expiry
- WHEN new process loads cache
- THEN `isServerCacheValid` returns false (age > TTL), triggering fresh `tools/list` on connect

---

### Requirement: MODERN_PROTOCOL_VERSION Exported from mcp-probe.ts

The constant `MODERN_PROTOCOL_VERSION` is already exported from `mcp-probe.ts`. This requirement confirms its availability for reuse.

```typescript
// Already present in mcp-probe.ts:
export const MODERN_PROTOCOL_VERSION = "2026-07-28";
```

#### Scenario: Other modules import the constant

- GIVEN `server-manager.ts` imports `MODERN_PROTOCOL_VERSION` from `mcp-probe.ts`
- WHEN used in `resolveVersionNegotiation` or logging
- THEN the value is `"2026-07-28"` without drift

---

## REMOVED Requirements

None. All changes are additive.

---

## Migration Notes

### Cache Version Bump

The `CACHE_VERSION` constant in `metadata-cache.ts` MUST be incremented from `1` to `2` to invalidate existing caches and force a clean migration.

```typescript
// metadata-cache.ts
const CACHE_VERSION = 2; // was 1
```

#### Migration Behavior

- **Old cache files (version 1)**: `loadMetadataCache` returns `null` due to version mismatch. All servers will re-fetch tool lists on next connect.
- **New cache files (version 2)**: Include `ttlMs` and `cacheScope` per tool. `isServerCacheValid` continues to validate `configHash` and `maxAgeMs`.
- **No data migration needed**: The new fields are optional. Legacy tools without `ttlMs`/`cacheScope` serialize and deserialize correctly.

#### Verification

- After version bump, start adapter with existing v1 cache file → cache is ignored, tools re-fetched
- Connect to 2026-07-28 server → tools cached with `ttlMs`/`cacheScope`
- Restart adapter → v2 cache loaded, tools available per TTL/scope rules

---

## Acceptance Criteria (Verifiable Test Cases)

| # | Criterion | Verification |
| --- | ----------- | -------------- |
| 1 | **Toolbelt Gateway discovers servers via `server/discover`** | `probeMcpEndpoint("http://gateway-url")` returns `{ isMcp: true, classification: "endpoint supports stateless MCP 2026-07-28 server/discover" }` |
| 2 | **`tools/list` returns `ttlMs`/`cacheScope`** | Connect to a 2026-07-28 test server; inspect `manager.getConnection(name).tools[0].ttlMs` and `.cacheScope` are populated |
| 3 | **`tools/call` returns `resultType`/`_meta.serverInfo`** | Execute `mcp({ tool: "test", protocolVersion: "2026-07-28" })`; result `details` contains `resultType` and `serverInfo` |
| 4 | **Per-request `protocolVersion` honored** | Call `mcp({ tool: "test", protocolVersion: "2026-07-28" })`; network trace or SDK interceptor shows `_meta.protocolVersion: "2026-07-28"` in outbound request |
| 5 | **Server config fallback for protocolVersion** | Configure server with `protocolVersion: "2026-07-28"`; call `mcp({ tool: "test" })` without explicit version; SDK request includes `_meta.protocolVersion: "2026-07-28"` |
| 6 | **No regression on legacy servers** | Existing `protocolVersion: "legacy"` servers connect and work identically; no `_meta.protocolVersion` sent |
| 7 | **Cache persistence round-trips `ttlMs`/`cacheScope`** | Connect to 2026-07-28 server; restart adapter; cached tools have `ttlMs`/`cacheScope` intact |
| 8 | **`cacheScope: "global"` survives restart** | Cache tools with `cacheScope: "global"`; restart; `loadMetadataCache` returns tools with `cacheScope: "global"` |
| 9 | **`cacheScope: "session"` respects TTL on restart** | Cache tools with `cacheScope: "session"`, `ttlMs: 1000`; wait >1s; restart; `isServerCacheValid` returns false (age > TTL) |
| 10 | **Direct tools surface result metadata** | Register direct tool for 2026-07-28 server; invoke via agent; result `details` includes `resultType`/`serverInfo` |
| 11 | **Direct tool spec supports protocolVersion** | `DirectToolSpec` accepts optional `protocolVersion`; `createDirectToolExecutor` uses it for calls |
| 12 | **Legacy fallback warning emitted** | Configure server with `protocolVersion: "legacy"`; connect; log contains warning about legacy protocol |
| 13 | **MODERN_PROTOCOL_VERSION constant reusable** | `import { MODERN_PROTOCOL_VERSION } from "./mcp-probe.ts"`; `MODERN_PROTOCOL_VERSION === "2026-07-28"` |
| 14 | **Cache version bump invalidates v1 caches** | Place v1 cache file; start adapter; `loadMetadataCache()` returns `null` |

---

## Implementation Sequence (from Proposal)

1. **Types** (`types.ts`) — Add `ttlMs`, `cacheScope` to `McpTool` and `CachedTool`; add `McpCallToolResultMeta`
2. **Metadata Cache** (`metadata-cache.ts`) — Update `serializeTools`, `reconstructToolMetadata`; bump `CACHE_VERSION` to 2
3. **Server Manager** (`server-manager.ts`) — Update `fetchAllTools` to capture cache metadata; extend `buildRequestOptions`/`getRequestOptions` with `protocolVersion`
4. **MCP Probe** (`mcp-probe.ts`) — Confirm `MODERN_PROTOCOL_VERSION` export; verify discovery flow
5. **Proxy Modes** (`proxy-modes.ts`) — Update `executeCall` to accept/thread `protocolVersion`; capture `resultType`/`serverInfo` in details
6. **Direct Tools** (`direct-tools.ts`) — Add `protocolVersion` to `DirectToolSpec`; update `createDirectToolExecutor` similarly

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
| ------ | ------------ | -------- | ------------ |
| SDK `ListToolsResult` shape differs (ttlMs/cacheScope at page level vs per-tool) | Medium | High | Proposal assumes page-level; `fetchAllTools` captures from first page. If per-tool, adjust to per-tool mapping. |
| SDK `CallToolResult` lacks `resultType`/`_meta.serverInfo` in some versions | Low | Medium | Optional chaining; surface only when present. |
| Cache version bump causes unnecessary re-fetches for users with large tool sets | High | Low | Acceptable; one-time cost. Document in release notes. |
| Per-request `protocolVersion` conflicts with connection-negotiated version | Low | Medium | SDK validates; surface errors clearly. Document as advanced option. |
| `global` vs `session` cacheScope semantics confusion | Medium | Low | Clear docs: `global` = cross-session persist; `session` = TTL-bound per session. TTL handles expiry. |
| Toolbelt Gateway requires additional headers beyond `MCP-Protocol-Version` | Low | Medium | Probe already uses `Mcp-Method`; monitor gateway integration tests. |

---

## Out of Scope (Reaffirmed)

- Transport layer changes (stdio, SSE, Streamable HTTP, Unix sockets)
- Authentication/OAuth flow modifications
- Version negotiation logic changes (SDK handles)
- Breaking changes to existing server configurations
- SDK version upgrades (already on 2.0.0)
- Speculative future-proofing beyond 2026-07-28
- Changes to proxy tool schema or direct tool registration surface
