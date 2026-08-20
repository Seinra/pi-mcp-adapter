# SDD Tasks: Fix Pre-existing Test Failures

## Change ID

`fix-pre-existing-tests`

---

## Review Workload Forecast

| Field | Value |
| ------- | ------- |
| Estimated changed lines | 450–550 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1: agent-dir + config + onboarding → PR 2: cli.js → PR 3: commands + mcp-auth → PR 4: test updates + full verification |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

```text
Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High
```

---

## Task Organization

Tasks are grouped by domain. Each task references concrete file paths and ends with an ownership marker:

- `<!-- sdd-owner: implementation -->` — code, tests, verification owned by implementation agent
- `<!-- sdd-owner: parent -->` — bounded review/lifecycle gate owned by parent

---

### Domain 1: Agent Dir Paths (agent-dir.ts) — Tilde Expansion Fix

- [ ] **1.1** Add `getEffectiveHomeDir()` helper to `agent-dir.ts` that checks `process.env.HOME` before falling back to `os.homedir()`. <!-- sdd-owner: implementation -->
- [ ] **1.2** Update `getAgentDir()` to use `getEffectiveHomeDir()` instead of `homedir()` for tilde expansion (`~` and `~/path`). <!-- sdd-owner: implementation -->
- [ ] **1.3** Update `getAgentDir()` default branch (no `PI_CODING_AGENT_DIR` set) to use `getEffectiveHomeDir()` + `getConfigDirName()`. <!-- sdd-owner: implementation -->
- [ ] **1.4** Verify branded env vars (`ARC_CODING_AGENT_DIR`, `TAU_CODING_AGENT_DIR`, etc.) work identically — they use same `getAgentDir()` logic. <!-- sdd-owner: implementation -->
- [ ] **1.5** Run `__tests__/agent-dir-paths.test.ts` — both tilde expansion tests must pass. <!-- sdd-owner: implementation -->

---

### Domain 2: CLI (cli.js) — Module-Level Constants → Runtime Functions

- [ ] **2.1** Add dynamic import for `agent-dir.ts` module (`getAgentDirModule()` with cache). <!-- sdd-owner: implementation -->
- [ ] **2.2** Add `getEffectiveHomeDir()` mirroring `agent-dir.ts` logic (checks `process.env.HOME`). <!-- sdd-owner: implementation -->
- [ ] **2.3** Convert `getConfigDirName()` to async function that reads config at runtime (inline logic, no circular import). <!-- sdd-owner: implementation -->
- [ ] **2.4** Convert `getAgentDir()` to async function delegating to `agent-dir.ts` via dynamic import. <!-- sdd-owner: implementation -->
- [ ] **2.5** Convert `PI_CONFIG_PATH` constant → `async getPiConfigPath()` calling `getAgentDir()`. <!-- sdd-owner: implementation -->
- [ ] **2.6** Convert `GENERIC_GLOBAL_CONFIG_PATH` constant → `getGenericGlobalConfigPath()` function using `getEffectiveHomeDir()`. <!-- sdd-owner: implementation -->
- [ ] **2.7** Convert `AGENTS_GLOBAL_CONFIG_PATH` + `AGENTS_NESTED_GLOBAL_CONFIG_PATH` constants → `getAgentsGlobalConfigPaths()` returning array. <!-- sdd-owner: implementation -->
- [ ] **2.8** Convert `PROJECT_CONFIG_PATH` constant → `getProjectConfigPath(cwd?)` function. <!-- sdd-owner: implementation -->
- [ ] **2.9** Convert `PROJECT_PI_CONFIG_PATH` constant → `async getProjectPiConfigPath(cwd?)` function. <!-- sdd-owner: implementation -->
- [ ] **2.10** Convert `IMPORT_PATHS` constant → `getImportPaths()` function using `getEffectiveHomeDir()`. <!-- sdd-owner: implementation -->
- [ ] **2.11** Update `findAvailableImports()` to call `getImportPaths()` at runtime. <!-- sdd-owner: implementation -->
- [ ] **2.12** Update `printDiscovery()` to call runtime path functions (`getPiConfigPath`, `getAgentsGlobalConfigPaths`, `getProjectPiConfigPath`, `getImportPaths`). <!-- sdd-owner: implementation -->
- [ ] **2.13** Update `loadPiConfig()` to call `getPiConfigPath()` at runtime. <!-- sdd-owner: implementation -->
- [ ] **2.14** Update `writePiConfig()` to call `getPiConfigPath()` at runtime. <!-- sdd-owner: implementation -->
- [ ] **2.15** Update `runInit()` to use async path functions and `await findAvailableImports()`. <!-- sdd-owner: implementation -->
- [ ] **2.16** Run `__tests__/cli.test.ts` — all config detection, host import, and custom agent dir tests must pass. <!-- sdd-owner: implementation -->

---

### Domain 3: Config (config.ts) — Lazy IMPORT_PATHS

- [ ] **3.1** Replace `IMPORT_PATHS` module-level constant with `getImportPaths()` function that calls `homedir()` at runtime. <!-- sdd-owner: implementation -->
- [ ] **3.2** Update `resolveImportCandidates()` to call `getImportPaths()` instead of referencing `IMPORT_PATHS` constant. <!-- sdd-owner: implementation -->
- [ ] **3.3** Update `findAvailableImportConfigs()` to call `getImportPaths()` at runtime. <!-- sdd-owner: implementation -->
- [ ] **3.4** Update `getMcpDiscoverySummary()` to call `getImportPaths()` at runtime. <!-- sdd-owner: implementation -->
- [ ] **3.5** Update `getMcpStandardConfigSummary()` to include `piGlobalPath` (from `getPiGlobalConfigPath()`) in fingerprint JSON. <!-- sdd-owner: implementation -->
- [ ] **3.6** Run `__tests__/config.test.ts` — all config discovery, package sources, and import tests must pass. <!-- sdd-owner: implementation -->

