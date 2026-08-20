# SDD Proposal: Fix Pre-existing Test Failures

## Change ID

`fix-pre-existing-tests`

## Intent

Fix pre-existing test failures in the pi-mcp-adapter codebase without breaking the new MCP 2026-07-28 protocol implementation. The failures are primarily related to:

1. Windows tilde (`~`) expansion in `PI_CODING_AGENT_DIR` environment variable
2. Config detection and host import issues in CLI
3. Config discovery, package sources, and import failures
4. MCP panel notice and OAuth credential storage failures
5. Onboarding state persistence

## Scope

### Target Test Files (6 files, ~12 failing tests)

1. `__tests__/agent-dir-paths.test.ts` - 2 tests: tilde expansion in `PI_CODING_AGENT_DIR` on Windows
2. `__tests__/cli.test.ts` - Multiple: config detection, host imports, PI_CODING_AGENT_DIR writes
3. `__tests__/config.test.ts` - Multiple: config discovery, package sources, imports
4. `__tests__/commands-onboarding.test.ts` - 1 test: MCP panel notice failure
5. `__tests__/commands-panel-auth-storage.test.ts` - 1 test: OAuth credential storage failure
6. `__tests__/onboarding-state.test.ts` - 1 test: state persistence

### Protected Files (MUST NOT BREAK)

- `types.ts` - MCP 2026-07-28 protocol types
- `server-manager.ts` - Server lifecycle management
- `proxy-modes.ts` - Proxy mode implementations
- `direct-tools.ts` - Direct tools registration
- `metadata-cache.ts` - Metadata caching

### Source Files Likely Needing Fixes

- `agent-dir.ts` - Tilde expansion logic for `PI_CODING_AGENT_DIR`
- `cli.js` - Config detection, host imports, path resolution
- `config.ts` - Config discovery, package loading, import handling
- `mcp-auth.ts` - OAuth credential storage, test store handling
- `onboarding-state.ts` - State file path resolution
- `commands.ts` - Panel notice logic, auth storage options

## Business Problem

These test failures represent actual code bugs that affect Windows users and core functionality:

- **Tilde expansion broken on Windows**: Users setting `PI_CODING_AGENT_DIR=~/custom-path` get literal `~/custom-path` instead of expanded home directory
- **CLI init fails with custom agent dir**: Config writes to wrong location when `PI_CODING_AGENT_DIR` is set
- **Config discovery misses imports**: Host config imports (Claude Code, Codex, etc.) not detected correctly
- **OAuth storage unavailable in tests**: Test environment can't simulate credential store failures
- **Onboarding state not persisted**: Shared config hint not tracked across sessions

## Target Users and Situations

- **Windows developers** using pi-mcp-adapter with custom `PI_CODING_AGENT_DIR` paths
- **CI/CD pipelines** running tests on Windows runners
- **Users migrating from host editors** (VS Code, Claude Code, Cursor, Codex) expecting auto-import
- **Extension developers** relying on OAuth credential storage for MCP servers

## Business Rules and Invariants

1. **Tilde expansion MUST work cross-platform**: `~` → `%USERPROFILE%` on Windows, `$HOME` on Unix
2. **`PI_CODING_AGENT_DIR` MUST be respected**: All Pi-owned files (config, cache, OAuth, onboarding) go there
3. **Host config imports MUST be opt-in**: Discovery only activates when `hostConfigDiscovery: "on"` in Pi config
4. **OAuth credentials MUST use OS credential store**: Fallback to plaintext only for legacy migration
5. **Onboarding state MUST persist**: Shared config hint shown once per fingerprint

## Current State Gap

- `agent-dir.ts` uses `homedir()` + `resolve()` but `cli.js` has duplicate `expandHome()` that may differ
- `config.ts` uses `homedir()` directly in `IMPORT_PATHS` - may not respect `PI_CODING_AGENT_DIR` override
- `cli.js` loads config from hardcoded `PI_CONFIG_PATH` at module load time, not dynamically
- `mcp-auth.ts` test store "unavailable" mode may not be triggered correctly in panel tests
- `onboarding-state.ts` path resolution may not use expanded agent dir

## Implications and Impact

| Area | Impact |
| ------ | -------- |
| Windows users | Cannot use `~/path` in `PI_CODING_AGENT_DIR` |
| CI/CD | Tests fail on Windows runners |
| Host imports | Auto-detection broken for custom agent dirs |
| OAuth | Credential storage failures not surfaced correctly in UI |
| Onboarding | Shared config notice repeats every session |

## Edge Cases

- `PI_CODING_AGENT_DIR=~` (bare tilde) → should expand to home directory
- `PI_CODING_AGENT_DIR=~/nested/path` → should expand to `$HOME/nested/path`
- `PI_CODING_AGENT_DIR=relative/path` → should resolve against CWD
- `MCP_OAUTH_DIR` override takes precedence over agent dir
- Branded distributions (Arc, etc.) use `ARC_CODING_AGENT_DIR` with same tilde semantics
- Module-level constants in `cli.js` evaluated at import time, not runtime

