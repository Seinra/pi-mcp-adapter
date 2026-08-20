# Delta for Agent Dir Paths

## ADDED Requirements

### Requirement: Tilde expansion for bare tilde in coding agent directory environment variables

The system MUST expand a bare `~` at the start of `PI_CODING_AGENT_DIR` and branded variants (e.g., `ARC_CODING_AGENT_DIR`, `TAU_CODING_AGENT_DIR`) to the user's home directory on all platforms.

#### Scenario: Bare tilde in PI_CODING_AGENT_DIR

- GIVEN `PI_CODING_AGENT_DIR` is set to `~`
- WHEN `getAgentDir()` is called
- THEN the returned path MUST equal `os.homedir()`

#### Scenario: Bare tilde in branded ARC_CODING_AGENT_DIR

- GIVEN `ARC_CODING_AGENT_DIR` is set to `~` (with `PI_PACKAGE_DIR` pointing to a package with `piConfig.name = "arc"`)
- WHEN `getAgentDir()` is called
- THEN the returned path MUST equal `os.homedir()`

#### Scenario: Tilde prefix in PI_CODING_AGENT_DIR

- GIVEN `PI_CODING_AGENT_DIR` is set to `~/custom-path`
- WHEN `getAgentDir()` is called
- THEN the returned path MUST equal `join(os.homedir(), "custom-path")`

#### Scenario: Tilde prefix in branded ARC_CODING_AGENT_DIR

- GIVEN `ARC_CODING_AGENT_DIR` is set to `~/custom-agent` (with `PI_PACKAGE_DIR` pointing to a package with `piConfig.name = "arc"`)
- WHEN `getAgentDir()` is called
- THEN the returned path MUST equal `join(os.homedir(), "custom-agent")`

#### Scenario: Relative path in coding agent directory

- GIVEN `PI_CODING_AGENT_DIR` is set to `relative/path`
- WHEN `getAgentDir()` is called
- THEN the returned path MUST equal `resolve(process.cwd(), "relative/path")`

## MODIFIED Requirements

### Requirement: getAgentDir() respects PI_CODING_AGENT_DIR with tilde expansion

The system MUST compute the agent directory by:

1. Reading the app name from `PI_PACKAGE_DIR` package.json `piConfig.name` (defaulting to "pi")
2. Reading the environment variable `${APP_NAME}_CODING_AGENT_DIR`
3. Expanding `~` or `~/` prefix to the user's home directory
4. Resolving relative paths against the current working directory
5. Falling back to `join(homedir(), getConfigDirName(), "agent")` when the environment variable is not set

(Previously: only `~` (exact match) and `~/` prefix were expanded; bare `~` at start without trailing slash was not handled)

#### Scenario: Default agent dir when no env var is set

- GIVEN no `*_CODING_AGENT_DIR` environment variable is set
- WHEN `getAgentDir()` is called
- THEN the returned path MUST equal `join(homedir(), getConfigDirName(), "agent")`

---

# Delta for CLI

## MODIFIED Requirements

### Requirement: CLI init writes Pi config to PI_CODING_AGENT_DIR when set

The system MUST write the Pi global config (`mcp.json`) to the directory returned by `getAgentDir()` when `PI_CODING_AGENT_DIR` (or branded variant) is set, not to the hardcoded `~/.pi/agent/mcp.json`.

(Previously: `cli.js` computed `AGENT_DIR` and `PI_CONFIG_PATH` at module load time using a local `expandHome()` that differed from `agent-dir.ts`, and did not respect runtime changes to `PI_CODING_AGENT_DIR`)

#### Scenario: CLI init with PI_CODING_AGENT_DIR set

- GIVEN `PI_CODING_AGENT_DIR` is set to `/custom/agent/dir`
- AND a host config exists at `~/.claude/mcp.json`
- WHEN `pi-mcp-adapter init` is run
- THEN the Pi config MUST be written to `/custom/agent/dir/mcp.json`
- AND the Pi config MUST contain the detected import

#### Scenario: CLI init with branded ARC_CODING_AGENT_DIR set

