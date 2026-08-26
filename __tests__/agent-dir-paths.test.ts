import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Pi agent dir paths", () => {
  const originalHome = process.env.HOME;
  const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
  const originalOAuthDir = process.env.MCP_OAUTH_DIR;
  const originalPackageDir = process.env.PI_PACKAGE_DIR;
  const originalArcAgentDir = process.env.ARC_CODING_AGENT_DIR;
  const originalUserProfile = process.env.USERPROFILE;

  // Node's os.homedir() prefers USERPROFILE over HOME on Windows, so tests
  // that fake the home directory must stub both variables on win32.
  const setHome = (home: string) => {
    process.env.HOME = home;
    if (process.platform === "win32") {
      process.env.USERPROFILE = home;
    }
  };

  beforeEach(() => {
    vi.resetModules();
    delete process.env.PI_PACKAGE_DIR;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }
    if (originalAgentDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = originalAgentDir;
    }
    if (originalOAuthDir === undefined) {
      delete process.env.MCP_OAUTH_DIR;
    } else {
      process.env.MCP_OAUTH_DIR = originalOAuthDir;
    }
    if (originalPackageDir === undefined) {
      delete process.env.PI_PACKAGE_DIR;
    } else {
      process.env.PI_PACKAGE_DIR = originalPackageDir;
    }
    if (originalArcAgentDir === undefined) {
      delete process.env.ARC_CODING_AGENT_DIR;
    } else {
      process.env.ARC_CODING_AGENT_DIR = originalArcAgentDir;
    }
  });

  it("uses PI_CODING_AGENT_DIR for Pi-owned config and state files", async () => {
    const home = mkdtempSync(join(tmpdir(), "pi-mcp-agent-dir-home-"));
    const agentDir = mkdtempSync(join(tmpdir(), "pi-mcp-agent-dir-"));
    setHome(home);
    process.env.PI_CODING_AGENT_DIR = agentDir;
    delete process.env.MCP_OAUTH_DIR;

    const { getAgentDir } = await import("../agent-dir.ts");
    const { getPiGlobalConfigPath } = await import("../config.ts");
    const { getMetadataCachePath } = await import("../metadata-cache.ts");
        const { getOnboardingStatePath } = await import("../onboarding-state.ts");
    const { getAuthBaseDir, saveAuthEntry } = await import(
      "../mcp-auth.ts"
    );

    expect(getAgentDir()).toBe(agentDir);
    expect(getPiGlobalConfigPath()).toBe(join(agentDir, "mcp.json"));
    expect(getMetadataCachePath()).toBe(join(agentDir, "mcp-cache.json"));
    expect(getOnboardingStatePath()).toBe(
      join(agentDir, "mcp-onboarding.json"),
    );

    saveAuthEntry(
      "demo",
      { tokens: { accessToken: "token" } },
      "https://example.com/mcp",
    );
    expect(getAuthBaseDir()).toBe(join(agentDir, "mcp-oauth"));
    expect(existsSync(join(agentDir, "mcp-oauth", "demo", "tokens.json"))).toBe(
      false,
    );
  });

  it("expands tilde in PI_CODING_AGENT_DIR", async () => {
    const home = mkdtempSync(join(tmpdir(), "pi-mcp-agent-dir-home-"));
    setHome(home);
    process.env.PI_CODING_AGENT_DIR = "~/custom-pi-agent";

    const { getAgentDir } = await import("../agent-dir.ts");

    expect(getAgentDir()).toBe(join(home, "custom-pi-agent"));
  });

  it("uses the branded host environment key and config directory", async () => {
    const home = mkdtempSync(join(tmpdir(), "pi-mcp-agent-dir-home-"));
    const packageDir = mkdtempSync(join(tmpdir(), "pi-mcp-package-dir-"));
    const agentDir = mkdtempSync(join(tmpdir(), "pi-mcp-agent-dir-"));
    setHome(home);
    writeFileSync(
      join(packageDir, "package.json"),
      JSON.stringify({ piConfig: { name: "arc", configDir: ".arc" } }),
    );
    process.env.PI_PACKAGE_DIR = packageDir;

    const { getAgentDir } = await import("../agent-dir.ts");

    expect(getAgentDir()).toBe(join(home, ".arc", "agent"));

    process.env.ARC_CODING_AGENT_DIR = agentDir;
    expect(getAgentDir()).toBe(agentDir);

    process.env.ARC_CODING_AGENT_DIR = "~/custom-agent";
    expect(getAgentDir()).toBe(join(home, "custom-agent"));

    process.env.ARC_CODING_AGENT_DIR = "relative-agent";
    expect(getAgentDir()).toBe(join(process.cwd(), "relative-agent"));
  });

  it("keeps MCP_OAUTH_DIR as the explicit OAuth storage override", async () => {
    const home = mkdtempSync(join(tmpdir(), "pi-mcp-agent-dir-home-"));
    const agentDir = mkdtempSync(join(tmpdir(), "pi-mcp-agent-dir-"));
    const oauthDir = mkdtempSync(join(tmpdir(), "pi-mcp-oauth-dir-"));
    setHome(home);
    process.env.PI_CODING_AGENT_DIR = agentDir;
    process.env.MCP_OAUTH_DIR = oauthDir;

    const { getAuthBaseDir } = await import("../mcp-auth.ts");

    expect(getAuthBaseDir()).toBe(oauthDir);
  });
});