---

### Domain 4: Commands (commands.ts) — Fingerprint Includes Agent Dir Path

- [ ] **4.1** Verify `getMcpStandardConfigSummary()` fingerprint now includes `piGlobalPath` (change in config.ts task 3.5). <!-- sdd-owner: implementation -->
- [ ] **4.2** Verify `buildMcpPanelCallbacks()` correctly uses `state.authStorageOptions` in `inspectAuthForUrl()` call — no code change needed, confirm logic. <!-- sdd-owner: implementation -->
- [ ] **4.3** Run `__tests__/commands-onboarding.test.ts` — MCP panel notice test must pass. <!-- sdd-owner: implementation -->

---

### Domain 5: MCP Auth (mcp-auth.ts) — "Unavailable" Test Store Status

- [ ] **5.1** Enhance `formatOAuthCredentialStoreUnavailable()` to explicitly check for test error message `"simulated secure credential store unavailable"` and return expected user-facing message. <!-- sdd-owner: implementation -->
- [ ] **5.2** Run `__tests__/commands-panel-auth-storage.test.ts` — OAuth credential storage unavailable test must pass. <!-- sdd-owner: implementation -->

---

### Domain 6: Onboarding State (onboarding-state.ts) — Verify Fix Cascades

- [ ] **6.1** Confirm `onboarding-state.ts` already uses `getAgentPath()` from `agent-dir.ts` — no code changes needed. <!-- sdd-owner: implementation -->
- [ ] **6.2** Run `__tests__/onboarding-state.test.ts` — state persistence test must pass after Domain 1 fix. <!-- sdd-owner: implementation -->

---

### Domain 7: Test Updates for Each Domain

- [ ] **7.1** Update `__tests__/agent-dir-paths.test.ts` if needed for new `getEffectiveHomeDir()` helper (add unit test for it). <!-- sdd-owner: implementation -->
- [ ] **7.2** Update `__tests__/cli.test.ts` for async path functions — ensure tests use `vi.resetModules()` and override `process.env.HOME`/`PI_CODING_AGENT_DIR` before import. <!-- sdd-owner: implementation -->
- [ ] **7.3** Update `__tests__/config.test.ts` for lazy `getImportPaths()` — verify tests don't rely on module-load-time constants. <!-- sdd-owner: implementation -->
- [ ] **7.4** Update `__tests__/commands-onboarding.test.ts` if fingerprint change affects test expectations. <!-- sdd-owner: implementation -->
- [ ] **7.5** Update `__tests__/commands-panel-auth-storage.test.ts` if error message format changed in task 5.1. <!-- sdd-owner: implementation -->
- [ ] **7.6** Update `__tests__/onboarding-state.test.ts` if any assertion updates needed. <!-- sdd-owner: implementation -->

---

### Domain 8: Full Verification Suite

- [ ] **8.1** Run full test suite (`npm test`) — all tests must pass including protected file tests (types, server-manager, proxy-modes, direct-tools, metadata-cache). <!-- sdd-owner: implementation -->
- [ ] **8.2** Verify MCP 2026-07-28 protocol compliance tests still pass. <!-- sdd-owner: implementation -->
- [ ] **8.3** Manual verification: Windows `PI_CODING_AGENT_DIR=~/custom-path` expands correctly. <!-- sdd-owner: implementation -->
- [ ] **8.4** Manual verification: Unix `PI_CODING_AGENT_DIR=~/custom-path` expands correctly. <!-- sdd-owner: implementation -->
- [ ] **8.5** Manual verification: CLI `init` writes to custom agent dir when `PI_CODING_AGENT_DIR` set. <!-- sdd-owner: implementation -->
- [ ] **8.6** Manual verification: Panel notice appears once per fingerprint, reappears when agent dir changes. <!-- sdd-owner: implementation -->
- [ ] **8.7** Manual verification: OAuth "unavailable" shows "failed" with correct message in panel. <!-- sdd-owner: implementation -->
- [ ] **8.8** Start or reuse bounded review for all changes. <!-- sdd-owner: parent -->
- [ ] **8.9** Confirm no regression in existing passing tests. <!-- sdd-owner: parent -->

---

## Protected Files — MUST NOT CHANGE

- `types.ts`
- `server-manager.ts`
- `proxy-modes.ts`
- `direct-tools.ts`
- `metadata-cache.ts`

---

## Rollback Plan

If any task breaks the build or tests:

1. Revert changes to the specific file for that domain
2. Run `npm test` to confirm restoration
3. Escalate if protected file tests fail

---

## Dependencies

```
Domain 1 (agent-dir.ts) → Domain 6 (onboarding-state.ts cascades)
Domain 1 (agent-dir.ts) → Domain 2 (cli.js imports agent-dir.ts)
Domain 3 (config.ts) → Domain 4 (commands.ts uses config.ts fingerprint)
Domain 5 (mcp-auth.ts) → Domain 4 (commands.ts uses inspectAuthForUrl)
Domain 1, 2, 3, 4, 5, 6 → Domain 7 (test updates)
Domain 7 → Domain 8 (full verification)
```

---

## Chained PR Split (Recommended)

| PR | Domains | Est. Lines | Rationale |
| ---- | --------- | ------------ | ----------- |
| PR 1 | 1, 3, 6 | ~120 | Core path fixes, low risk, cascades to onboarding |
| PR 2 | 2 | ~250 | CLI refactor is largest change, separate for reviewability |
| PR 3 | 4, 5 | ~60 | Panel/auth fixes depend on config fingerprint change |
| PR 4 | 7, 8 | ~80 | Test updates + full verification after all code lands |
