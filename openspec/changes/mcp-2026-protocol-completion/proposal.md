# SDD Proposal: MCP 2026-07-28 Protocol Completion

## Intent

Complete the MCP 2026-07-28 protocol support in pi-mcp-adapter by fixing a deprecated capability bug (Priority 0) and implementing the remaining client-facing features (Priority 2), while explicitly documenting the out-of-scope architectural changes (Priority 3) that would break the "token-efficient MCP adapter" identity.

---

## Change ID

`mcp-2026-protocol-completion`

---

## 1. Problem Statement

The **MCP 2026-07-28 protocol** support in pi-mcp-adapter has its core plumbing complete (via `mcp-2026-protocol-support` and `mcp-2026-protocol-followup` SDDs), but two gaps remain:

### P0 — Bug: Deprecated Capability Advertised

`server-manager.ts:buildClientCapabilities()` unconditionally includes `sampling: {}` when a sampling config exists. However, **sampling is explicitly deprecated in the 2026-07-28 spec** (use LLM provider APIs instead). For pinned `protocolVersion === "2026-07-28"` connections, this capability MUST NOT be advertised — it signals legacy behavior and may confuse servers that check client capabilities.

### P2 — Missing Client-Facing Features (No Architecture Change)

Five features from the 2026-07-28 spec are not yet surfaced through the adapter. These are additive, non-breaking, and align with the "token-efficient MCP adapter" identity (no transport/auth rewrites, no state machine changes):

| Feature | Spec Section | Value |
| --------- | -------------- | ------- |
| **Structured Content** | `tools/call` → `structuredContent` + `outputSchema` | Typed, validated tool results |
| **Resource Templates** | `resources/templates/list` | Parametrized resource discovery |
| **Completions** | `completions` capability | Argument autocompletion for tool calls |
| **Progress Notifications** | `notifications/progress` | Long-running tool feedback |
| **Resource Links / Embedded Resources** | Tool result content types `resource_link` / `resource` | Rich result handling |

### P3 — Explicitly Out of Scope (Architectural Changes)

These require fundamental changes to the adapter's request/response model and are **not** part of this change. Documented here to prevent scope creep:

| Feature | Why Out of Scope |
| --------- | ------------------ |
| **MRTR (Multi Round-Trip Requests)** | Changes tool calls to multi-turn with state (`input_required`, `inputResponses`, `requestState`) |
| **subscriptions/listen** | Replaces `listChanged` callbacks with single POST stream |
| **Extensions** (`io.modelcontextprotocol/tasks`, `io.modelcontextprotocol/ui`) | New capability extension system; scope creep |

> **Rule**: Implement Priority 3 only if an MCP server/client (e.g., Toolbelt Gateway) blocks or explicitly requests via issue. The adapter's identity as a *token-efficient* adapter means we don't add heavyweight state machines speculatively.

---

## 2. Proposed Solution

### 2.1 P0 Fix — Remove `sampling` Capability for 2026-07-28

**File**: `server-manager.ts`

Modify `buildClientCapabilities()` to accept the server's negotiated/protocol version and conditionally omit `sampling` when `protocolVersion === "2026-07-28"`.

```typescript
private buildClientCapabilities(protocolVersion?: string) {
  const capabilities: Record<string, unknown> = {};

  if (this.elicitationConfig) {
    capabilities.elicitation = {
      form: {},
      ...(this.elicitationConfig.allowUrl ? { url: {} } : {}),
    };
  }

  // sampling is DEPRECATED in 2026-07-28 — do not advertise for pinned connections
  if (this.samplingConfig && protocolVersion !== "2026-07-28") {
    capabilities.sampling = {};
  }

  return capabilities;
}
```

Call sites (`createClient` for stdio/Unix, `connectHttpClient` for HTTP) pass the negotiated/pinned version.

---

### 2.2 P2 Features — Type Definitions (`types.ts`)

Add interfaces for the five new features. All fields optional; surface-only (no validation logic yet).

