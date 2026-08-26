import readline from "node:readline";

// Spec-literal MCP 2026-07-28 envelopes: `resultType` / `_meta` ride as
// TOP-LEVEL siblings of `result` (13-discover.md example shape). The installed
// @modelcontextprotocol/client 2.0.0 strictly rejects this envelope shape, so
// a pinned connect only succeeds when envelope-reshape.ts moves those members
// into `result` before the SDK parses the message.
const lines = readline.createInterface({ input: process.stdin });

function respondSpec(id, result, topLevelMembers) {
  process.stdout.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id,
    ...topLevelMembers,
    result,
  })}\n`);
}

lines.on("line", line => {
  const request = JSON.parse(line);
  if (request.method === "server/discover") {
    respondSpec(
      request.id,
      {
        supportedVersions: ["2026-07-28"],
        capabilities: { tools: {} },
        ttlMs: 0,
        cacheScope: "private",
      },
      {
        resultType: "complete",
        _meta: {
          "io.modelcontextprotocol/serverInfo": {
            name: "spec-envelope",
            version: "1.0.0",
          },
        },
      },
    );
    return;
  }
  if (request.method === "tools/list") {
    respondSpec(
      request.id,
      {
        tools: [{
          name: "spec_envelope_ok",
          description: "MCP 2026-07-28 spec-literal envelope reshaping works",
          inputSchema: { type: "object", properties: {} },
        }],
        ttlMs: 0,
        cacheScope: "private",
      },
      { resultType: "complete" },
    );
    return;
  }
  if (request.method === "initialize" && request.id !== undefined) {
    respondSpec(
      request.id,
      {
        protocolVersion: "2026-07-28",
        capabilities: { tools: {} },
        serverInfo: { name: "spec-envelope", version: "1.0.0" },
      },
      {},
    );
  }
});
