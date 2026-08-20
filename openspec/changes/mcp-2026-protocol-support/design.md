# Design: MCP 2026-07-28 Protocol Support

## 1. Architecture Overview

The protocol version flows through three layers:

```
┌─────────────────────────────────────────────────────────────────┐
│                     CALLER LAYER                                 │
│  Proxy Tool (mcp)          │  Direct Tool Executor              │
│  protocolVersion arg ──────►│  DirectToolSpec.protocolVersion    │
└──────────────┬──────────────┴────────────────┬──────────────────┘
               │                                │
               ▼                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                  REQUEST PLUMBING LAYER                          │
│  server-manager.ts: getRequestOptions(name, signal, protocolVersion) │
│  buildRequestOptions(definition, signal, protocolVersion)        │
│  Returns RequestOptions { _meta: { protocolVersion } }           │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    SDK / TRANSPORT LAYER                         │
│  Client.callTool({ name, arguments, _meta: { protocolVersion } },│
│                requestOptions)                                   │
│  - HTTP transport sends MCP-Protocol-Version header             │
│  - server/discover used when protocolVersion="auto"|"2026-07-28" │
└─────────────────────────────────────────────────────────────────┘
```

**Key flow:**

1. Caller provides `protocolVersion` (explicit arg → server config → none)
2. `getRequestOptions`/`buildRequestOptions` wraps it in `_meta.protocolVersion`
3. SDK `callTool`/`listTools` receives it in `RequestOptions`
4. Transport sends `MCP-Protocol-Version` header; SDK handles `server/discover`
5. Response metadata (`resultType`, `_meta.serverInfo`, `ttlMs`, `cacheScope`) captured and surfaced in `details`

---

## 2. Data Flow Diagrams

### 2.1 Tool List Refresh (capturing `ttlMs`/`cacheScope`)

```
┌─────────────┐     listTools()      ┌──────────────────┐
│  Server     │ ──────────────────►  │   SDK Client     │
│  Manager    │  RequestOptions      │                  │
└─────────────┘  (no _meta needed)   └────────┬─────────┘
                                              │
                                              │ ListToolsResult
                                              │ { tools: [], nextCursor,
                                              │   ttlMs: 300000,
                                              │   cacheScope: "global" }
                                              ▼
                                    ┌──────────────────┐
                                    │  fetchAllTools   │
                                    │  (server-manager)│
                                    └────────┬─────────┘
                                             │
                           ┌─────────────────┼─────────────────┐
                           ▼                 ▼                 ▼
                    ┌────────────┐   ┌────────────┐   ┌────────────┐
                    │  Page 1    │   │  Page 2    │   │  Page N    │
                    │ tools +    │   │ tools      │   │ tools      │
                    │ ttlMs/     │   │ (no cache  │   │ (no cache  │
                    │ cacheScope │   │  metadata) │   │  metadata) │
                    └─────┬──────┘   └─────┬──────┘   └─────┬──────┘
                          │                │                │
                          └────────────────┼────────────────┘
                                           │
                                           ▼
                                ┌────────────────────┐
                                │  Enriched McpTool[]│
                                │  [{ name, ttlMs:   │
                                │   300000,          │
                                │   cacheScope:      │
                                │   "global" }...]   │
                                └─────────┬──────────┘
                                          │
                                          ▼
                                ┌────────────────────┐
                                │  metadata-cache.ts │
                                │  serializeTools()  │
                                │  CACHE_VERSION=2   │
                                └─────────┬──────────┘
                                          │
                                          ▼
                                ┌────────────────────┐
                                │  Disk Cache (v2)   │
                                │  CachedTool[] with │
                                │  ttlMs, cacheScope │
                                └────────────────────┘
```

**Pagination rule:** `ttlMs`/`cacheScope` come from the **first page only** (per spec). All tools across pages inherit the first page's cache metadata.

### 2.2 Tool Call Execution (per-request `protocolVersion`, capturing `resultType`/`serverInfo`)

