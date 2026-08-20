# Proposal: MCP 2026-07-28 Protocol Support for Toolbelt Gateway Compatibility

## Change ID

`mcp-2026-protocol-support`

---

## 1. Problem Statement

The **Toolbelt Gateway** (and other modern MCP 2026-07-28 consumers) requires protocol features that the pi-mcp-adapter currently does not plumb through, despite the underlying SDK (`@modelcontextprotocol/client@2.0.0`, `core@2.0.0`) already supporting them.

**Missing capabilities:**

| Feature | Current State | Required For |
| --------- | --------------- | -------------- |
| `server/discover` endpoint probing | Only legacy `initialize` used | Toolbelt Gateway discovery |
| `tools/list` response `ttlMs`, `cacheScope` | Ignored/discarded | Client-side caching & invalidation |
| `tools/call` response `resultType`, `_meta.serverInfo` | Not surfaced in adapter results | Structured results, server metadata |
| Per-request `_meta.protocolVersion` on tool calls | Only connection-time version negotiation | Gateway routing, version pinning per call |
| Modern protocol version in HTTP headers (`MCP-Protocol-Version`) | Probe uses it; runtime connection doesn't consistently | Stateless HTTP, gateway compatibility |

**Impact:** Toolbelt Gateway cannot reliably discover, cache, or invoke tools through the adapter. Users see fallback behavior or connection failures when the gateway expects modern protocol semantics.

---

## 2. Proposed Solution

Plumb existing SDK capabilities through the adapter with **minimal, focused changes** — no SDK upgrades, no transport/auth rewrites.

### High-Level Approach

1. **Types**: Extend internal type definitions to carry new fields (`ttlMs`, `cacheScope`, `resultType`, `_meta.serverInfo`, per-request `protocolVersion`).
2. **Server Manager**: Pass per-request `protocolVersion` via `_meta` on `callTool`/`readResource`; capture and store `tools/list` cache metadata; capture `tools/call` result metadata.
3. **Proxy Modes & Direct Tools**: Thread `_meta.protocolVersion` from caller intent through to SDK calls; surface new response fields in tool results.
4. **Metadata Cache**: Persist `ttlMs`/`cacheScope` per tool; persist `serverInfo` from tool calls for debugging/observability.
5. **MCP Probe**: Already uses modern protocol — ensure connection flow uses `server/discover` for HTTP servers when `protocolVersion` is `"auto"` or `"2026-07-28"`.

---

## 3. Scope Boundaries

**In scope (protocol plumbing only):**

- Type definitions in `types.ts` (`McpTool`, `CachedTool`, `CallToolResult` extensions)
- Request options plumbing in `server-manager.ts` (per-request `_meta.protocolVersion`)
- Tool list refresh caching (`ttlMs`, `cacheScope`) in `server-manager.ts` + `metadata-cache.ts`
- Tool call result metadata (`resultType`, `_meta.serverInfo`) in `proxy-modes.ts` + `direct-tools.ts`
- `server/discover` integration in connection flow (`mcp-probe.ts` → `server-manager.ts`)

**Out of scope:**

- Transport layer changes (stdio, SSE, Streamable HTTP, Unix sockets)
- Authentication/OAuth flows
- Version negotiation logic (already exists in SDK)
- Breaking changes to existing server configurations
- SDK version upgrades (already on 2.0.0)

---

## 4. Non-Goals

- ❌ No SDK version changes
- ❌ No breaking changes to existing server configs
- ❌ No new transport implementations
- ❌ No auth flow modifications
- ❌ No speculative "future-proofing" beyond 2026-07-28
- ❌ No changes to proxy tool schema or direct tool registration surface

---

## 5. Key Technical Changes

### 5.1 `types.ts` — Type Extensions

```typescript
// Extend McpTool with cache metadata from tools/list
export interface McpTool {
  // ...existing
  ttlMs?: number;           // NEW: cache TTL in ms
  cacheScope?: "session" | "global"; // NEW: cache invalidation scope
}

// Extend CachedTool for persistence
export interface CachedTool {
  // ...existing
  ttlMs?: number;
  cacheScope?: "session" | "global";
}

// New: Structured tool call result metadata
export interface McpCallToolResultMeta {
  resultType?: "data" | "error" | "resource" | "ui";
  serverInfo?: {
    name?: string;
    version?: string;
    protocolVersion?: string;
  };
}

// Request options extension for per-request protocol version
export interface RequestOptions {
  // ...existing
  _meta?: {
    protocolVersion?: string;
    [key: string]: unknown;
  };
}
```

### 5.2 `server-manager.ts` — Connection & Request Plumbing

- **`createConnection`**: When `definition.protocolVersion === "auto" || "2026-07-28"`, ensure HTTP transport sends `MCP-Protocol-Version` header and uses `server/discover` during initial handshake (SDK handles this; verify no override).
- **`fetchAllTools`**: Capture `ttlMs` and `cacheScope` from `ListToolsResult` (SDK returns these; currently ignored). Store on `ServerConnection.tools` as enriched `McpTool[]`.
- **`buildRequestOptions`**: Accept optional `protocolVersion` parameter; include in `_meta.protocolVersion` for outbound requests.
- **`getRequestOptions`**: Expose per-request `_meta` builder for proxy/direct callers.

