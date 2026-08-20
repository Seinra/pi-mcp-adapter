# MCP 2026-07-28 Protocol Follow-up Specification

## Purpose

Complete the MCP 2026-07-28 protocol support by implementing the remaining pieces from the main `mcp-2026-protocol-support` change. This spec defines the types, signatures, and behavior for threading `protocolVersion` through the call chain and capturing `resultType`/`serverInfo` from response metadata in both proxy and direct tool paths.

## Requirements

### Requirement: McpCallToolResultMeta Type Definition

The system MUST define a `McpCallToolResultMeta` interface in `types.ts` that models the `_meta` field of an MCP 2026-07-28 `CallToolResult`.

#### Scenario: Type constructs with all fields present

- GIVEN a `McpCallToolResultMeta` object with `resultType: "data"` and `serverInfo: { name: "test", version: "1.0", protocolVersion: "2026-07-28" }`
- WHEN the type is used to type a response metadata object
- THEN TypeScript accepts the object without errors

#### Scenario: Type constructs with no fields present

- GIVEN an empty object `{}` cast as `McpCallToolResultMeta`
- WHEN the type is used
- THEN TypeScript accepts the object (all fields are optional)

#### Scenario: resultType accepts only valid literal values

- GIVEN a `McpCallToolResultMeta` with `resultType: "invalid"`
- WHEN TypeScript type-checks the code
- THEN a type error is reported (only "data" | "error" | "resource" | "ui" allowed)

### Requirement: DirectToolSpec.protocolVersion Field

The system MUST add an optional `protocolVersion?: string` field to `DirectToolSpec` in `types.ts` that defaults to `undefined` (no pinning).

#### Scenario: DirectToolSpec accepts protocolVersion

- GIVEN a `DirectToolSpec` object with `protocolVersion: "2026-07-28"`
- WHEN the spec is passed to `createDirectToolExecutor`
- THEN TypeScript accepts the object and the value is available on the spec

#### Scenario: DirectToolSpec omits protocolVersion

- GIVEN a `DirectToolSpec` object without `protocolVersion`
- WHEN the spec is passed to `createDirectToolExecutor`
- THEN TypeScript accepts the object and `spec.protocolVersion` is `undefined`

### Requirement: server-manager.ts getRequestOptions/buildRequestOptions Accept protocolVersion

The system MUST extend `getRequestOptions` and `buildRequestOptions` in `server-manager.ts` to accept an optional third parameter `protocolVersion?: string` and include it in the request `_meta.protocolVersion` when provided.

#### Scenario: getRequestOptions called with protocolVersion

- GIVEN a server definition and `protocolVersion: "2026-07-28"`
- WHEN `getRequestOptions(name, signal, "2026-07-28")` is called
- THEN the returned options include `_meta: { protocolVersion: "2026-07-28" }`

#### Scenario: getRequestOptions called without protocolVersion

- GIVEN a server definition
- WHEN `getRequestOptions(name, signal)` or `getRequestOptions(name, signal, undefined)` is called
- THEN the returned options do NOT include `_meta.protocolVersion` (or include it as undefined)

#### Scenario: buildRequestOptions called with protocolVersion

- GIVEN a tool definition, signal, and `protocolVersion: "2026-07-28"`
- WHEN `buildRequestOptions(definition, signal, "2026-07-28")` is called
- THEN the returned options include `_meta: { protocolVersion: "2026-07-28" }`

#### Scenario: Legacy callers work unchanged

- GIVEN existing code calling `getRequestOptions(name, signal)` with two arguments
- WHEN the code executes
- THEN it continues to work without modification (third parameter is optional)

### Requirement: proxy-modes.ts executeCall Threads protocolVersion and Captures Metadata

The system MUST update `executeCall` in `proxy-modes.ts` to:

1. Accept an optional 8th parameter `protocolVersion?: string` after `origin`
2. Thread `protocolVersion` to `getRequestOptions` as the third argument
3. Capture `result.resultType` and `result._meta?.serverInfo` from the response into `details`

#### Scenario: executeCall called with protocolVersion

- GIVEN a proxy call state, tool name, args, and `protocolVersion: "2026-07-28"`
- WHEN `executeCall(state, toolName, args, serverOverride, getPiTools, signal, origin, "2026-07-28")` is called
- THEN `getRequestOptions` is invoked with the protocolVersion as the third argument
- AND the returned `details` includes `resultType` and `serverInfo` when present in the response

#### Scenario: executeCall called without protocolVersion

- GIVEN a proxy call state without a protocolVersion argument
- WHEN `executeCall(state, toolName, args, serverOverride, getPiTools, signal, origin)` is called (7 arguments)
- THEN `getRequestOptions` is invoked with `undefined` as the third argument (or two arguments)
- AND the call succeeds without the protocolVersion in the request

#### Scenario: Response metadata captured from 2026-07-28 server