```typescript
// Structured Content
export interface McpStructuredContent {
  /** Typed structured output from tool (validated against outputSchema if present) */
  structuredContent?: Record<string, unknown>;
  /** JSON Schema for structuredContent validation (optional, advisory) */
  outputSchema?: Record<string, unknown>;
}

// Resource Templates
export interface McpResourceTemplate {
  uriTemplate: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface ListResourceTemplatesResult {
  resourceTemplates: McpResourceTemplate[];
  nextCursor?: string;
}

// Completions
export interface McpCompletionArgument {
  name: string;
  value: string;
}

export interface McpCompletionContext {
  arguments?: McpCompletionArgument[];
}

export interface McpCompletionResult {
  completion: {
    values: string[];
    total?: number;
    hasMore?: boolean;
  };
}

// Progress Notifications
export interface McpProgressNotification {
  progressToken: string | number;
  progress: number;
  total?: number;
  message?: string;
}

// Resource Links / Embedded Resources (tool result content types)
export type McpResourceLinkContent = {
  type: "resource_link";
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
};

export type McpEmbeddedResourceContent = {
  type: "resource";
  resource: {
    uri: string;
    text?: string;
    blob?: string;
    mimeType?: string;
  };
};

// Extend McpContent to include new types
export interface McpContent {
  type: "text" | "image" | "audio" | "resource" | "resource_link";
  text?: string;
  data?: string;
  mimeType?: string;
  resource?: {
    uri: string;
    text?: string;
    blob?: string;
  };
  uri?: string;
  name?: string;
  description?: string;
}
```

Also extend `McpCallToolResultMeta` to include new fields:

```typescript
export interface McpCallToolResultMeta {
  protocolVersion?: string;
  structuredContent?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  progressToken?: string | number; // for progress correlation
}
```

---

### 2.3 P2 Features — Server Manager (`server-manager.ts`)

#### 2.3.1 Resource Templates

Add `fetchAllResourceTemplates` (parallel to `fetchAllResources`), call during connection if server advertises `resources.templates` capability.

```typescript
private async fetchAllResourceTemplates(
  client: Client,
  requestOptions?: RequestOptions,
): Promise<McpResourceTemplate[]> {
  const capabilities = client.getServerCapabilities?.();
  if (!capabilities?.resources?.templates) return [];

  const allTemplates: McpResourceTemplate[] = [];
  let cursor: string | undefined;
  do {
    const result = await client.request(
      { method: "resources/templates/list", params: cursor ? { cursor } : {} },
      requestOptions,
    );
    allTemplates.push(...(result.resourceTemplates ?? []));
    cursor = result.nextCursor;
  } while (cursor);
  return allTemplates;
}
```

Store on `ServerConnection.resourceTemplates`.

#### 2.3.2 Completions

Add `complete` method forwarding to SDK `client.complete` (or `client.request` with `completions/complete`).

```typescript
async complete(
  name: string,
  ref: { type: "ref/prompt" | "ref/resource"; name: string },
  argument: { name: string; value: string },
  signal?: AbortSignal,
): Promise<McpCompletionResult> {
  const connection = this.connections.get(name);
  if (!connection || connection.status !== "connected") {
    throw new Error(`Server "${name}" is not connected`);
  }
  if (!connection.client.getServerCapabilities?.()?.completions) {
    throw new Error(`Server "${name}" does not support completions`);
  }
  this.touch(name);
  this.incrementInFlight(name);
  try {
    return await connection.client.complete(
      { ref, argument },
      this.getRequestOptions(name, signal),
    );
  } finally {
    this.decrementInFlight(name);
    this.touch(name);
  }
}
```

#### 2.3.3 Progress Notifications

Register `notifications/progress` handler on client (similar to existing `notifications/elicitation/complete` handler). Emit to a new listener map `progressListeners: Map<string, (notification) => void>`.

---

### 2.4 P2 Features — Proxy Modes (`proxy-modes.ts`)

#### 2.4.1 Structured Content

In `executeCall`: capture `result.structuredContent`, `result.outputSchema`, and `result._meta?.progressToken` from SDK response. Surface in `ProxyToolResult.details`.