```
┌──────────────┐                    ┌─────────────────────┐
│   Caller     │  mcp({tool, args,  │  executeCall /      │
│  (proxy or   │   protocolVersion: │  createDirectTool   │
│   direct)    │   "2026-07-28"})   │  Executor           │
└──────┬───────┘                    └──────────┬──────────┘
       │                                         │
       │ protocolVersion                         │
       ▼                                         ▼
┌──────────────────────┐               ┌─────────────────────┐
│ getRequestOptions(   │               │ requestOptions =    │
│  server, signal,     │─────────────► │ { signal, timeout,  │
│  protocolVersion )   │               │   _meta: {          │
└──────────────────────┘               │     protocolVersion │
                                       │   } }               │
                                       └──────────┬──────────┘
                                                  │
                                                  │ callTool({name, arguments,
                                                  │           _meta: {protocolVersion}},
                                                  │          requestOptions)
                                                  ▼
                                       ┌─────────────────────┐
                                       │      SDK Client     │
                                       │  - Sends HTTP with  │
                                       │    MCP-Protocol-    │
                                       │    Version header   │
                                       └──────────┬──────────┘
                                                  │
                                                  │ CallToolResult
                                                  │ { content: [...],
                                                  │   resultType: "data",
                                                  │   _meta: {
                                                  │     serverInfo: {
                                                  │       name, version,
                                                  │       protocolVersion
                                                  │     }
                                                  │   } }
                                                  ▼
                                       ┌─────────────────────┐
                                       │  Capture Metadata   │
                                       │  resultMeta = {     │
                                       │   resultType,       │
                                       │   serverInfo        │
                                       │ }                   │
                                       └──────────┬──────────┘
                                                  │
                                                  ▼
                                       ┌─────────────────────┐
                                       │  ProxyToolResult /  │
                                       │  AgentToolResult    │
                                       │  details: {         │
                                       │   server, tool,     │
                                       │   resultType,       │
                                       │   serverInfo        │
                                       │ }                   │
                                       └─────────────────────┘
```

---

## 3. Component Interfaces — Exact Function Signatures

### 3.1 `types.ts`

```typescript
// Extended
export interface McpTool {
  name: SdkTool["name"];
  title?: SdkTool["title"];
  description?: SdkTool["description"];
  inputSchema?: SdkTool["inputSchema"];
  _meta?: SdkTool["_meta"];
  ttlMs?: number;                    // NEW
  cacheScope?: "session" | "global"; // NEW
}

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

// New
export interface McpCallToolResultMeta {
  resultType?: "data" | "error" | "resource" | "ui";
  serverInfo?: {
    name?: string;
    version?: string;
    protocolVersion?: string;
  };
}

// RequestOptions is re-exported from SDK; usage convention documented:
// RequestOptions._meta?.protocolVersion?: string
```

### 3.2 `metadata-cache.ts`

```typescript
// CACHE_VERSION bumped from 1 to 2
const CACHE_VERSION = 2;

export function serializeTools(tools: McpTool[]): CachedTool[] {
  // ...existing logic...
  // NEW: spread ttlMs and cacheScope when defined
}

export function reconstructToolMetadata(
  serverName: string,
  entry: ServerCacheEntry,
  prefix: ToolPrefix,
  definition: Pick<ServerEntry, "exposeResources" | "includeTools" | "excludeTools" | "toolPrefix">,
  configuredServers?: Record<string, ServerEntry>,
  cache?: MetadataCache,
): ToolMetadata[] {
  // ...existing logic...
  // NEW: spread ttlMs and cacheScope from tool to metadata
}
```

### 3.3 `server-manager.ts`

