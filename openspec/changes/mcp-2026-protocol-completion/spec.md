# Delta for MCP 2026-07-28 Protocol Completion

## ADDED Requirements

### Requirement: Sampling Capability Omission for 2026-07-28 Protocol Version

The `buildClientCapabilities` method MUST accept an optional `protocolVersion` parameter and MUST NOT include the `sampling` capability when `protocolVersion === "2026-07-28"`.

#### Scenario: Pinned 2026-07-28 connection omits sampling capability

- GIVEN a server configuration with `samplingConfig` defined
- WHEN `buildClientCapabilities("2026-07-28")` is called
- THEN the returned capabilities object MUST NOT contain a `sampling` key
- AND `elicitation` capability is still included when `elicitationConfig` exists

#### Scenario: Legacy/auto connection includes sampling capability

- GIVEN a server configuration with `samplingConfig` defined
- WHEN `buildClientCapabilities("legacy")` is called (or `undefined`, `"auto"`, or any version !== `"2026-07-28"`)
- THEN the returned capabilities object MUST contain `sampling: {}`

#### Scenario: No sampling config never adds sampling capability

- GIVEN a server configuration without `samplingConfig`
- WHEN `buildClientCapabilities("2026-07-28")` is called
- THEN the returned capabilities object MUST NOT contain a `sampling` key (regardless of version)

---

### Requirement: Structured Content Surface in Tool Results

The system MUST capture `structuredContent` and `outputSchema` from the SDK `CallToolResult` and surface them in the tool result `details` for both proxy and direct tool execution paths. NO validation against `outputSchema` is performed.

#### Scenario: Proxy tool call returns structured content

- GIVEN a 2026-07-28 server that returns `CallToolResult` with `structuredContent: { "result": 42 }` and `outputSchema: { "type": "object", "properties": { "result": { "type": "number" } } }`
- WHEN `executeCall` completes the tool invocation
- THEN the `ProxyToolResult.details` MUST include `structuredContent: { "result": 42 }` and `outputSchema: { "type": "object", ... }`

#### Scenario: Direct tool call returns structured content

- GIVEN a 2026-07-28 server that returns `CallToolResult` with `structuredContent` and `outputSchema`
- WHEN a direct tool executes via `createDirectToolExecutor`
- THEN the `AgentToolResult.details` MUST include `structuredContent` and `outputSchema`

#### Scenario: Legacy server without structured content does not add fields

- GIVEN a legacy server returning standard `CallToolResult` without `structuredContent` or `outputSchema`
- WHEN a tool call completes (proxy or direct)
- THEN the result `details` MUST NOT contain `structuredContent` or `outputSchema` keys

---

### Requirement: Resource Templates Discovery (Separate API)

The system MUST provide a separate API for discovering resource templates, distinct from the resources API. Templates are parametrized and require arguments to resolve to concrete resources.

#### Scenario: Server connection stores resource templates

- GIVEN a server that advertises `resources.templates` capability
- WHEN the connection is established
- THEN `ServerConnection.resourceTemplates` MUST be populated with `McpResourceTemplate[]` fetched via `resources/templates/list` with pagination

#### Scenario: List resource templates via manager

- GIVEN a connected server `"example"` with resource templates
- WHEN `manager.listResourceTemplates("example")` is called
- THEN it MUST return `Promise<McpResourceTemplate[]>` with typed templates
- AND each template MUST have `uriTemplate`, `name`, and optional `description`, `mimeType`

#### Scenario: Server without templates capability returns empty array

- GIVEN a connected server that does NOT advertise `resources.templates` capability
- WHEN `manager.listResourceTemplates("example")` is called
- THEN it MUST return an empty array `[]` without error

#### Scenario: Resource templates fetched with pagination

- GIVEN a server with many resource templates requiring pagination
- WHEN `fetchAllResourceTemplates` is called during connection
- THEN it MUST iterate all pages using `nextCursor` until complete
- AND return the combined `McpResourceTemplate[]`