- GIVEN a mock server response with `{ resultType: "data", _meta: { serverInfo: { name: "test-server", version: "2.0", protocolVersion: "2026-07-28" } } }`
- WHEN `executeCall` completes
- THEN `details.resultType === "data"`
- AND `details.serverInfo === { name: "test-server", version: "2.0", protocolVersion: "2026-07-28" }`

#### Scenario: Legacy server response without metadata

- GIVEN a mock server response without `_meta` or `resultType` (legacy MCP server)
- WHEN `executeCall` completes
- THEN `details` does not contain `resultType` or `serverInfo` keys (clean omission)

### Requirement: direct-tools.ts createDirectToolExecutor Threads protocolVersion and Captures Metadata

The system MUST update `createDirectToolExecutor` in `direct-tools.ts` to:

1. Pass `spec.protocolVersion` to `getRequestOptions` as the third argument
2. Capture `result.resultType` and `result._meta?.serverInfo` from `CallToolResult` into `details`

#### Scenario: createDirectToolExecutor with protocolVersion in spec

- GIVEN a `DirectToolSpec` with `protocolVersion: "2026-07-28"`
- WHEN the executor is created and invoked
- THEN `getRequestOptions` is called with the spec's protocolVersion as the third argument
- AND the returned `AgentToolResult.details` includes `resultType` and `serverInfo` when present

#### Scenario: createDirectToolExecutor without protocolVersion in spec

- GIVEN a `DirectToolSpec` without `protocolVersion`
- WHEN the executor is created and invoked
- THEN `getRequestOptions` is called with `undefined` as the third argument
- AND the call succeeds without the protocolVersion in the request

#### Scenario: Direct tool response metadata captured

- GIVEN a `CallToolResult` with `{ resultType: "error", _meta: { serverInfo: { name: "direct-server", version: "1.5" } } }`
- WHEN the direct tool executor completes
- THEN `details.resultType === "error"`
- AND `details.serverInfo === { name: "direct-server", version: "1.5" }` (protocolVersion omitted when not present)

#### Scenario: Legacy direct tool response without metadata

- GIVEN a `CallToolResult` without `_meta` or `resultType`
- WHEN the direct tool executor completes
- THEN `details` does not contain `resultType` or `serverInfo` keys

### Requirement: Tests Updated for 3-Argument getRequestOptions Signature

The system MUST update `__tests__/proxy-modes-auto-auth.test.ts` and `__tests__/direct-tools-auto-auth.test.ts` to expect the new 3-argument `getRequestOptions(name, signal?, protocolVersion?)` signature in mocks and assertions.

#### Scenario: proxy-modes-auto-auth test mocks updated

- GIVEN the test file with mocks for `getRequestOptions`
- WHEN the tests run
- THEN mocks accept 3 arguments (name, signal, protocolVersion)
- AND assertions verify the third argument when protocolVersion is expected
- AND all existing test assertions continue to pass

#### Scenario: direct-tools-auto-auth test mocks updated

- GIVEN the test file with mocks for `getRequestOptions`
- WHEN the tests run
- THEN mocks accept 3 arguments (name, signal, protocolVersion)
- AND assertions verify the third argument is `spec.protocolVersion`
- AND all existing test assertions continue to pass

### Requirement: Integration Test for Metadata Capture

The system MUST add a lightweight integration test that exercises a mock 2026-07-28 server response with `_meta.serverInfo` and `resultType`, verifying both proxy and direct paths surface the metadata correctly.

#### Scenario: Integration test exercises proxy path metadata capture

- GIVEN a test server that returns a 2026-07-28 formatted response with `_meta.serverInfo` and `resultType`
- WHEN a proxy tool call is made through `executeCall`
- THEN the result `details` contains `resultType` and `serverInfo` matching the response

#### Scenario: Integration test exercises direct path metadata capture

- GIVEN a test server that returns a 2026-07-28 formatted response with `_meta.serverInfo` and `resultType`
- WHEN a direct tool call is made through `createDirectToolExecutor`
- THEN the result `details` contains `resultType` and `serverInfo` matching the response

#### Scenario: Integration test handles legacy server response

- GIVEN a test server that returns a legacy MCP response without `_meta` or `resultType`
- WHEN both proxy and direct calls are made
- THEN `details` objects are clean (no undefined keys, no resultType/serverInfo)

## Type Definitions

### McpCallToolResultMeta (types.ts)