```typescript
class McpServerManager {
  // NEW: protocolVersion parameter
  private buildRequestOptions(
    definition?: ServerDefinition,
    signal?: AbortSignal,
    protocolVersion?: string,
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

  // NEW: protocolVersion parameter
  getRequestOptions(
    name: string,
    signal?: AbortSignal,
    protocolVersion?: string,
  ): RequestOptions | undefined {
    const connection = this.connections.get(name);
    return this.buildRequestOptions(connection?.definition, signal, protocolVersion);
  }

  // Modified: capture ttlMs/cacheScope from first page
  private async fetchAllTools(
    client: Client,
    requestOptions?: CacheableRequestOptions,
  ): Promise<McpTool[]> {
    const allTools: McpTool[] = [];
    let cursor: string | undefined;
    let pageTtlMs: number | undefined;
    let pageCacheScope: "session" | "global" | undefined;

    do {
      const result = await client.listTools(cursor ? { cursor } : undefined, requestOptions);
      
      // Capture cache metadata from FIRST page only
      if (allTools.length === 0) {
        pageTtlMs = (result as ListToolsResult & { ttlMs?: number }).ttlMs;
        pageCacheScope = (result as ListToolsResult & { cacheScope?: "session" | "global" }).cacheScope;
      }

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

  // Legacy fallback warning (connection time)
  async connect(definition: ServerDefinition): Promise<ServerConnection> {
    // ...existing...
    if (resolvedProtocol === "legacy") {
      logger.warn(
        `MCP server '${definition.name}' is using legacy protocol (pre-2026-07-28). ` +
        `Modern features (cache metadata, per-request version, result metadata) are unavailable.`
      );
    }
    // ...
  }
}
```

### 3.4 `mcp-probe.ts`

```typescript
// Already exists — confirm export
export const MODERN_PROTOCOL_VERSION = "2026-07-28";

// Used by server-manager.ts for version resolution
```

### 3.5 `proxy-modes.ts`

```typescript
// Extended signature
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
  // ...existing...

  // NEW: pass protocolVersion to getRequestOptions
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

  const details = {
    server: serverName,
    tool: toolMeta.originalName,
    ...(resultMeta.resultType ? { resultType: resultMeta.resultType } : {}),
    ...(resultMeta.serverInfo ? { serverInfo: resultMeta.serverInfo } : {}),
    ...guardedMcpDetails(guarded),
  };

  return { content: result.content, isError: result.isError, details };
}
```

### 3.6 `direct-tools.ts`

```typescript
// Extended spec
export interface DirectToolSpec {
  serverName: string;
  originalName: string;
  name: string;
  description: string;
  inputSchema: unknown;
  uiResourceUri?: string;
  uiVisibility?: UiToolVisibility[];
  uiStreamMode?: "eager" | "stream-first";
  protocolVersion?: string; // NEW
}

// Extended executor
export function createDirectToolExecutor(
  getState: () => McpExtensionState | null,
  getInitPromise: () => Promise<McpExtensionState> | null,
  spec: DirectToolSpec
): DirectToolExecute {
  return async function execute(_toolCallId, params, signal) {
    // ...existing...

    // NEW: use spec.protocolVersion
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

    return { content: result.content, isError: result.isError, details };
  };
}
```

---

## 4. Error Handling Strategy

| Scenario | Behavior |
| ---------- | ---------- |
| **Per-request `protocolVersion` conflicts with connection-negotiated version** | SDK validates and returns error. Surface as-is: `McpError: Protocol version mismatch — connection negotiated 'legacy', request pinned '2026-07-28'`. Caller must ensure compatible connection. |
| **Missing `ttlMs`/`cacheScope` in `ListToolsResult`** | Optional chaining; fields omitted from `McpTool`. `serializeTools` skips undefined fields. |
| **Missing `resultType`/`_meta.serverInfo` in `CallToolResult`** | Optional chaining; keys omitted from `details`. Legacy servers produce no metadata. |
| **Cache version mismatch (v1 → v2)** | `loadMetadataCache` returns `null` (handled by existing `CACHE_VERSION` check). Fresh `tools/list` on next connect. |
| **`server/discover` fails on HTTP endpoint** | SDK falls back to legacy `initialize`. If `protocolVersion: "2026-07-28"` pinned, error propagates. If `"auto"`, legacy path used with warning. |
| **Invalid `cacheScope` value from server** | Type guard: accept only `"session" \| "global"`. Unknown values treated as `undefined` (no persistence semantics). |

---

## 5. Cache Invalidation Logic: Global vs Session Scope