- GIVEN `PI_PACKAGE_DIR` points to a package with `piConfig.name = "arc"`
- AND `ARC_CODING_AGENT_DIR` is set to `/custom/arc/agent`
- AND a host config exists at `~/.cursor/mcp.json`
- WHEN `pi-mcp-adapter init` is run
- THEN the Pi config MUST be written to `/custom/arc/agent/mcp.json`

### Requirement: CLI config discovery paths are computed dynamically at runtime

The system MUST compute all config discovery paths (user-global, project, import paths) at command execution time, not at module load time, so they respect the current `PI_CODING_AGENT_DIR` value.

(Previously: `AGENT_DIR`, `PI_CONFIG_PATH`, `GENERIC_GLOBAL_CONFIG_PATH`, `AGENTS_GLOBAL_CONFIG_PATH`, `AGENTS_NESTED_GLOBAL_CONFIG_PATH`, `PROJECT_CONFIG_PATH`, `PROJECT_PI_CONFIG_PATH`, and `IMPORT_PATHS` were module-level constants evaluated once at import)

#### Scenario: Config discovery respects PI_CODING_AGENT_DIR

- GIVEN `PI_CODING_AGENT_DIR` is set to `/custom/agent`
- WHEN `pi-mcp-adapter init --dry-run` is run
- THEN the output MUST list `Pi global override: /custom/agent/mcp.json`
- AND NOT list `Pi global override: ~/.pi/agent/mcp.json`

### Requirement: CLI import paths for host configs use homedir() not agent dir

The system MUST continue to discover host-specific configs (Claude Code, Codex, Cursor, etc.) in their standard locations under the user's home directory, regardless of `PI_CODING_AGENT_DIR` setting.

(Previously: `IMPORT_PATHS` in `cli.js` used `HOME` constant which was correct, but module-level evaluation caused issues)

#### Scenario: Host config discovery uses standard home locations

- GIVEN `PI_CODING_AGENT_DIR` is set to `/custom/agent`
- AND `~/.claude/mcp.json` exists
- WHEN `pi-mcp-adapter init --dry-run` is run
- THEN the output MUST show `claude-code: ~/.claude/mcp.json` as a detected import

---

# Delta for Config

## MODIFIED Requirements

### Requirement: Config discovery respects PI_CODING_AGENT_DIR for Pi-owned paths

The system MUST compute Pi-owned config paths (global and project) using `getAgentPath()` from `agent-dir.ts` which respects `PI_CODING_AGENT_DIR`, not using `homedir()` directly.

(Previously: `config.ts` used `getAgentPath()` for `getPiGlobalConfigPath()` and `getProjectPiConfigPath()` which was correct, but `IMPORT_PATHS` used `homedir()` directly for host config discovery)

#### Scenario: Pi global config path uses agent dir

- GIVEN `PI_CODING_AGENT_DIR` is set to `/custom/agent`
- WHEN `getPiGlobalConfigPath()` is called
- THEN the returned path MUST equal `/custom/agent/mcp.json`

#### Scenario: Project Pi config path uses agent dir configDirName

- GIVEN `PI_PACKAGE_DIR` points to a package with `piConfig.configDir = ".arc"`
- AND `PI_CODING_AGENT_DIR` is not set
- WHEN `getProjectPiConfigPath()` is called
- THEN the returned path MUST equal `resolve(cwd, ".arc", "mcp.json")`

### Requirement: Host config import paths remain in standard home locations

The system MUST discover host-specific configs (Cursor, Claude Code, Codex, OpenCode, Windsurf, VS Code) in their standard locations under the user's home directory, regardless of `PI_CODING_AGENT_DIR` setting. The `IMPORT_PATHS` constant MUST use `homedir()` for these paths.

(Previously: This was already correct in `config.ts` — `IMPORT_PATHS` uses `homedir()` — but the proposal flagged it as a potential issue)

#### Scenario: Host config discovery uses standard locations

- GIVEN `PI_CODING_AGENT_DIR` is set to `/custom/agent`
- WHEN `findAvailableImportConfigs()` is called
- THEN discovered import paths MUST be under `os.homedir()` (e.g., `~/.cursor/mcp.json`, `~/.claude/mcp.json`, `~/.codex/config.toml`)

### Requirement: resolveImportCandidates computes paths lazily per call

The system MUST compute import candidate paths at call time (inside `resolveImportCandidates`) so they reflect the current working directory and environment, not at module load time.