---

### Requirement: Completions Raw Exposure

The system MUST expose a raw `complete` method on `McpServerManager` that forwards to the SDK `client.complete()` or raw `client.request({ method: "completions/complete" })`. NO UI integration; caller decides how to use completion values.

#### Scenario: Completion request succeeds

- GIVEN a connected server `"example"` that advertises `completions` capability
- WHEN `manager.complete("example", { type: "ref/prompt", name: "my-prompt" }, { name: "arg1", value: "part" }, signal)` is called
- THEN it MUST return `McpCompletionResult` with `completion: { values: string[], total?: number, hasMore?: boolean }`

#### Scenario: Server without completions capability throws

- GIVEN a connected server that does NOT advertise `completions` capability
- WHEN `manager.complete(...)` is called
- THEN it MUST throw `Error: Server "example" does not support completions`

#### Scenario: Disconnected server throws

- GIVEN a server name that is not connected
- WHEN `manager.complete(...)` is called
- THEN it MUST throw `Error: Server "example" is not connected`

---

### Requirement: Progress Notifications via Pi Notification System

The system MUST register a `notifications/progress` handler on the SDK client (similar to existing elicitation handler), correlate notifications by `progressToken`, and surface progress updates via the Pi notification system.

#### Scenario: Long-running tool emits progress notifications

- GIVEN a tool call that includes `progressToken: "token-123"` in request options
- WHEN the server emits `notifications/progress` with `{ progressToken: "token-123", progress: 50, total: 100, message: "Processing..." }`
- THEN the registered listener for `"token-123"` MUST receive `McpProgressNotification`
- AND the progress MUST be surfaced via Pi notification system (toast/inline)

#### Scenario: Progress listener cleanup after completion

- GIVEN a tool call with `progressToken` that registers a one-shot listener
- WHEN the tool call completes (success or error)
- THEN the listener for that `progressToken` MUST be removed from `progressListeners` map

#### Scenario: Progress without total shows indeterminate progress

- GIVEN a progress notification with `progress: 50` but no `total`
- WHEN surfaced via Pi notifications
- THEN it MUST be displayed as indeterminate progress (no percentage)

---

### Requirement: Resource Links and Embedded Resources in Tool Results

The system MUST extend `McpContent` to include `resource_link` and `resource` content types, and proxy/direct tools MUST capture these typed content blocks in result `details.content`.

#### Scenario: Tool returns resource_link content

- GIVEN a tool result with content block `{ type: "resource_link", uri: "file:///data.csv", name: "data.csv", mimeType: "text/csv" }`
- WHEN the tool call completes (proxy or direct)
- THEN `details.content` MUST include the typed `McpResourceLinkContent` object

#### Scenario: Tool returns embedded resource content

- GIVEN a tool result with content block `{ type: "resource", resource: { uri: "file:///image.png", blob: "base64...", mimeType: "image/png" } }`
- WHEN the tool call completes (proxy or direct)
- THEN `details.content` MUST include the typed `McpEmbeddedResourceContent` object

---

## MODIFIED Requirements

### Requirement: buildClientCapabilities Signature Change

The `buildClientCapabilities` method in `server-manager.ts` MUST accept an optional `protocolVersion` parameter.

```typescript
private buildClientCapabilities(protocolVersion?: string): Record<string, unknown>
```

(Previously: `private buildClientCapabilities(): Record<string, unknown>` with no parameters)

#### Scenario: Call sites pass negotiated protocol version

- GIVEN `createClient` (stdio/Unix) or `connectHttpClient` (HTTP) establishing a connection
- WHEN calling `buildClientCapabilities`
- THEN they MUST pass the negotiated/pinned protocol version (e.g., `"2026-07-28"`, `"legacy"`, or `undefined` for auto)

---

### Requirement: McpCallToolResultMeta Extended with Structured Content and Progress Token

