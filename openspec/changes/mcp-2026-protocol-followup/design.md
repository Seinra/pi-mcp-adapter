# SDD Design: MCP 2026-07-28 Protocol Follow-up

## 1. Architecture Overview

### 1.1 Protocol Version & Metadata Flow

The MCP 2026-07-28 protocol introduces two new mechanisms that must thread through both proxy and direct tool paths:

| Mechanism | Purpose | Where It Flows |
|-----------|---------|----------------|
| `protocolVersion` in request `_meta` | Pins the protocol version for a specific call | `executeCall` (proxy) → `getRequestOptions` → `buildRequestOptions` → SDK request<br>`createDirectToolExecutor` (direct) → `getRequestOptions` → `buildRequestOptions` → SDK request |
| `resultType` + `serverInfo` in response `_meta` | Server-returned result classification & identity | SDK `CallToolResult` → capture in `AgentToolResult.details` (both paths) |

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           PROXY PATH (executeCall)                          │
├─────────────────────────────────────────────────────────────────────────────┤
│  mcp({ tool, args, protocolVersion? })                                      │
│         │                                                                    │
│         ▼                                                                    │
│  executeCall(state, toolName, args, serverOverride, getPiTools, signal,    │
│              origin, protocolVersion?) ◄── 8th param (optional)             │
│         │                                                                    │
│         ▼                                                                    │
│  getRequestOptions(serverName, signal, protocolVersion) ◄── 3rd param       │
│         │                                                                    │
│         ▼                                                                    │
│  buildRequestOptions(definition, signal, protocolVersion) ◄── 3rd param     │
│         │                                                                    │
│         ▼                                                                    │
│  RequestOptions { _meta: { protocolVersion } }                              │
│         │                                                                    │
│         ▼                                                                    │
│  client.callTool({ name, arguments, _meta }, requestOptions)                │
│         │                                                                    │
│         ▼                                                                    │
│  CallToolResult { resultType?, _meta: { serverInfo? } }                     │
│         │                                                                    │
│         ▼                                                                    │
│  Capture → details: { resultType?, serverInfo? }                            │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                         DIRECT PATH (createDirectToolExecutor)              │
├─────────────────────────────────────────────────────────────────────────────┤
│  DirectToolSpec { protocolVersion? }                                        │
│         │                                                                    │
│         ▼                                                                    │
│  createDirectToolExecutor(spec, getRequestOptions, ...)                     │
│         │                                                                    │
│         ▼                                                                    │
│  getRequestOptions(serverName, signal, spec.protocolVersion) ◄── 3rd param  │
│         │                                                                    │
│         ▼                                                                    │
│  buildRequestOptions(definition, signal, spec.protocolVersion)              │
│         │                                                                    │
│         ▼                                                                    │
│  RequestOptions { _meta: { protocolVersion } }                              │
│         │                                                                    │
│         ▼                                                                    │
│  client.callTool({ name, arguments, _meta }, requestOptions)                │
│         │                                                                    │
│         ▼                                                                    │
│  CallToolResult { resultType?, _meta: { serverInfo? } }                     │
│         │                                                                    │
│         ▼                                                                    │
│  Capture → AgentToolResult.details: { resultType?, serverInfo? }            │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Shared Type for Metadata Capture

Both paths use the same `McpCallToolResultMeta` interface (defined in `types.ts`) to type the response metadata, ensuring identical capture logic and preventing type drift.

### 1.3 Backward Compatibility

- All new parameters are optional (`protocolVersion?: string`)
- Legacy callers (2-arg `getRequestOptions`, 7-arg `executeCall`) work unchanged
- Missing `_meta`/`resultType` on legacy server responses → keys omitted from `details` (clean, no `undefined` values)

---

## 2. Component Interfaces

### 2.1 `types.ts`

**New interface:**

```typescript
export interface McpCallToolResultMeta {
  /** The type of result returned by the tool (MCP 2026-07-28) */
  resultType?: "data" | "error" | "resource" | "ui";
  /** Server identification information (MCP 2026-07-28) */
  serverInfo?: {
    /** Server name */
    name?: string;
    /** Server version */
    version?: string;
    /** Protocol version the server speaks */
    protocolVersion?: string;
  };
}
```