(Previously: `IMPORT_PATHS` was a module-level constant; `resolveImportCandidates` already maps over it per-call, which is correct for relative paths like `./opencode.json` and `./vscode/mcp.json`, but absolute paths using `homedir()` were baked at module load)

#### Scenario: Import candidate resolution respects current cwd

- GIVEN current working directory is `/project/a`
- WHEN `resolveImportCandidates("vscode", "/project/a")` is called
- THEN the returned path MUST be `/project/a/.vscode/mcp.json`
- GIVEN current working directory changes to `/project/b`
- WHEN `resolveImportCandidates("vscode", "/project/b")` is called
- THEN the returned path MUST be `/project/b/.vscode/mcp.json`

---

# Delta for Commands

## MODIFIED Requirements

### Requirement: MCP panel shows shared config notice exactly once per fingerprint

The system MUST show the "Using standard MCP config from ..." notice in the MCP panel when:

1. There are shared (non-Pi-owned) global configs with servers
2. The onboarding state's `sharedConfigHintShown` is `false` OR the `lastDiscoveryFingerprint` differs from the current discovery fingerprint

The system MUST update the onboarding state with the current fingerprint after showing the notice.

(Previously: The notice was shown but the fingerprint comparison may not have included the agent dir path, causing the notice to not re-appear when `PI_CODING_AGENT_DIR` changes)

#### Scenario: Shared config notice shown on first run

- GIVEN a shared global config exists at `~/.config/mcp/mcp.json` with servers
- AND onboarding state `sharedConfigHintShown` is `false`
- WHEN `openMcpPanel()` is called
- THEN the panel notice lines MUST contain "Using standard MCP config"
- AND onboarding state MUST be updated with `sharedConfigHintShown: true` and current fingerprint

#### Scenario: Shared config notice not shown on subsequent runs with same fingerprint

- GIVEN a shared global config exists with servers
- AND onboarding state has `sharedConfigHintShown: true` and matching `lastDiscoveryFingerprint`
- WHEN `openMcpPanel()` is called
- THEN the panel notice lines MUST be empty

#### Scenario: Shared config notice re-shown when fingerprint changes

- GIVEN a shared global config exists with servers
- AND onboarding state has `sharedConfigHintShown: true` but different `lastDiscoveryFingerprint`
- WHEN `openMcpPanel()` is called
- THEN the panel notice lines MUST contain "Using standard MCP config"
- AND onboarding state MUST be updated with new fingerprint

### Requirement: MCP panel does not inspect host-specific configs by default

The system MUST NOT load or parse host-specific config files (Claude, Codex, OpenCode, etc.) when opening the MCP panel unless `hostConfigDiscovery: "on"` is configured in the Pi config.

(Previously: The panel may have been triggering host config discovery during status inspection, causing warnings for malformed host configs)

#### Scenario: Panel open does not warn on malformed host configs

- GIVEN `~/.claude.json` contains invalid JSON
- AND `~/.config/opencode/opencode.json` contains invalid JSON
- AND Pi config does not have `hostConfigDiscovery: "on"`
- WHEN `openMcpPanel()` is called
- THEN no console warnings MUST be emitted for the malformed host configs

---

# Delta for MCP Auth

## MODIFIED Requirements

### Requirement: Panel correctly reports "unavailable" credential store status

The system MUST surface the OAuth credential store "unavailable" status in the MCP panel when `PI_MCP_ADAPTER_TEST_AUTH_STORE=unavailable` is set (simulating a production keyring failure), showing "failed" status with the message "OAuth credential store unavailable" instead of "needs-auth".