#### 2.4.2 Progress Notifications

If `progressToken` present in request options, register a one-shot listener for `notifications/progress` with that token. Surface progress updates via Pi notification system (question below).

---

### 2.5 P2 Features — Direct Tools (`direct-tools.ts`)

Mirror proxy changes: capture structured content, progress token in `createDirectToolExecutor` result `details`.

---

### 2.6 P2 Features — Metadata Cache (`metadata-cache.ts`)

Optional: cache `resourceTemplates` in `ServerCacheEntry` for fast startup. Low priority — only if templates are large.

---

### 2.7 Documentation — MCP_2026_PARITY_ANALYSIS.md

Update the parity matrix:

- Move P0 fix to "Done"
- Move implemented P2 features to "Done"
- Keep P3 as "Blocked / On-Demand"

---

## 3. Scope Boundaries

### In Scope

| Area | Changes |
| ------ | --------- |
| **types.ts** | New interfaces: `McpStructuredContent`, `McpResourceTemplate`, `McpCompletionResult`, `McpProgressNotification`, `McpResourceLinkContent`, `McpEmbeddedResourceContent`; extend `McpContent`, `McpCallToolResultMeta` |
| **server-manager.ts** | `buildClientCapabilities(protocolVersion)` fix; `fetchAllResourceTemplates`; `complete()` method; progress notification handler; store `resourceTemplates` on connection |
| **proxy-modes.ts** | Capture `structuredContent`, `outputSchema`, `progressToken` in `executeCall`; surface in result `details` |
| **direct-tools.ts** | Same capture/surface as proxy |
| **metadata-cache.ts** | Optional: persist `resourceTemplates` |
| **MCP_2026_PARITY_ANALYSIS.md** | Update completion status |

### Out of Scope

| Feature | Reason |
| --------- | -------- |
| MRTR (Multi Round-Trip Requests) | Architecture change; requires stateful request/response |
| subscriptions/listen | Replaces `listChanged`; architecture change |
| Extensions (Tasks, UI) | Scope creep; no client demand |
| Structured Content **validation** | Surface only; validation is a separate feature |
| Progress **UI integration** | Surface only; Pi notification routing is separate |
| Completions **UI integration** | Expose raw; Pi select/input integration is separate |
| Resource Templates **Pi resource exposure** | Separate API; see questions |

---

## 4. Affected Areas

| Module | Change Type |
| -------- | ------------- |
| `types.ts` | Additive type definitions |
| `server-manager.ts` | Capability fix + new capability handlers |
| `proxy-modes.ts` | Result metadata surfacing |
| `direct-tools.ts` | Result metadata surfacing |
| `metadata-cache.ts` | Optional cache extension |
| `MCP_2026_PARITY_ANALYSIS.md` | Documentation update |

---

## 5. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
| ------ | ------------ | -------- | ------------ |
| Sampling capability removal breaks legacy servers | Low | Medium | Only removed when `protocolVersion === "2026-07-28"` (pinned); legacy/auto unaffected |
| SDK doesn't expose `client.complete` or `resources/templates/list` | Low | High | Use `client.request` with raw method names as fallback |
| Progress notifications fire before listener registered | Medium | Low | Register listener before call; use token correlation |
| Resource link/embedded content types not in SDK types | Medium | Low | Define local types; SDK returns `unknown` content blocks |
| Cache version bump for resourceTemplates | Low | Low | Optional; only if templates cached |

---

## 6. Rollback

Revert the 5–6 modified source files. No database migrations, config changes, or external dependencies. All new fields are optional; omitting them preserves existing behavior. The sampling capability fix is guarded by version check — reverting restores legacy behavior for all versions.

---

## 7. Success Criteria

