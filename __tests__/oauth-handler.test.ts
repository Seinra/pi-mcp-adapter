import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("oauth-handler token compatibility", () => {
  const originalHome = process.env.HOME;
  const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
  const originalOAuthDir = process.env.MCP_OAUTH_DIR;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env.HOME = originalHome;
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
  });

  it("reads tokens from the secure auth store", async () => {
    const { saveAuthEntry } = await import("../mcp-auth.ts");
    const { getStoredTokens } = await import("../oauth-handler.ts");

    saveAuthEntry("demo", {
      tokens: {
        accessToken: "abc",
        refreshToken: "refresh",
        expiresAt: Date.now() / 1000 + 60,
        scope: "read",
      },
    }, "https://example.com/mcp");

    expect(getStoredTokens("demo")).toMatchObject({
      access_token: "abc",
      token_type: "Bearer",
      refresh_token: "refresh",
      scope: "read",
    });
  });
});