(Previously: The panel's `getConnectionStatus` callback may not have been correctly calling `inspectAuthForUrl` with the right options, or the "unavailable" status was not being propagated to the UI)

#### Scenario: Panel shows unavailable credential store as failed

- GIVEN `PI_MCP_ADAPTER_TEST_AUTH_STORE=unavailable`
- AND an OAuth server is configured
- WHEN the MCP panel renders
- THEN the server status MUST be "failed"
- AND the failure message MUST contain "OAuth credential store unavailable"
- AND the server MUST NOT show as "needs-auth"

### Requirement: InspectAuthForUrl uses correct auth storage options

The system MUST pass the correct `authStorageOptions` (derived from config's `oauthDir` setting and `MCP_OAUTH_DIR` env var) to `inspectAuthForUrl` when checking credential status in the panel.

(Previously: The panel callbacks may not have been passing `state.authStorageOptions` correctly)

---

# Delta for Onboarding State

## MODIFIED Requirements

### Requirement: Onboarding state file path respects PI_CODING_AGENT_DIR

The system MUST store the onboarding state file (`mcp-onboarding.json`) in the directory returned by `getAgentPath("mcp-onboarding.json")`, which respects `PI_CODING_AGENT_DIR`.

(Previously: `onboarding-state.ts` already uses `getAgentPath()` from `agent-dir.ts`, which should be correct. The failing test may be due to the `agent-dir.ts` tilde expansion bug affecting the path.)

#### Scenario: Onboarding state path uses agent dir

- GIVEN `PI_CODING_AGENT_DIR` is set to `/custom/agent`
- WHEN `getOnboardingStatePath()` is called
- THEN the returned path MUST equal `/custom/agent/mcp-onboarding.json`

#### Scenario: Onboarding state persistence works with custom agent dir

- GIVEN `PI_CODING_AGENT_DIR` is set to `/custom/agent`
- WHEN `markSharedConfigHintShown("fingerprint")` is called
- THEN the state file MUST be created at `/custom/agent/mcp-onboarding.json`
- AND subsequent `loadOnboardingState()` MUST return `sharedConfigHintShown: true`

---

# Protected Areas (MUST NOT CHANGE)

The following files and their public APIs MUST remain unchanged:

- `types.ts` — MCP 2026-07-28 protocol types
- `server-manager.ts` — Server lifecycle management
- `proxy-modes.ts` — Proxy mode implementations
- `direct-tools.ts` — Direct tools registration
- `metadata-cache.ts` — Metadata caching

Public API signatures that MUST NOT change:

- `getAgentDir()` — returns `string`
- `getAgentPath(...segments: string[])` — returns `string`
- `getConfigDirName()` — returns `string`
- `getAppName()` — returns `string`
- `getAppClientUri()` — returns `string | undefined`
- `getPiGlobalConfigPath(overridePath?: string)` — returns `string`
- `getGenericGlobalConfigPath()` — returns `string`
- `getProjectConfigPath(cwd?: string)` — returns `string`
- `getProjectPiConfigPath(cwd?: string)` — returns `string`
- `loadMcpConfig(overridePath?: string, cwd?: string)` — returns `McpConfig`
- `findAvailableImportConfigs(cwd?: string)` — returns `DiscoveredImportConfig[]`
- `getMcpDiscoverySummary(...)` — returns `McpDiscoverySummary`
- `getMcpStandardConfigSummary(...)` — returns `McpStandardConfigSummary`
- `getAuthEntry(serverName: string, options?: AuthStorageOptions)` — returns `AuthEntry | undefined`
- `inspectAuthForUrl(serverName: string, serverUrl: string, options?: AuthStorageOptions)` — returns `OAuthCredentialStatus`
- `saveAuthEntry(serverName: string, entry: AuthEntry, serverUrl?: string, options?: AuthStorageOptions)` — returns `void`
- `removeAuthEntry(serverName: string, options?: AuthStorageOptions)` — returns `void`
- `getAuthStorageOptions(oauthDir: unknown, cwd?: string)` — returns `AuthStorageOptions`
- `loadOnboardingState()` — returns `McpOnboardingState`
- `saveOnboardingState(state: McpOnboardingState)` — returns `void`
- `markSharedConfigHintShown(fingerprint?: string)` — returns `McpOnboardingState`
- `markSetupCompleted(fingerprint?: string)` — returns `McpOnboardingState`
- `openMcpPanel(...)` — returns `Promise<PanelFlowResult>`
- `openMcpSetup(...)` — returns `Promise<PanelFlowResult>`
- `openMcpAuthPanel(...)` — returns `Promise<PanelFlowResult>`

---

# Success Criteria

All 6 test files MUST pass on Windows and Unix:

1. `__tests__/agent-dir-paths.test.ts` — Both tilde expansion tests pass
2. `__tests__/cli.test.ts` — All config detection, host import, and `PI_CODING_AGENT_DIR` write tests pass
3. `__tests__/config.test.ts` — All config discovery, package sources, and import tests pass
4. `__tests__/commands-onboarding.test.ts` — MCP panel notice test passes
5. `__tests__/commands-panel-auth-storage.test.ts` — OAuth credential storage test passes
6. `__tests__/onboarding-state.test.ts` — State persistence test passes

MCP 2026-07-28 protocol tests MUST continue to pass (no regression in `types.ts`, `server-manager.ts`, `proxy-modes.ts`, `direct-tools.ts`, `metadata-cache.ts`).

No regression in existing passing tests.

---

# Implementation Notes (for Design Phase)

## Agent Dir (`agent-dir.ts`)

Fix `getAgentDir()` to handle bare `~` prefix (not just exact `~` and `~/`):

```typescript
export function getAgentDir(): string {
  const piConfig = readPiConfig();
  const name = piConfig?.name;
  const appName = typeof name === "string" && name.trim() ? name.trim() : "pi";
  const configured = process.env[`${appName.toUpperCase()}_CODING_AGENT_DIR`]?.trim();
  if (!configured) {
    return join(homedir(), getConfigDirName(), "agent");
  }
  // Handle bare tilde and tilde prefix
  if (configured === "~" || configured.startsWith("~/")) {
    return resolve(homedir(), configured.slice(1)); // slice(1) removes ~, resolve handles both ~/ and ~
  }
  return resolve(configured);
}
```

Wait — `configured.slice(1)` on `~` gives empty string, `resolve(homedir(), "")` returns `homedir()`. On `~/path` gives `/path`, `resolve(homedir(), "/path")` returns `/path` (absolute) — that's wrong. Need to handle differently:

```typescript
if (configured === "~") {
  return homedir();
}
if (configured.startsWith("~/")) {
  return resolve(homedir(), configured.slice(2));
}
return resolve(configured);
```

This matches the current logic but the test expects `~/custom-pi-agent` to work. The current code already handles `~/` prefix. The failing test is "expands tilde in PI_CODING_AGENT_DIR" with `PI_CODING_AGENT_DIR = "~/custom-pi-agent"`. Let me re-check...

Actually, looking at the test again: `process.env.PI_CODING_AGENT_DIR = "~/custom-pi-agent";` and expects `join(home, "custom-pi-agent")`. The current `agent-dir.ts` code:

```typescript
if (configured === "~") {
  return homedir();
}
if (configured.startsWith("~/")) {
  return resolve(homedir(), configured.slice(2));
}
return resolve(configured);
```

This SHOULD work for `~/custom-pi-agent`... unless there's a Windows path separator issue. On Windows, `configured.startsWith("~/")` would be true but `resolve(homedir(), configured.slice(2))` would use forward slashes. Node's `path.resolve` handles forward slashes on Windows. Hmm.

Wait — the test sets `process.env.HOME = home` (a temp dir), not the real home. And `homedir()` from `node:os` returns the REAL home, not `process.env.HOME`. The test overrides `process.env.HOME` but `os.homedir()` doesn't read from `process.env.HOME` on Windows (it uses `USERPROFILE`). On Unix it might.

Actually, `os.homedir()` on Node.js:

- Windows: returns `%USERPROFILE%` (ignores `HOME` env var)
- Unix: returns `$HOME` env var or falls back to `/etc/passwd`

The test sets `process.env.HOME = home` (temp dir) but `os.homedir()` returns the actual home directory. So the test would fail because `getAgentDir()` uses `os.homedir()` not `process.env.HOME`.

But wait — the test passes on Unix? Let me check if the test is actually failing on Windows only, or both.

The proposal says "2 tests failing" on Windows. The tilde expansion test might be failing because on Windows, `os.homedir()` doesn't respect `process.env.HOME` override.

But the test uses `vi.resetModules()` and sets `process.env.HOME` before importing. If `agent-dir.ts` uses `import { homedir } from "node:os";` at module top level, it's evaluated once and cached.

Actually, `os.homedir()` is a function call, not a constant. It's called each time `getAgentDir()` runs. But it reads from the OS, not from `process.env.HOME`.

The fix might need to use a custom home directory resolver that respects `process.env.HOME` for testing, or the test needs to be fixed. But the proposal says "Fix: Expand `~` → `homedir()` at the start of the path" — suggesting the code bug is in the tilde expansion logic.

Let me re-read the current `agent-dir.ts` code:

```typescript
export function getAgentDir(): string {
  const piConfig = readPiConfig();
  const name = piConfig?.name;
  const appName = typeof name === "string" && name.trim() ? name.trim() : "pi";
  const configured = process.env[`${appName.toUpperCase()}_CODING_AGENT_DIR`]?.trim();
  if (!configured) {
    return join(homedir(), getConfigDirName(), "agent");
  }
  if (configured === "~") {
    return homedir();
  }
  if (configured.startsWith("~/")) {
    return resolve(homedir(), configured.slice(2));
  }
  return resolve(configured);
}
```

This looks correct for `~/custom-pi-agent`. But the test is failing. The issue might be that on Windows, the path separator is `\` and `configured.startsWith("~/")` checks for forward slash. If the user sets `PI_CODING_AGENT_DIR=~/custom-path` on Windows, it still comes in as forward slashes (env vars are strings). `startsWith("~/")` should work.

Unless... the test is running on Windows and `os.homedir()` returns a path with backslashes, and `resolve()` produces backslashes, but the test expects forward slashes? No, `join()` uses platform separator.

Wait, the test does `expect(getAgentDir()).toBe(join(home, "custom-pi-agent"));` where `home` is a temp dir created with `mkdtempSync(join(tmpdir(), "pi-mcp-agent-dir-home-"))`. But `getAgentDir()` uses `os.homedir()` which is the REAL home, not the test's `home` variable.

So the test is fundamentally flawed — it overrides `process.env.HOME` but the code uses `os.homedir()`. On Unix, `os.homedir()` reads `$HOME`, so it would work. On Windows, `os.homedir()` reads `%USERPROFILE%`, ignoring `HOME`.

But the proposal says the fix is "Expand `~` → `homedir()` at the start of the path" — implying the current code doesn't do this correctly.

Let me check `cli.js`'s `expandHome`:

```javascript
const HOME = os.homedir();

function expandHome(input) {
  if (input === "~") return HOME;
  if (input.startsWith("~/")) return path.resolve(HOME, input.slice(2));
  return path.resolve(input);
}
```

Same issue — uses `os.homedir()` at module load time (constant `HOME`).

The real fix for testability might be to allow injecting the home directory, or the tests need to not override `process.env.HOME` but instead mock `os.homedir()`. But the proposal says to fix the code, not the tests.

Actually, re-reading the proposal: "Root cause: `agent-dir.ts` `getAgentDir()` doesn't expand `~` at the start of paths, only `~/`"

But the code DOES handle `~/`. Unless... the test is using `~custom-path` (no slash)? No, the test uses `"~/custom-pi-agent"`.

Let me look at the branded test: `process.env.ARC_CODING_AGENT_DIR = "~/custom-agent";` expects `join(home, "custom-agent")`. Same pattern.

Maybe the issue is that `configured.trim()` removes whitespace but the test doesn't have whitespace. Or maybe the `readPiConfig()` is returning something unexpected.

Actually, for the branded test: it sets `PI_PACKAGE_DIR` to a package with `piConfig: { name: "arc", configDir: ".arc" }`. Then `getAgentDir()` reads `ARC_CODING_AGENT_DIR`. The code uses `appName.toUpperCase() + "_CODING_AGENT_DIR"` which would be `ARC_CODING_AGENT_DIR`. That matches.

But wait — the test first checks without `ARC_CODING_AGENT_DIR` set, expecting `join(home, ".arc", "agent")`. Then sets `ARC_CODING_AGENT_DIR = agentDir` (absolute path), expects that. Then sets `ARC_CODING_AGENT_DIR = "~/custom-agent"`, expects `join(home, "custom-agent")`. Then sets `ARC_CODING_AGENT_DIR = "relative-agent"`, expects `join(process.cwd(), "relative-agent")`.

The third case `~/custom-agent` should work with current code. Unless `home` in the test is not the real home.

I think the issue is that the test overrides `process.env.HOME` but `os.homedir()` doesn't respect it on Windows. The fix should make the code use a home directory resolver that can be overridden for testing, OR the code should check `process.env.HOME` as a fallback on Windows.

But the proposal says "Fix: Expand `~` → `homedir()` at the start of the path" — this suggests the tilde expansion logic itself is broken, not the home directory resolution.

Let me look more carefully: `configured.startsWith("~/")` — what if the input is `~\\custom-path` on Windows? Environment variables preserve what the user types. If a Windows user types `set PI_CODING_AGENT_DIR=~\custom-path`, the value is `~\custom-path`. `startsWith("~/")` would be false.

But the test uses forward slashes: `"~/custom-pi-agent"`.

I think the actual bug might be more subtle. Let me just write the spec to require the correct behavior and let the design phase figure out the exact fix.

For the spec, I'll specify the required behavior clearly: tilde expansion MUST work for `~` and `~/` prefixes on all platforms, using the effective home directory (respecting `HOME`/`USERPROFILE` env vars as the OS does).

## CLI (`cli.js`)

The main issues:

1. Module-level constants (`AGENT_DIR`, `PI_CONFIG_PATH`, `IMPORT_PATHS`, etc.) evaluated at import time
2. Duplicate `expandHome()` and `getAgentDir()` logic that may differ from `agent-dir.ts`
3. `PI_CONFIG_PATH` used in `loadPiConfig()` and `writePiConfig()` is stale if `PI_CODING_AGENT_DIR` changes

Fix approach: Move all path computations into functions called at runtime. Consider importing `getAgentDir`, `getAgentPath`, `getConfigDirName` from `agent-dir.ts` (but `cli.js` is CommonJS/ESM hybrid — need to check interop).

Actually, `cli.js` uses `import` statements (ESM) but is named `.js`. It has `import.meta.url` usage. It might be running as ESM. `agent-dir.ts` is TypeScript/ESM. The interop should work with `await import("./agent-dir.ts")` or similar.

But the proposal recommends "fix both consistently now, deduplicate in follow-up" — so maybe keep the duplicate logic but make it consistent and dynamic.

## Config (`config.ts`)

`IMPORT_PATHS` uses `homedir()` at module load. Should be lazy. But `resolveImportCandidates` already maps over it per-call. The issue is that `homedir()` is called once at module load for the absolute paths. For relative paths like `./opencode.json` and `./vscode/mcp.json`, it resolves against `cwd` per-call which is correct.

Fix: Make `IMPORT_PATHS` a function `getImportPaths()` that returns the paths with current `homedir()`, or compute absolute paths lazily in `resolveImportCandidates`.

## Commands (`commands.ts`)

The shared config notice test failure: `buildSharedConfigNoticeLines` uses `getMcpStandardConfigSummary` which uses `getConfigSources` which uses `getPiGlobalConfigPath` which uses `getAgentPath` which uses `getAgentDir`. If `getAgentDir` is fixed, this should work.

But the fingerprint in `getMcpStandardConfigSummary` is:

```typescript
fingerprint: JSON.stringify({ sources: sources.map((source) => [source.id, source.exists, source.serverCount]) })
```

This doesn't include the actual paths! So if `PI_CODING_AGENT_DIR` changes, the fingerprint might not change (if the shared global configs are the same). The notice would not re-appear.

The proposal question 4 asks: "Should the onboarding fingerprint need to include agent dir path for correctness?"

The spec should require that the fingerprint includes enough information to detect when the shared config notice should re-appear.

## MCP Auth (`mcp-auth.ts`)

The test sets `PI_MCP_ADAPTER_TEST_AUTH_STORE=unavailable` and expects the panel to show "failed" with "OAuth credential store unavailable" message.

The panel's `getConnectionStatus` callback calls `inspectAuthForUrl(serverName, serverUrl, state.authStorageOptions)`.

`inspectAuthForUrl` calls `readAuthEntry(serverName, options, { migrateLegacy: false })` which uses `getAuthSecretStore()`.

`getAuthSecretStore()` checks `process.env[TEST_AUTH_STORE_ENV]` where `TEST_AUTH_STORE_ENV = 'PI_MCP_ADAPTER_TEST_AUTH_STORE'`.

If set to `'unavailable'`, it returns `unavailableAuthSecretStore` which throws on read/write/remove.

`readAuthEntry` catches `OAuthCredentialStoreError` and re-throws (since `shouldAttemptLinuxKeyringRecovery` would be false for a generic "simulated secure credential store unavailable" error).

`inspectAuthForUrl` catches `OAuthCredentialStoreError` and returns `{ status: 'unavailable', message: formatOAuthCredentialStoreUnavailable(error) }`.

`formatOAuthCredentialStoreUnavailable` returns "OAuth credential store unavailable. Configure or unlock the OS credential store and retry." (or the Linux keyring specific message).

Then `getConnectionStatus` checks `if (authStatus.status === "unavailable")` and sets `authStatusFailures.set(serverName, authStatus.message)` and returns "failed".

This all looks correct. Why is the test failing?

The test expects:

- `getRendered()` to contain "failed"
- `getRendered()` to NOT contain "needs auth"
- `getRendered()` to contain "OAuth credential store unavailable"

Maybe the panel rendering doesn't include the failure message in the rendered output? Or the `authStatusFailures` map is not being read correctly?

The `getFailureMessage` callback returns `authStatusFailures.get(serverName) ?? getFailureMessage(state, serverName)`.

The panel component (`mcp-panel.ts`) would need to render this. The test mocks `createMcpPanel` and captures the rendered output.

The issue might be that the test's `createPanelHarness` doesn't properly simulate the panel rendering with the failure message.

But the proposal says to fix code bugs, not tests. So there might be a real bug in how the "unavailable" status is propagated.

Let me check: `buildMcpPanelCallbacks` creates `authStatusFailures` as a local Map. The `getConnectionStatus` callback populates it. The `getFailureMessage` callback reads from it. This should work.

Unless... the panel calls `getConnectionStatus` multiple times and the `authStatusFailures` map is recreated each time `buildMcpPanelCallbacks` is called? No, `buildMcpPanelCallbacks` is called once per `openMcpPanel` call, and the callbacks object is passed to `createMcpPanel`.

Wait, `openMcpPanel` calls `buildMcpPanelCallbacks` and passes the result to `createMcpPanel`. The `authStatusFailures` Map is closed over by the callbacks. This should work.

Maybe the issue is that `state.authStorageOptions` is not being passed correctly? In the test, `createState()` returns `authStorageOptions: {}`. But `inspectAuthForUrl` is called with `state.authStorageOptions`.

In `buildMcpPanelCallbacks`, it calls `inspectAuthForUrl(serverName, serverUrl, state.authStorageOptions)`. The test state has `authStorageOptions: {}`. This should be fine for the "unavailable" test since the test store doesn't use the options.

I'll specify the requirement and let the design phase investigate.

## Onboarding State (`onboarding-state.ts`)

Already uses `getAgentPath()` from `agent-dir.ts`. If `agent-dir.ts` is fixed, this should work. The test failure might be a side effect of the agent-dir bug.

---

# Risks

1. **Windows tilde expansion**: The fix must handle both forward slash (`~/path`) and backslash (`~\path`) tilde prefixes on Windows, though environment variables typically use forward slashes.

2. **Branded distribution compatibility**: Changes to `agent-dir.ts` affect all branded distributions (Arc, Tau, etc.) that use `*_CODING_AGENT_DIR` env vars. Must test with `ARC_CODING_AGENT_DIR`.

3. **CLI module-level constants**: Converting `cli.js` module-level constants to runtime functions is a significant refactor. Must ensure all call sites are updated.

4. **Config import paths**: Making `IMPORT_PATHS` lazy must not break performance or caching assumptions in `config.ts`.

5. **Onboarding fingerprint**: Changing the fingerprint to include agent dir path may cause the shared config notice to re-appear for users who change `PI_CODING_AGENT_DIR`. This is acceptable per proposal assumption.

6. **OAuth "unavailable" test mode**: The fix must not change production OAuth credential store behavior, only ensure the test simulation is correctly surfaced in the panel.

7. **ESM/CommonJS interop**: If `cli.js` imports from `agent-dir.ts`, ensure the module interop works correctly in the test environment (Vitest with `vi.resetModules()`).

---

# Rollback Plan

Revert changes to:

- `agent-dir.ts`
- `cli.js`
- `config.ts`
- `mcp-auth.ts`
- `onboarding-state.ts`
- `commands.ts`

Run full test suite to confirm restoration.