**Extended `DirectToolSpec`:**

```typescript
export interface DirectToolSpec {
  serverName: string;
  originalName: string;
  prefixedName: string;
  description: string;
  inputSchema?: unknown;
  resourceUri?: string;
  uiResourceUri?: string;
  uiStreamMode?: UiStreamMode;
  /** Optional protocol version to pin for this tool's requests. Defaults to undefined (no pinning). */
  protocolVersion?: string;
}
```

**`AgentToolResult.details` extension (implicit via `Record<string, unknown>`):**

```typescript
// When present, details may contain:
interface AgentToolResultDetails {
  // ...existing fields...
  resultType?: "data" | "error" | "resource" | "ui";
  serverInfo?: {
    name?: string;
    version?: string;
    protocolVersion?: string;
  };
}
```

---

### 2.2 `server-manager.ts`

**`McpServerManager.getRequestOptions` — extended signature:**

```typescript
getRequestOptions(
  name: string,
  signal?: AbortSignal,
  protocolVersion?: string
): RequestOptions | undefined;
```

**`McpServerManager.buildRequestOptions` — extended signature (private):**

```typescript
private buildRequestOptions(
  definition?: ServerDefinition,
  signal?: AbortSignal,
  protocolVersion?: string
): RequestOptions | undefined;
```

**Implementation contract:**

- When `protocolVersion` is provided (non-undefined), include `_meta: { protocolVersion }` in returned `RequestOptions`
- When `protocolVersion` is `undefined` or omitted, do NOT include `_meta.protocolVersion` (or include as `undefined` — SDK ignores)
- All existing callers (2-arg) continue to work without modification

---

### 2.3 `proxy-modes.ts`

**`executeCall` — extended signature:**

```typescript
async function executeCall(
  state: McpExtensionState,
  toolName: string,
  args?: Record<string, unknown>,
  serverOverride?: string,
  getPiTools?: () => ToolInfo[],
  signal?: AbortSignal,
  origin?: "proxy" | "script",
  protocolVersion?: string  // ← NEW: 8th parameter
): Promise<ProxyToolResult>;
```

**Implementation contract:**

1. Thread `protocolVersion` to `state.manager.getRequestOptions(serverName, ownedSignal, protocolVersion)`
2. After `client.callTool` resolves, capture metadata from response:

   ```typescript
   const resultType = result.resultType;  // "data" | "error" | "resource" | "ui" | undefined
   const serverInfo = result._meta?.serverInfo;  // { name?, version?, protocolVersion? } | undefined
   ```

3. Include captured fields in returned `details` **only when defined** (no `undefined` keys):

   ```typescript
   const details = {
     ...existingDetails,
     ...(resultType !== undefined ? { resultType } : {}),
     ...(serverInfo !== undefined ? { serverInfo } : {}),
   };
   ```

---

### 2.4 `direct-tools.ts`

**`createDirectToolExecutor` — behavior changes (signature unchanged):**

```typescript
export function createDirectToolExecutor(
  getState: () => McpExtensionState | null,
  getInitPromise: () => Promise<McpExtensionState> | null,
  spec: DirectToolSpec  // ← now includes optional protocolVersion
): DirectToolExecute;
```

**Implementation contract:**

1. Pass `spec.protocolVersion` to `getRequestOptions`:

   ```typescript
   const requestOptions = state.manager.getRequestOptions?.(
     spec.serverName,
     ownedSignal,
     spec.protocolVersion  // ← NEW: 3rd argument
   ) ?? (ownedSignal ? { signal: ownedSignal } : undefined);
   ```

2. After `callTool` resolves (both success and error paths), capture metadata identically to proxy path:

   ```typescript
   const resultType = result.resultType;
   const serverInfo = result._meta?.serverInfo;
   ```

3. Include in `details` only when defined (clean omission).

---

## 3. Error Handling Strategy

### 3.1 Version Mismatch (Connection vs Request)

