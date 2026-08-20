# SDD Proposal: MCP 2026-07-28 Protocol Follow-up

## Intent

Complete the MCP 2026-07-28 protocol support by implementing the remaining pieces that were designed but not delivered in the main `mcp-2026-protocol-support` change:

1. **`direct-tools.ts`**: `createDirectToolExecutor` must capture `resultType` and `serverInfo` from `CallToolResult._meta` and surface them in `AgentToolResult.details` (matching the proxy pattern), and thread `spec.protocolVersion` to `getRequestOptions`.
2. **`proxy-modes.ts`**: `executeCall` must accept an optional `protocolVersion` parameter, thread it to `getRequestOptions`, and capture `resultType`/`serverInfo` from response metadata.
3. **`server-manager.ts`**: `getRequestOptions` and `buildRequestOptions` must accept and forward `protocolVersion` in `_meta.protocolVersion`.
4. **`types.ts`**: Add `McpCallToolResultMeta` interface for typing result metadata.
5. **Tests**: Update `__tests__/proxy-modes-auto-auth.test.ts` and `__tests__/direct-tools-auto-auth.test.ts` for the new 3-argument `getRequestOptions` signature (`name, signal?, protocolVersion?`).

---

## Scope

### In Scope

| File | Change |
| ------ | -------- |
| `types.ts` | Add `McpCallToolResultMeta` interface with optional `resultType` ("data" \| "error" \| "resource" \| "ui") and optional `serverInfo` ({ `name?`, `version?`, `protocolVersion?` }) |
| `server-manager.ts` | Extend `buildRequestOptions(definition?, signal?, protocolVersion?)` and `getRequestOptions(name, signal?, protocolVersion?)` to include `_meta: { protocolVersion }` when provided |
| `proxy-modes.ts` | `executeCall(state, toolName, args, serverOverride, getPiTools, signal, origin, protocolVersion?)` — thread `protocolVersion` to `getRequestOptions`; capture `result.resultType` and `result._meta?.serverInfo` into `details` |
| `direct-tools.ts` | `createDirectToolExecutor` — pass `spec.protocolVersion` to `getRequestOptions`; capture `resultType`/`serverInfo` from `CallToolResult` into `details` |
| `__tests__/proxy-modes-auto-auth.test.ts` | Update `getRequestOptions` mock calls/expectations to 3-arg signature |
| `__tests__/direct-tools-auto-auth.test.ts` | Update `getRequestOptions` mock calls/expectations to 3-arg signature |

### Out of Scope

- `fetchAllTools` cache metadata (`ttlMs`, `cacheScope`) — already implemented
- Tool list discovery metadata capture — already implemented
- `mcp-code.ts` / `ui-server.ts` / `ui-resource-handler.ts` — they call `getRequestOptions` without `protocolVersion`; no change needed (optional param)
- New e2e tests for result metadata — existing tests cover proxy/direct call paths; metadata surfacing is additive and backward-compatible

---

## Affected Areas

- **Core modules**: `types.ts`, `server-manager.ts`, `proxy-modes.ts`, `direct-tools.ts`
- **Test files**: `__tests__/proxy-modes-auto-auth.test.ts`, `__tests__/direct-tools-auto-auth.test.ts`
- **Public types**: `McpCallToolResultMeta` (new), `DirectToolSpec.protocolVersion` (new optional field)

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
| ------ | ------------ | -------- | ------------ |
| Legacy servers return `CallToolResult` without `_meta`/`resultType` | High | Low | Optional chaining; keys omitted from `details` when absent |
| `protocolVersion` mismatch between connection and request | Medium | Medium | SDK validates; error surfaces as-is; callers pin version only when server supports it |
| Test mocks break due to signature change | High | Medium | Update mocks in the two auto-auth test files; other callers use 2-arg form (optional 3rd param) |
| Type drift between proxy and direct paths | Low | Medium | Use shared `McpCallToolResultMeta` type; apply identical capture logic in both files |

---

## Rollback

Revert the four source files and two test files. No database migrations, config changes, or external dependencies. The `protocolVersion` parameter is optional everywhere; omitting it preserves legacy behavior.

---

## Success Criteria

1. **Type check passes** — `McpCallToolResultMeta` constructs with all/none fields; `DirectToolSpec.protocolVersion` accepted.
2. **`executeCall` threads `protocolVersion`** — Spy on `getRequestOptions`; verify 3rd argument passed when provided.
3. **`createDirectToolExecutor` threads `spec.protocolVersion`** — Spy on `getRequestOptions`; verify 3rd argument is `spec.protocolVersion`.
4. **Result metadata surfaced** — Proxy and direct tool calls against a 2026-07-28 server return `details.resultType` and `details.serverInfo`; legacy servers produce clean `details` without these keys.
5. **Auto-auth tests pass** — Mocks updated to 3-arg `getRequestOptions`; all existing assertions hold.

---

## Proposal Question Round

Before finalizing, I want to clarify a few product/engineering decisions:

1. **Scope of `protocolVersion` threading in `executeCall`** — The design adds `protocolVersion` as an 8th parameter after `origin`. Is that the right signature, or should it be an options object to avoid parameter drift?

2. **`DirectToolSpec.protocolVersion` default** — Should direct tools default to `"auto"` (use connection-negotiated version) or `undefined` (no pinning)? The proxy path uses explicit `protocolVersion` from the call args. Direct tools don't have call-time args; they only have the spec.

3. **Test coverage for metadata capture** — The success criteria mention verifying metadata surfacing via spies. Should we add a lightweight integration test that exercises a mock 2026-07-28 server response with `_meta.serverInfo` and `resultType`, or are the unit-level spy assertions sufficient?

4. **`serverInfo` shape** — The design uses `{ name?, version?, protocolVersion? }`. The MCP spec also allows `title` and `instructions` in `serverInfo`. Should we capture the full `_meta.serverInfo` object instead of a typed subset?

5. **Behavior when both connection and request specify `protocolVersion`** — The SDK will error on mismatch. Should the adapter warn/log when a pinned `protocolVersion` differs from the negotiated version, or leave it to the SDK error?
