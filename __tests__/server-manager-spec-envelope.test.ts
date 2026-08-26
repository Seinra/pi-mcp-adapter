import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { McpServerManager } from "../server-manager.ts";

// The fixture answers `server/discover` with the MCP 2026-07-28 spec-literal
// envelope shape (top-level `resultType` / `_meta` siblings of `result`), which
// the installed @modelcontextprotocol/client 2.0.0 strictly rejects. Without
// installEnvelopeReshaping + enableReshapingProbeSiblings this pinned connect
// fails with EraNegotiationFailed.
const fixture = fileURLToPath(
  new URL("./fixtures/spec-envelope-discover-server.mjs", import.meta.url),
);

describe("McpServerManager with spec-literal 2026-07-28 envelopes", () => {
  it("connects end-to-end against a spec-shaped server/discover when pinned", async () => {
    const manager = new McpServerManager();
    try {
      const connection = await manager.connect("spec-envelope", {
        command: process.execPath,
        args: [fixture],
        protocolVersion: "2026-07-28",
      });
      expect(connection.status).toBe("connected");
      expect(connection.tools.map(tool => tool.name)).toContain("spec_envelope_ok");
    } finally {
      await manager.closeAll();
    }
  }, 20_000);
});