| Scenario | Behavior |
| ---------- | ---------- |
| Connection negotiated at `2026-07-28`, request pins `legacy` | SDK validates; error surfaces as-is (transport-level error) |
| Connection negotiated at `legacy`, request pins `2026-07-28` | SDK validates; error surfaces as-is |
| No `protocolVersion` in request | SDK uses connection-negotiated version (default behavior) |

**Design decision:** No adapter-level warning/logging. The SDK error is precise and actionable. Callers should only pin `protocolVersion` when they know the server supports it (e.g., server advertises `2026-07-28` in `serverInfo.protocolVersion`).

### 3.2 Missing `_meta` / `resultType` (Legacy Servers)

- Use optional chaining throughout: `result.resultType`, `result._meta?.serverInfo`
- Only spread into `details` when value is `!== undefined`
- Result: legacy servers produce clean `details` without `resultType`/`serverInfo` keys

### 3.3 Partial `serverInfo` Fields

- `serverInfo` may have any subset of `{ name?, version?, protocolVersion? }`
- Capture the entire `serverInfo` object as-is (no transformation)
- TypeScript type allows all fields optional; runtime value preserves whatever the server sent

### 3.4 Abort / Auth Errors

- Existing abort/auth error handling unchanged
- Metadata capture only occurs on successful `callTool` resolution (not on thrown errors)

---

## 4. Testing Strategy

### 4.1 Unit Tests — Capture Logic

**File:** `__tests__/mcp-2026-metadata-capture.test.ts` (new)

| Test Case | Description |
| ----------- | ------------- |
| Proxy path captures `resultType: "data"` + full `serverInfo` | Mock `callTool` returns 2026-07-28 response; verify `details.resultType === "data"` and `details.serverInfo` matches |
| Proxy path captures `resultType: "error"` + partial `serverInfo` | `serverInfo` has only `name`; verify partial capture works |
| Proxy path with legacy response (no `_meta`) | Verify `details` has no `resultType`/`serverInfo` keys |
| Direct path captures metadata identically | Same scenarios via `createDirectToolExecutor` |
| Both paths: `resultType: "resource"` and `"ui"` | Verify all four literal values accepted |

**Implementation approach:**

- Mock `state.manager.getRequestOptions` to return `{ timeout: 1000 }`
- Mock `connection.client.callTool` to return controlled `CallToolResult` shapes
- Spy on `getRequestOptions` to verify 3rd argument (`protocolVersion`) threading

---

### 4.2 Integration Test — Mock 2026-07-28 Server

**File:** `__tests__/mcp-2026-metadata-integration.test.ts` (new)

Uses the existing `McpServerManager` + mocked SDK `Client` pattern from `proxy-modes-auto-auth.test.ts` but exercises the full call chain with a simulated 2026-07-28 response.

| Scenario | Verification |
| ---------- | -------------- |
| Proxy call with `protocolVersion: "2026-07-28"` | `getRequestOptions` called with 3rd arg; `details` has metadata |
| Proxy call without `protocolVersion` | `getRequestOptions` called with 2 args (or `undefined` 3rd); no `_meta.protocolVersion` in request |
| Direct tool with `spec.protocolVersion` | `getRequestOptions` 3rd arg = `spec.protocolVersion` |
| Direct tool without `spec.protocolVersion` | `getRequestOptions` 3rd arg = `undefined` |
| Legacy server response (both paths) | Clean `details` without metadata keys |
| ServerInfo missing optional fields | Partial `serverInfo` captured correctly |

---

### 4.3 Test Mock Updates (Existing Auto-Auth Tests)

**Files to update:**

1. `__tests__/proxy-modes-auto-auth.test.ts`
2. `__tests__/direct-tools-auto-auth.test.ts`

**Changes required:**

| Location | Current | Updated |
| ---------- | --------- | --------- |
| `manager.getRequestOptions` mock impl | `vi.fn(() => ({ timeout: 1234 }))` | `vi.fn((_name, _signal, _protocolVersion?) => ({ timeout: 1234 }))` |
| `manager.getRequestOptions` call assertions | `.toHaveBeenCalledWith("demo", controller.signal)` | `.toHaveBeenCalledWith("demo", controller.signal, undefined)` |
| `manager.getRequestOptions` call assertions (with protocolVersion) | N/A | `.toHaveBeenCalledWith("demo", controller.signal, "2026-07-28")` |