| Criterion | Verification |
| ----------- | -------------- |
| **P0 Fix**: `sampling` NOT advertised for `protocolVersion: "2026-07-28"` | Unit test: `buildClientCapabilities("2026-07-28")` returns no `sampling` key; `buildClientCapabilities("legacy")` returns `sampling` when config exists |
| **Structured Content**: `structuredContent` + `outputSchema` surfaced in proxy/direct results | Execute tool on 2026-07-28 server returning structured content; verify `details.structuredContent` and `details.outputSchema` present |
| **Resource Templates**: `resources/templates/list` works | Connect to server advertising templates; call `manager.listResourceTemplates(name)`; returns typed array |
| **Completions**: `completions/complete` works | Call `manager.complete(name, ref, argument)`; returns `McpCompletionResult` |
| **Progress Notifications**: `notifications/progress` received | Long-running tool emits progress; listener receives `McpProgressNotification` |
| **Resource Links/Embedded**: Typed content in tool results | Tool returns `resource_link`/`resource` content; `details.content` includes typed objects |
| **TypeScript typecheck passes** | `npm run typecheck` (or `tsc --noEmit`) exits 0 |
| **No regression: 74 MCP 2026-07-28 tests pass** | `npm test -- --filter mcp-2026` (or equivalent) |
| **No regression: 37 legacy server-manager tests pass** | `npm test -- --filter server-manager` |
| **Toolbelt Gateway compatibility maintained** | Manual or integration test against gateway |

---

## 8. Implementation Sequence

1. **Types** (`types.ts`) — Foundation for all downstream changes
2. **P0 Fix** (`server-manager.ts:buildClientCapabilities`) — Bug fix first
3. **Server Manager** (`server-manager.ts`) — Resource Templates, Completions, Progress handlers
4. **Proxy Modes** (`proxy-modes.ts`) — Structured Content, Progress surfacing
5. **Direct Tools** (`direct-tools.ts`) — Same as proxy
6. **Metadata Cache** (`metadata-cache.ts`) — Optional template caching
7. **Documentation** (`MCP_2026_PARITY_ANALYSIS.md`) — Update parity matrix
8. **Tests** — Add coverage for new features

---

## 9. Proposal Question Round

Before finalizing, I want to clarify a few product/engineering decisions:

### 1. Structured Content validation: surface only, or validate against `outputSchema`?

- **Surface only** (proposed): Adapter returns `structuredContent` + `outputSchema` in `details`; validation left to caller/LLM. Zero dependencies, minimal code.
- **Validate**: Adapter validates `structuredContent` against `outputSchema` (JSON Schema); surfaces validation errors. Adds `ajv` or similar; fails closed.

**Tradeoff**: Validation adds weight; surface-only keeps adapter token-efficient.

### 2. Progress notifications: expose as Pi notifications, or just log?

- **Pi notifications** (proposed): Emit via Pi's notification system (toast/inline) so user sees progress on long-running tools.
- **Log only**: Emit to debug log; no UI surface. Simpler, but loses user-facing value.

**Tradeoff**: Pi notification integration requires knowing the Pi runtime context; logging is always available.

### 3. Completions: integrate with Pi's UI `select`/`input`, or just expose raw?

- **Raw exposure** (proposed): `manager.complete()` returns `McpCompletionResult`; Pi UI layer decides how to use it (autocomplete in select, inline suggestions, etc.).
- **UI integration**: Adapter provides helper that plugs into Pi's `select` component. Couples adapter to Pi UI internals.

**Tradeoff**: Raw exposure keeps adapter decoupled; UI integration is a Pi-layer concern.

### 4. Resource Templates: expose as Pi resources, or separate API?

- **Separate API** (proposed): `manager.listResourceTemplates(name)` returns `McpResourceTemplate[]`; distinct from `listResources`. Templates are parametrized — they need arguments to resolve to a concrete resource.
- **As Pi resources**: Flatten templates into resource list with templated URIs. Loses parameter info; may confuse users.

**Tradeoff**: Separate API preserves template semantics; Pi resource system expects concrete URIs.

---

## 10. Success Metrics

- P0 bug fixed: No sampling capability advertised for pinned 2026-07-28 connections
- All 5 P2 features functional with Toolbelt Gateway and other 2026-07-28 servers
- Zero regressions on existing test suites (74 + 37 tests)
- TypeScript typecheck clean
- P3 architectural changes remain documented but unimplemented — no scope creep