| Scope | Persistence | Invalidation Trigger |
| ------- | ------------- | --------------------- |
| `"global"` | Full disk persistence (`CachedTool` with `ttlMs`, `cacheScope: "global"`) | `isServerCacheValid` checks: `configHash` match AND `age < ttlMs` (if `ttlMs` present). Survives restart if valid. |
| `"session"` | Disk persistence (same file) but **treated as stale on fresh load** unless `isServerCacheValid` passes | `isServerCacheValid` uses same logic (`configHash` + `maxAgeMs` which defaults to `ttlMs` or 5min). On restart, age > TTL → re-fetch. |

**Implementation:** No new invalidation code. Existing `isServerCacheValid(entry, maxAgeMs)` already handles TTL-based expiry. `cacheScope: "session"` tools simply have shorter/default TTLs so they expire naturally on restart. `cacheScope: "global"` tools get long TTLs from server.

```typescript
// Existing logic (metadata-cache.ts) — unchanged
export function isServerCacheValid(
  entry: ServerCacheEntry,
  maxAgeMs: number = 5 * 60 * 1000,
): boolean {
  if (!entry?.cachedAt || !entry.configHash) return false;
  const age = Date.now() - entry.cachedAt;
  return age < maxAgeMs;
}
```

**On load:** `loadMetadataCache` returns v2 cache. `reconstructToolMetadata` restores `ttlMs`/`cacheScope` to `ToolMetadata`. Caller (server-manager) uses `isServerCacheValid` with server-provided `ttlMs` as `maxAgeMs` to decide refresh.

---

## 6. Legacy Fallback Warning Mechanism

**Location:** `server-manager.ts` → `connect()` method, after version resolution.

```typescript
// In connect(), after SDK connection established:
const resolvedProtocol = connection.negotiatedProtocolVersion; // SDK exposes this
if (resolvedProtocol === "legacy" || resolvedProtocol === "2025-06-18") {
  logger.warn(
    `MCP server '${definition.name}' is using legacy protocol (pre-2026-07-28). ` +
    `Modern features (cache metadata, per-request version, result metadata) are unavailable.`
  );
}
```

**Trigger conditions:**

- `protocolVersion: "legacy"` in server config
- `protocolVersion: "auto"` but server only supports legacy (SDK falls back)
- Connection succeeds but negotiated version < 2026-07-28

**Not triggered:**

- `protocolVersion: "2026-07-28"` (pinned — SDK errors if unavailable)
- Modern server successfully negotiates 2026-07-28

---

## 7. Testing Strategy

### 7.1 Unit Tests (per modified function)

| File | Function | Test Cases |
| ------ | ---------- | ------------ |
| `types.ts` | Type compilation | `McpTool` accepts `ttlMs`/`cacheScope`; `CachedTool` same; `McpCallToolResultMeta` constructs correctly |
| `metadata-cache.ts` | `serializeTools` | Tools with/without `ttlMs`/`cacheScope` serialize correctly; omitted when undefined |
| | `reconstructToolMetadata` | Cache metadata restored to `ToolMetadata`; missing fields handled |
| | `CACHE_VERSION` | v1 cache returns `null`; v2 cache loads with new fields |
| `server-manager.ts` | `buildRequestOptions` | Returns `_meta.protocolVersion` when provided; omits when undefined; merges with timeout/signal |
| | `getRequestOptions` | Forwards `protocolVersion` to `buildRequestOptions` |
| | `fetchAllTools` | First page `ttlMs`/`cacheScope` applied to all tools; subsequent pages inherit; legacy server (no metadata) works |
| | `connect()` | Legacy fallback warning logged when negotiated version is legacy |
| `proxy-modes.ts` | `executeCall` | `protocolVersion` threaded to `getRequestOptions`; `resultType`/`serverInfo` captured in `details`; legacy response (no metadata) produces clean `details` |
| `direct-tools.ts` | `createDirectToolExecutor` | `spec.protocolVersion` used for calls; result metadata in `details`; `DirectToolSpec` accepts optional `protocolVersion` |
| `mcp-probe.ts` | `MODERN_PROTOCOL_VERSION` | Exported constant equals `"2026-07-28"` |