**Specific test assertions to update:**

**proxy-modes-auto-auth.test.ts:**

- Line ~380: `expect(manager.getRequestOptions).toHaveBeenCalledWith("demo", controller.signal, undefined);`
- Add assertions for any new tests that pass `protocolVersion` to `executeCall`

**direct-tools-auto-auth.test.ts:**

- Line ~50: `expect(state.manager.getRequestOptions).toHaveBeenCalledWith("demo", controller.signal);`
- Change to: `expect(state.manager.getRequestOptions).toHaveBeenCalledWith("demo", controller.signal, undefined);`
- Line ~130: same change

**Note:** All existing tests call `executeCall`/`createDirectToolExecutor` without the new `protocolVersion` argument, so the 3rd argument will be `undefined`. The mock implementations must accept 3 parameters to avoid "mock function called with 3 arguments but expected 2" errors.

---

## 5. Implementation Sequence

1. **`types.ts`** — Add `McpCallToolResultMeta` interface and `protocolVersion` to `DirectToolSpec`
2. **`server-manager.ts`** — Extend `getRequestOptions` and `buildRequestOptions` with 3rd param
3. **`proxy-modes.ts`** — Extend `executeCall` with 8th param; add metadata capture
4. **`direct-tools.ts`** — Thread `spec.protocolVersion`; add metadata capture
5. **Update auto-auth test mocks** — Accept 3-arg signature; update assertions
6. **Add unit tests** — `mcp-2026-metadata-capture.test.ts`
7. **Add integration test** — `mcp-2026-metadata-integration.test.ts`
8. **Run type check + all tests** — Verify success criteria

---

## 6. Rollback Plan

Revert these 6 files:

- `types.ts`
- `server-manager.ts`
- `proxy-modes.ts`
- `direct-tools.ts`
- `__tests__/proxy-modes-auto-auth.test.ts`
- `__tests__/direct-tools-auto-auth.test.ts`

Plus delete 2 new test files:

- `__tests__/mcp-2026-metadata-capture.test.ts`
- `__tests__/mcp-2026-metadata-integration.test.ts`

No database migrations, config changes, or external dependencies. All new parameters are optional; omitting them preserves legacy behavior.

---

## 7. Success Criteria Verification

| Criterion | Verification Method |
| ----------- | --------------------- |
| Type check passes | `npm run typecheck` (or `tsc --noEmit`) |
| `executeCall` threads `protocolVersion` | Spy on `getRequestOptions`; verify 3rd arg in new unit test |
| `createDirectToolExecutor` threads `spec.protocolVersion` | Spy on `getRequestOptions`; verify 3rd arg in new unit test |
| Result metadata surfaced (both paths) | Integration test with mock 2026-07-28 response |
| Legacy servers produce clean `details` | Unit + integration tests with legacy response shape |
| Auto-auth tests pass | `vitest run __tests__/proxy-modes-auto-auth.test.ts __tests__/direct-tools-auto-auth.test.ts` |
| Integration test passes | `vitest run __tests__/mcp-2026-metadata-integration.test.ts` |

---

## 8. Open Questions from Proposal (Resolved)

| Question | Decision |
| ---------- | ---------- |
| `executeCall` 8th param vs options object | **8th parameter** — matches existing pattern; avoids breaking callers; `protocolVersion` is the only new thread-through |
| `DirectToolSpec.protocolVersion` default | **`undefined` (no pinning)** — explicit opt-in; proxy path also requires explicit arg |
| Integration test for metadata | **Required** — added as `__tests__/mcp-2026-metadata-integration.test.ts` |
| `serverInfo` shape (subset vs full) | **Typed subset** (`name`, `version`, `protocolVersion`) — matches MCP spec core fields; extra fields ignored |
| Version mismatch warning | **No adapter warning** — SDK error is sufficient; callers should pin only when known supported |

---