```typescript
export interface McpCallToolResultMeta {
  /** The type of result returned by the tool */
  resultType?: "data" | "error" | "resource" | "ui";
  /** Server identification information */
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

### DirectToolSpec Addition (types.ts)

```typescript
export interface DirectToolSpec {
  // ... existing fields ...
  /** Optional protocol version to pin for this tool's requests. Defaults to undefined (no pinning). */
  protocolVersion?: string;
}
```

### AgentToolResult.details Extension (types.ts)

The `details` field in `AgentToolResult` MAY contain the following additional properties when the server returns 2026-07-28 metadata:

```typescript
interface AgentToolResultDetails {
  // ... existing fields ...
  /** Type of result as reported by the server (2026-07-28) */
  resultType?: "data" | "error" | "resource" | "ui";
  /** Server identification as reported by the server (2026-07-28) */
  serverInfo?: {
    name?: string;
    version?: string;
    protocolVersion?: string;
  };
}
```

## Function Signatures

### server-manager.ts

```typescript
// Existing: getRequestOptions(name: string, signal?: AbortSignal): RequestOptions
// Changed: third parameter added
function getRequestOptions(
  name: string,
  signal?: AbortSignal,
  protocolVersion?: string
): RequestOptions;

// Existing: buildRequestOptions(definition?: ToolDefinition, signal?: AbortSignal): RequestOptions
// Changed: third parameter added
function buildRequestOptions(
  definition?: ToolDefinition,
  signal?: AbortSignal,
  protocolVersion?: string
): RequestOptions;
```

### proxy-modes.ts

```typescript
// Existing: executeCall(state, toolName, args, serverOverride, getPiTools, signal, origin)
// Changed: 8th parameter added
async function executeCall(
  state: ProxyState,
  toolName: string,
  args: unknown,
  serverOverride: string | null,
  getPiTools: () => PiTool[],
  signal: AbortSignal,
  origin: string,
  protocolVersion?: string
): Promise<AgentToolResult>;
```

### direct-tools.ts

```typescript
// Existing: createDirectToolExecutor(spec, getRequestOptions, ...)
// Changed: threads spec.protocolVersion to getRequestOptions; captures metadata
function createDirectToolExecutor(
  spec: DirectToolSpec,
  getRequestOptions: (name: string, signal?: AbortSignal, protocolVersion?: string) => RequestOptions,
  // ... other params
): (args: unknown, signal?: AbortSignal) => Promise<AgentToolResult>;
```

## Test Requirements

### Unit Test Updates

| Test File | Changes |
|-----------|---------|
| `__tests__/proxy-modes-auto-auth.test.ts` | Update all `getRequestOptions` mock implementations to accept 3 arguments; update call assertions to verify 3rd argument when applicable |
| `__tests__/direct-tools-auto-auth.test.ts` | Update all `getRequestOptions` mock implementations to accept 3 arguments; update call assertions to verify 3rd argument equals `spec.protocolVersion` |

### Integration Test (New)

**File**: `__tests__/mcp-2026-metadata-integration.test.ts` (or similar)

**Coverage**:

- Mock server returning 2026-07-28 response with full `_meta.serverInfo` and `resultType`
- Proxy path: verify `details.resultType` and `details.serverInfo` populated
- Direct path: verify `details.resultType` and `details.serverInfo` populated
- Legacy response: verify clean `details` without metadata keys
- ServerInfo missing optional fields (name only, version only, etc.): verify partial capture works

## Success Criteria

1. **Type check passes** — `McpCallToolResultMeta` constructs with all/none fields; `DirectToolSpec.protocolVersion` accepted as optional string.
2. **`executeCall` threads `protocolVersion`** — Spy on `getRequestOptions`; verify 3rd argument passed when provided as 8th parameter.
3. **`createDirectToolExecutor` threads `spec.protocolVersion`** — Spy on `getRequestOptions`; verify 3rd argument is `spec.protocolVersion`.
4. **Result metadata surfaced** — Proxy and direct tool calls against a 2026-07-28 server return `details.resultType` and `details.serverInfo`; legacy servers produce clean `details` without these keys.
5. **Auto-auth tests pass** — Mocks updated to 3-arg `getRequestOptions`; all existing assertions hold.
6. **Integration test passes** — Lightweight test exercises mock 2026-07-28 server response and verifies metadata capture in both paths.

## Risks

| Risk | Likelihood | Impact | Mitigation |
| ------ | ------------ | -------- | ------------ |
| Legacy servers return `CallToolResult` without `_meta`/`resultType` | High | Low | Optional chaining; keys omitted from `details` when absent |
| `protocolVersion` mismatch between connection and request | Medium | Medium | SDK validates; error surfaces as-is; callers pin version only when server supports it |
| Test mocks break due to signature change | High | Medium | Update mocks in the two auto-auth test files; other callers use 2-arg form (optional 3rd param) |
| Type drift between proxy and direct paths | Low | Medium | Use shared `McpCallToolResultMeta` type; apply identical capture logic in both files |

## Rollback

Revert the four source files (`types.ts`, `server-manager.ts`, `proxy-modes.ts`, `direct-tools.ts`) and two test files (`__tests__/proxy-modes-auto-auth.test.ts`, `__tests__/direct-tools-auto-auth.test.ts`), plus remove the new integration test file. No database migrations, config changes, or external dependencies. The `protocolVersion` parameter is optional everywhere; omitting it preserves legacy behavior.