## Decision Gaps

1. Should `cli.js` be refactored to use `agent-dir.ts` functions instead of duplicating logic?
2. Should `IMPORT_PATHS` in `config.ts` be computed lazily to respect runtime `PI_CODING_AGENT_DIR`?
3. Is the test OAuth store "unavailable" mode correctly simulating the real error?
4. Does the onboarding fingerprint need to include agent dir path for correctness?

## Scope Boundaries and Non-Goals

**In Scope:**

- Fix tilde expansion in `agent-dir.ts` and `cli.js`
- Fix config discovery to respect `PI_CODING_AGENT_DIR`
- Fix CLI init to write to correct path when `PI_CODING_AGENT_DIR` set
- Fix OAuth test store unavailable simulation
- Fix onboarding state persistence

**Out of Scope (Later Refinement):**

- Refactor `cli.js` to TypeScript (separate effort)
- Add new host config import types
- Change OAuth storage backend
- Modify MCP 2026-07-28 protocol types

**Must Stay Unchanged:**

- `types.ts`, `server-manager.ts`, `proxy-modes.ts`, `direct-tools.ts`, `metadata-cache.ts`
- Public API signatures of `getAgentDir()`, `getPiGlobalConfigPath()`, `loadMcpConfig()`
- OAuth credential store interface (`AuthSecretStore`)

## Business Risk / Tradeoff

**Primary Risk**: Fixing tilde expansion in `agent-dir.ts` could affect branded distributions (Arc) that use `ARC_CODING_AGENT_DIR`. Must test both `PI_CODING_AGENT_DIR` and branded variants.

**Tradeoff**: `cli.js` duplicates `agent-dir.ts` logic. Fixing both consistently vs. deduplicating. Deduplication is cleaner but higher risk. Recommend: fix both consistently now, deduplicate in follow-up.

## Success Criteria

1. All 6 test files pass on Windows and Unix
2. `agent-dir-paths.test.ts`: Both tilde expansion tests pass
3. `cli.test.ts`: Config detection and host import tests pass
4. `config.test.ts`: Config discovery, package sources, import tests pass
5. `commands-onboarding.test.ts`: MCP panel notice test passes
6. `commands-panel-auth-storage.test.ts`: OAuth credential storage test passes
7. `onboarding-state.test.ts`: State persistence test passes
8. MCP 2026-07-28 protocol tests continue to pass (types, server-manager, proxy-modes, direct-tools, metadata-cache)
9. No regression in existing passing tests

## Rollback Plan

- Revert changes to `agent-dir.ts`, `cli.js`, `config.ts`, `mcp-auth.ts`, `onboarding-state.ts`, `commands.ts`
- Run full test suite to confirm restoration

---

## Proposal Question Round

### Questions for User Review

1. **CLI deduplication**: `cli.js` duplicates `agent-dir.ts` logic (`expandHome`, `getAgentDir`, `getConfigDirName`, `readPiConfig`). Should we:
   - A) Fix both files consistently (lower risk, some duplication remains)
   - B) Refactor `cli.js` to import from `agent-dir.ts` (cleaner, higher risk - `cli.js` is CommonJS/ESM hybrid)
   - C) Extract shared path utilities to a new module both can import

2. **IMPORT_PATHS laziness**: `config.ts` computes `IMPORT_PATHS` at module load using `homedir()`. This doesn't respect runtime `PI_CODING_AGENT_DIR` changes. Should `resolveImportCandidates` compute paths lazily per-call?

3. **Test OAuth store "unavailable"**: The test `commands-panel-auth-storage.test.ts` sets `PI_MCP_ADAPTER_TEST_AUTH_STORE=unavailable` but the panel may not be triggering the error path correctly. Should we adjust the test expectation or the panel's error handling?

4. **Onboarding fingerprint**: The fingerprint in `getMcpStandardConfigSummary` includes source existence and server counts. Should it also include the agent dir path so that changing `PI_CODING_AGENT_DIR` triggers a new hint?

5. **Branded distribution testing**: Do we have test coverage for `ARC_CODING_AGENT_DIR` (and other branded vars) with tilde expansion, or should we add it?

---

## Proposal Assumptions (to be confirmed)

- [ ] Tilde expansion fix applies to all `*_CODING_AGENT_DIR` env vars (PI, ARC, TAU, etc.)
- [ ] `cli.js` can safely call `agent-dir.ts` functions (ESM/CommonJS interop works)
- [ ] `IMPORT_PATHS` laziness won't break performance or caching assumptions
- [ ] OAuth "unavailable" test mode correctly simulates production keyring failures
- [ ] Onboarding fingerprint change is acceptable (may re-show hint for users who change agent dir)

Please review the questions above and confirm or correct any assumptions before proceeding to spec phase.