### 5.3 `proxy-modes.ts` — Proxy Tool Execution

- **`executeCall`**:
  - Accept optional `protocolVersion` in call args (e.g., `mcp({ tool: "...", args: {...}, protocolVersion: "2026-07-28" })`).
  - Pass via `requestOptions._meta.protocolVersion` to `conn.client.callTool`.
  - Capture `result._meta?.serverInfo` and `result.resultType` from SDK response.
  - Include in `details` of `ProxyToolResult` for gateway consumption.

### 5.4 `direct-tools.ts` — Direct Tool Execution

- **`createDirectToolExecutor`**: Same plumbing as proxy — thread `protocolVersion` from spec or call args through to `callTool`; surface `resultType`/`serverInfo` in result `details`.

### 5.5 `metadata-cache.ts` — Cache Persistence

- **`serializeTools`**: Persist `ttlMs` and `cacheScope` in `CachedTool`.
- **`reconstructToolMetadata`**: Restore cache metadata to `ToolMetadata` for runtime use.
- **`ServerCacheEntry`**: No schema change needed — `CachedTool` carries the fields.

### 5.6 `mcp-probe.ts` — Discovery Integration

- Already probes with `server/discover` and `MCP-Protocol-Version: 2026-07-28`.
- **Change**: Export `MODERN_PROTOCOL_VERSION` constant for reuse in `server-manager.ts` to avoid drift.
- **Verify**: Connection flow for HTTP servers with `protocolVersion: "auto"` uses probe result to decide transport (SDK handles; confirm no regression).

---

## 6. Acceptance Criteria

| Criterion | Verification |
| ----------- | -------------- |
| **Toolbelt Gateway discovers servers via `server/discover`** | `probeMcpEndpoint` returns `classification: "endpoint supports stateless MCP 2026-07-28 server/discover"` for gateway endpoints |
| **`tools/list` returns `ttlMs`/`cacheScope`** | Connect to a 2026-07-28 server; inspect cached `ServerCacheEntry.tools[].ttlMs` and `cacheScope` are populated |
| **`tools/call` returns `resultType`/`_meta.serverInfo`** | Execute a tool via proxy or direct; result `details` contains `resultType` and `serverInfo` |
| **Per-request `protocolVersion` honored** | Call `mcp({ tool: "...", protocolVersion: "2026-07-28" })`; SDK request includes `_meta.protocolVersion: "2026-07-28"` |
| **No regression on legacy servers** | Existing `protocolVersion: "legacy"` servers connect and work identically |
| **Cache persistence round-trips** | Restart adapter; cached `ttlMs`/`cacheScope` survive load/save cycle |

---

## 7. Risks & Rollback

| Risk | Mitigation |
| ------ | ------------ |
| SDK response shapes differ from expectation | Feature-flag behind `protocolVersion` config; default to legacy behavior |
| Cache metadata breaks older cache files | `CACHE_VERSION` bump handles migration; `isServerCacheValid` already rejects mismatched hashes |
| Per-request version conflicts with connection version | SDK validates; surface errors clearly; document as advanced option |

**Rollback:** Revert the 6 modified files. No config migration needed — new fields are optional and additive.

---

## 8. Implementation Sequence

1. **Types** (`types.ts`) — Foundation for all downstream changes
2. **Metadata Cache** (`metadata-cache.ts`) — Persist new fields
3. **Server Manager** (`server-manager.ts`) — Capture on connect/refresh; build request options
4. **MCP Probe** (`mcp-probe.ts`) — Export constant; verify discovery flow
5. **Proxy Modes** (`proxy-modes.ts`) — Thread per-request version; surface result metadata
6. **Direct Tools** (`direct-tools.ts`) — Same as proxy for direct execution

---

## 9. Questions for Clarification

1. **Per-request `protocolVersion` source**: Should this come from a global setting, per-server config, or explicit call argument? (Proposal assumes explicit call arg with fallback to server config `protocolVersion`.)

2. **`cacheScope` semantics**: The spec defines `"session"` | `"global"`. Should the adapter honor `global` by sharing across sessions, or treat both as session-scoped? (Proposal: persist per-session; `global` logged but not acted on yet.)

3. **`resultType` handling**: Should the adapter transform behavior based on `resultType` (e.g., `resource` → auto-materialize), or just surface it? (Proposal: surface only; transformation is a separate feature.)

4. **Gateway-specific headers**: Does Toolbelt Gateway require any additional headers beyond `MCP-Protocol-Version` and `Mcp-Method`? (Proposal: none known; probe uses what gateway expects.)

5. **Version pinning vs. fallback**: When `protocolVersion: "2026-07-28"` is pinned per-request but connection negotiated `"legacy"`, should the call fail or downgrade? (Proposal: fail fast with clear error; caller must ensure compatible connection.)

---

## 10. Success Metrics

- Toolbelt Gateway integration tests pass end-to-end
- Zero regressions on existing MCP server test matrix
- Cache hit rate improves for servers advertising `ttlMs`
- Per-request version routing works for multi-version gateways
