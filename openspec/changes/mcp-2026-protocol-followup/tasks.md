## Review Workload Forecast

| Field | Value |
| ------- | ------- |
| Estimated changed lines | 400-480 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1: Types + Server Manager → PR 2: Proxy Modes + Tests → PR 3: Direct Tools + Integration |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

---

# SDD Tasks: MCP 2026-07-28 Protocol Follow-up

## Task List

### PR 1: Types & Server Manager Foundation

- [ ] Add `McpCallToolResultMeta` interface to `src/types.ts` with `resultType` (literal union) and optional `serverInfo` (name, version, protocolVersion all optional). <!-- sdd-owner: implementation -->
- [ ] Add optional `protocolVersion?: string` field to `DirectToolSpec` interface in `src/types.ts` with JSDoc comment. <!-- sdd-owner: implementation -->
- [ ] Extend `McpServerManager.getRequestOptions(name, signal?, protocolVersion?)` in `src/server-manager.ts` to accept 3rd parameter and include `_meta: { protocolVersion }` in returned `RequestOptions` when provided. <!-- sdd-owner: implementation -->
- [ ] Extend private `McpServerManager.buildRequestOptions(definition?, signal?, protocolVersion?)` in `src/server-manager.ts` with 3rd parameter and same `_meta` inclusion logic. <!-- sdd-owner: implementation -->
- [ ] Run `npm run typecheck` to verify type changes compile. <!-- sdd-owner: implementation -->

### PR 2: Proxy Modes & Metadata Capture

- [ ] Update `executeCall` signature in `src/proxy-modes.ts` to accept 8th optional parameter `protocolVersion?: string`. <!-- sdd-owner: implementation -->
- [ ] Thread `protocolVersion` to `state.manager.getRequestOptions(serverName, signal, protocolVersion)` in `executeCall`. <!-- sdd-owner: implementation -->
- [ ] Capture `result.resultType` and `result._meta?.serverInfo` from `CallToolResult` response in `executeCall`. <!-- sdd-owner: implementation -->
- [ ] Conditionally include captured metadata in returned `details` only when defined (no `undefined` keys). <!-- sdd-owner: implementation -->
- [ ] Update `__tests__/proxy-modes-auto-auth.test.ts`: change all `getRequestOptions` mock implementations to accept 3 parameters (`name`, `signal`, `protocolVersion?`). <!-- sdd-owner: implementation -->
- [ ] Update `__tests__/proxy-modes-auto-auth.test.ts`: change call assertions from `.toHaveBeenCalledWith("demo", controller.signal)` to `.toHaveBeenCalledWith("demo", controller.signal, undefined)`. <!-- sdd-owner: implementation -->
- [ ] Run `vitest run __tests__/proxy-modes-auto-auth.test.ts` to verify mock updates pass. <!-- sdd-owner: implementation -->

### PR 3: Direct Tools, New Tests & Verification

- [ ] Update `createDirectToolExecutor` in `src/direct-tools.ts` to pass `spec.protocolVersion` as 3rd argument to `getRequestOptions(spec.serverName, signal, spec.protocolVersion)`. <!-- sdd-owner: implementation -->
- [ ] Capture `result.resultType` and `result._meta?.serverInfo` from `CallToolResult` in both success and error paths of the direct tool executor. <!-- sdd-owner: implementation -->
- [ ] Conditionally include captured metadata in `AgentToolResult.details` only when defined (match proxy path logic). <!-- sdd-owner: implementation -->
- [ ] Update `__tests__/direct-tools-auto-auth.test.ts`: change all `getRequestOptions` mock implementations to accept 3 parameters. <!-- sdd-owner: implementation -->
- [ ] Update `__tests__/direct-tools-auto-auth.test.ts`: change call assertions to expect 3rd argument as `spec.protocolVersion` (or `undefined` when not set). <!-- sdd-owner: implementation -->
- [ ] Run `vitest run __tests__/direct-tools-auto-auth.test.ts` to verify mock updates pass. <!-- sdd-owner: implementation -->
- [ ] Create `__tests__/mcp-2026-metadata-capture.test.ts` with unit tests for metadata capture logic: proxy path captures full/partial `serverInfo` and all `resultType` literals; proxy path with legacy response produces clean `details`; direct path captures identically. <!-- sdd-owner: implementation -->
- [ ] Create `__tests__/mcp-2026-metadata-integration.test.ts` with integration test using mocked 2026-07-28 server response: proxy call with/without `protocolVersion`, direct tool with/without `spec.protocolVersion`, legacy server response, partial `serverInfo` fields. <!-- sdd-owner: implementation -->
- [ ] Run `npm run typecheck` to verify full type correctness across all changes. <!-- sdd-owner: implementation -->
- [ ] Run `vitest run` (full test suite) to verify all tests pass. <!-- sdd-owner: implementation -->

---

## Parent Review Actions

- [ ] Start or reuse bounded review for PR 1 (Types + Server Manager). <!-- sdd-owner: parent -->
- [ ] Start or reuse bounded review for PR 2 (Proxy Modes + Tests). <!-- sdd-owner: parent -->
- [ ] Start or reuse bounded review for PR 3 (Direct Tools + Integration + Full Suite). <!-- sdd-owner: parent -->