### 7.2 Integration Test Scenarios

| # | Scenario | Setup | Assertion |
| --- | ---------- | ------- | ----------- |
| 1 | **Gateway discovery** | HTTP endpoint with `server/discover` | `probeMcpEndpoint` returns `classification: "endpoint supports stateless MCP 2026-07-28 server/discover"` |
| 2 | **Tool list cache metadata** | 2026-07-28 test server returning `ttlMs: 300000, cacheScope: "global"` | `manager.getConnection(name).tools[0].ttlMs === 300000 && .cacheScope === "global"` |
| 3 | **Tool call result metadata** | 2026-07-28 server returning `resultType: "data"`, `_meta.serverInfo` | `mcp({tool, protocolVersion: "2026-07-28"})` result `details` has `resultType` & `serverInfo` |
| 4 | **Per-request protocol version** | Server config `protocolVersion: "auto"` | Call with explicit `protocolVersion: "2026-07-28"` → SDK request has `_meta.protocolVersion: "2026-07-28"` |
| 5 | **Server config fallback** | Server config `protocolVersion: "2026-07-28"` | Call without explicit version → SDK request has `_meta.protocolVersion: "2026-07-28"` |
| 6 | **Legacy server no regression** | Server config `protocolVersion: "legacy"` | Connect + tool call works; no `_meta.protocolVersion` sent; warning logged |
| 7 | **Cache persistence round-trip** | Connect to 2026-07-28 server, restart adapter | Cached tools have `ttlMs`/`cacheScope` intact |
| 8 | **Global scope survives restart** | Cache `cacheScope: "global"`, valid hash, within TTL | `loadMetadataCache` returns tools with `cacheScope: "global"` |
| 9 | **Session scope respects TTL** | Cache `cacheScope: "session"`, `ttlMs: 1000`, wait >1s, restart | `isServerCacheValid` returns false (age > TTL) |
| 10 | **Direct tools surface metadata** | Direct tool for 2026-07-28 server | Agent invoke → result `details` has `resultType`/`serverInfo` |
| 11 | **Direct tool spec protocolVersion** | `DirectToolSpec.protocolVersion: "2026-07-28"` | Executor uses it for `callTool` |
| 12 | **Legacy fallback warning** | Config `protocolVersion: "legacy"` | Connect → log contains legacy warning |
| 13 | **Constant reusability** | Import `MODERN_PROTOCOL_VERSION` from `mcp-probe` | Value === `"2026-07-28"` |
| 14 | **Cache version bump** | Place v1 cache file, start adapter | `loadMetadataCache()` returns `null` |

### 7.3 Test Infrastructure Notes

- Use existing test server fixtures (MCP test servers) for 2026-07-28 and legacy variants
- Mock SDK `Client` for unit tests; integration tests hit real test servers
- Cache tests: write v1 fixture file, verify v2 load returns `null`
- Warning tests: capture `logger.warn` calls

---

## 8. File Change Summary

| File | Change Type | Lines Added/Modified |
| ------ | ------------- | --------------------- |
| `types.ts` | Interface extensions + new type | ~25 |
| `metadata-cache.ts` | `serializeTools`, `reconstructToolMetadata`, `CACHE_VERSION=2` | ~30 |
| `server-manager.ts` | `buildRequestOptions`, `getRequestOptions`, `fetchAllTools`, warning in `connect` | ~50 |
| `mcp-probe.ts` | Confirm `MODERN_PROTOCOL_VERSION` export (no change) | 0 |
| `proxy-modes.ts` | `executeCall` signature + metadata capture | ~35 |
| `direct-tools.ts` | `DirectToolSpec.protocolVersion`, `createDirectToolExecutor` plumbing | ~30 |

**Total:** ~170 lines across 6 files. All changes additive; no breaking changes.

---

## 9. Rollback Plan

Revert the 6 modified files. No config migration needed — new fields are optional. `CACHE_VERSION` bump means v1 caches are ignored automatically on rollback (treated as stale).