The `McpCallToolResultMeta` interface MUST be extended with optional `structuredContent`, `outputSchema`, and `progressToken` fields.

```typescript
export interface McpCallToolResultMeta {
  protocolVersion?: string;
  structuredContent?: Record<string, unknown>;  // NEW
  outputSchema?: Record<string, unknown>;       // NEW
  progressToken?: string | number;              // NEW
}
```

(Previously: `McpCallToolResultMeta` had only `protocolVersion`)

#### Scenario: Result metadata includes new fields

- GIVEN an SDK `CallToolResult` with `structuredContent`, `outputSchema`, and `_meta.progressToken`
- WHEN processed by `executeCall` or `createDirectToolExecutor`
- THEN `McpCallToolResultMeta` is populated with all three new fields

---

### Requirement: McpContent Extended with Resource Link and Resource Types

The `McpContent` type MUST include `resource_link` and `resource` as valid `type` values with corresponding fields.

```typescript
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

(Previously: `type` was `"text" | "image" | "audio"` only; `resource`/`resource_link` fields did not exist)

#### Scenario: Content type discriminated union works for new types

- GIVEN a content array containing mixed `text`, `resource_link`, and `resource` blocks
- WHEN TypeScript narrows by `content.type`
- THEN all fields for each type are correctly typed

---

### Requirement: ServerConnection Extended with resourceTemplates

The `ServerConnection` interface MUST include a `resourceTemplates` field.

```typescript
export interface ServerConnection {
  // ... existing fields ...
  resourceTemplates: McpResourceTemplate[];  // NEW
}
```

(Previously: `ServerConnection` had no `resourceTemplates` field)

#### Scenario: Connection stores fetched templates

- GIVEN a successful connection to a server with `resources.templates` capability
- WHEN `fetchAllResourceTemplates` completes
- THEN `connection.resourceTemplates` is populated with the fetched templates

---

## REMOVED Requirements

None. All changes are additive or modifications to existing interfaces.

---

## Migration Notes

### TypeScript Type Changes

The following type changes are **additive only** (new optional fields, extended unions). Existing code compiles without changes:

- `McpCallToolResultMeta`: 3 new optional fields
- `McpContent`: 2 new union members + associated fields
- `ServerConnection`: 1 new required field (initialized to `[]` on connection)
- `buildClientCapabilities`: 1 new optional parameter

### Call Site Updates Required

Call sites of `buildClientCapabilities` MUST be updated to pass the protocol version:

| Call Site | File | Change |
| ----------- | ------ | -------- |
| `createClient` (stdio) | `server-manager.ts` | Pass `resolvedVersion` |
| `createClient` (Unix) | `server-manager.ts` | Pass `resolvedVersion` |
| `connectHttpClient` | `server-manager.ts` | Pass `resolvedVersion` |

### Cache Version (Optional)

If `metadata-cache.ts` is updated to persist `resourceTemplates`, increment `CACHE_VERSION` from current value to next integer. This change is optional and only needed if template caching is implemented.

---

## Acceptance Criteria (Verifiable Test Cases)

| # | Criterion | Verification |
| --- | ----------- | -------------- |
| 1 | **P0 Fix**: `sampling` NOT advertised for `protocolVersion: "2026-07-28"` | Unit test: `buildClientCapabilities("2026-07-28")` returns no `sampling` key |
| 2 | **P0 Fix**: `sampling` advertised for legacy versions | Unit test: `buildClientCapabilities("legacy")` returns `sampling` when config exists |
| 3 | **Structured Content**: `structuredContent` + `outputSchema` surfaced in proxy results | Execute tool on 2026-07-28 server returning structured content; verify `details.structuredContent` and `details.outputSchema` present |
| 4 | **Structured Content**: `structuredContent` + `outputSchema` surfaced in direct results | Invoke direct tool on 2026-07-28 server; verify `details.structuredContent` and `details.outputSchema` present |
| 5 | **Structured Content**: No validation against `outputSchema` | Tool returns `structuredContent` that violates `outputSchema`; adapter surfaces both without error |
| 6 | **Resource Templates**: `manager.listResourceTemplates(name)` returns typed array | Connect to server advertising templates; call method; returns `McpResourceTemplate[]` |
| 7 | **Resource Templates**: Pagination handled during connection | Server returns paginated templates; `fetchAllResourceTemplates` returns all pages combined |
| 8 | **Completions**: `manager.complete(name, ref, argument)` returns `McpCompletionResult` | Call on server with completions capability; verify typed result with `values`, `total`, `hasMore` |
| 9 | **Completions**: Throws on server without capability | Call on server without completions; verify thrown error message |
| 10 | **Progress Notifications**: Listener receives `McpProgressNotification` | Long-running tool emits progress; listener receives notification with `progressToken`, `progress`, `total?`, `message?` |
| 11 | **Progress Notifications**: Surfaced via Pi notification system | Progress notification triggers Pi toast/inline notification (manual/integration test) |
| 12 | **Resource Links**: `resource_link` content typed in `details.content` | Tool returns `resource_link` block; verify typed object in result `details.content` |
| 13 | **Embedded Resources**: `resource` content typed in `details.content` | Tool returns `resource` block; verify typed object in result `details.content` |
| 14 | **TypeScript typecheck passes** | `npm run typecheck` (or `tsc --noEmit`) exits 0 |
| 15 | **No regression: 74 MCP 2026-07-28 tests pass** | `npm test -- --filter mcp-2026` (or equivalent) |
| 16 | **No regression: 37 legacy server-manager tests pass** | `npm test -- --filter server-manager` |

---

## Implementation Sequence (from Proposal)

1. **Types** (`types.ts`) — Foundation: new interfaces, extended types
2. **P0 Fix** (`server-manager.ts:buildClientCapabilities`) — Bug fix first
3. **Server Manager** (`server-manager.ts`) — Resource Templates, Completions, Progress handlers, `resourceTemplates` storage
4. **Proxy Modes** (`proxy-modes.ts`) — Structured Content, Progress surfacing in `executeCall`
5. **Direct Tools** (`direct-tools.ts`) — Same capture/surface as proxy
6. **Metadata Cache** (`metadata-cache.ts`) — Optional: persist `resourceTemplates`
7. **Documentation** (`MCP_2026_PARITY_ANALYSIS.md`) — Update parity matrix
8. **Tests** — Add coverage for new features

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
| ------ | ------------ | -------- | ------------ |
| Sampling capability removal breaks legacy servers | Low | Medium | Only removed when `protocolVersion === "2026-07-28"` (pinned); legacy/auto unaffected |
| SDK doesn't expose `client.complete` or `resources/templates/list` | Low | High | Use `client.request` with raw method names as fallback |
| Progress notifications fire before listener registered | Medium | Low | Register listener before call; use token correlation |
| Resource link/embedded content types not in SDK types | Medium | Low | Define local types; SDK returns `unknown` content blocks |
| Cache version bump for resourceTemplates | Low | Low | Optional; only if templates cached |
| Per-request `protocolVersion` in call options conflicts with connection version | Low | Medium | SDK validates; surface errors clearly; document as advanced option |

---

## Out of Scope (Reaffirmed from Proposal)

| Feature | Reason |
| --------- | -------- |
| MRTR (Multi Round-Trip Requests) | Architecture change; requires stateful request/response |
| subscriptions/listen | Replaces `listChanged`; architecture change |
| Extensions (Tasks, UI) | Scope creep; no client demand |
| Structured Content **validation** | Surface only; validation is a separate feature |
| Progress **UI integration** | Surface only; Pi notification routing is separate |
| Completions **UI integration** | Expose raw; Pi select/input integration is separate |
| Resource Templates **Pi resource exposure** | Separate API; templates are parametrized, need arguments to resolve |
