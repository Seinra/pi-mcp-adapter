import { afterEach, describe, expect, it, vi } from "vitest";
import { probeMcpEndpoint } from "../mcp-probe.ts";

const fetchMock = vi.fn();

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

function mockFetch(...responses: Response[]): void {
  fetchMock.mockResolvedValueOnce(responses[0]);
  for (const response of responses.slice(1)) fetchMock.mockResolvedValueOnce(response);
  vi.stubGlobal("fetch", fetchMock);
}

describe("MCP endpoint shape probe", () => {
  it("classifies an HTML 200 response as not MCP", async () => {
    mockFetch(new Response("<html>Welcome</html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    }));

    await expect(probeMcpEndpoint("https://example.test/mcp")).resolves.toMatchObject({
      isMcp: false,
      classification: expect.stringContaining("HTML (200)"),
    });
  });

  it("classifies a GraphQL-style JSON error as not MCP", async () => {
    mockFetch(new Response(JSON.stringify({ errors: [{ message: "Cannot query field" }] }), {
      status: 400,
      headers: { "content-type": "application/json" },
    }));

    await expect(probeMcpEndpoint("https://example.test/graphql")).resolves.toMatchObject({
      isMcp: false,
      classification: expect.stringContaining("application/json (400)"),
    });
  });

  it("reports a transient server error without claiming the URL is not MCP", async () => {
    mockFetch(new Response(JSON.stringify({
      error: "temporarily_unavailable",
      error_description: "Credential validation is temporarily unavailable",
    }), {
      status: 503,
      headers: { "content-type": "application/json" },
    }));

    const result = await probeMcpEndpoint("https://example.test/mcp");

    expect(result).toMatchObject({
      isMcp: false,
      classification: expect.stringContaining("temporarily unavailable"),
    });
    expect(result.classification).not.toContain("does not appear to speak MCP");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports an accepted response without claiming the URL is not MCP", async () => {
    mockFetch(new Response("Accepted", {
      status: 202,
      headers: { "content-type": "application/json" },
    }));

    const result = await probeMcpEndpoint("https://example.test/mcp");

    expect(result).toMatchObject({
      isMcp: false,
      classification: "endpoint returned application/json (202) — MCP endpoint shape could not be determined",
    });
    expect(result.classification).not.toContain("does not appear to speak MCP");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports an unauthenticated response without claiming the URL is not MCP", async () => {
    mockFetch(new Response("Unauthorized", { status: 401, headers: { "content-type": "application/json" } }));
    
    const result = await probeMcpEndpoint("https://example.test/mcp");
    
    expect(result).toMatchObject({
      isMcp: false,
      classification: "endpoint returned application/json (401) — authentication may be required; MCP endpoint shape could not be determined",
    });
    expect(result.classification).not.toContain("does not appear to speak MCP");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
    
  it("recognizes a modern stateless server/discover response", async () => {
    mockFetch(new Response(JSON.stringify({
      jsonrpc: "2.0", id: 1, result: { protocolVersion: "2026-07-28" },
    }), { status: 200, headers: { "content-type": "application/json" } }));

    await expect(probeMcpEndpoint("https://example.test/mcp")).resolves.toMatchObject({
      isMcp: true,
      classification: expect.stringContaining("stateless MCP 2026-07-28"),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": "server/discover",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "server/discover", params: {} }),
    });
  });

  it("recognizes a modern Bearer JSON-RPC authentication error", async () => {
    mockFetch(new Response(JSON.stringify({
      jsonrpc: "2.0", id: 1, error: { code: -32001, message: "Unauthorized" },
    }), {
      status: 401,
      headers: { "www-authenticate": "Bearer" },
    }));

    await expect(probeMcpEndpoint("https://example.test/mcp")).resolves.toMatchObject({
      isMcp: true,
      classification: "endpoint requires Bearer authentication during MCP 2026-07-28 server/discover probing",
    });
  });

  it("classifies a non-discover JSON-RPC error response as not MCP", async () => {
    mockFetch(new Response(JSON.stringify({
      jsonrpc: "2.0", id: 1, error: { code: -32601, message: "Method not found" },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    
    await expect(probeMcpEndpoint("https://example.test/mcp")).resolves.toMatchObject({
      isMcp: false,
      classification: expect.stringContaining("application/json (200)"),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
    
  it("classifies a different protocol version as not MCP", async () => {
    mockFetch(new Response(JSON.stringify({
      jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18" },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    
    await expect(probeMcpEndpoint("https://example.test/mcp")).resolves.toMatchObject({
      isMcp: false,
      classification: expect.stringContaining("application/json (200)"),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
    
  it("classifies a legacy-style 400 as not MCP without retrying", async () => {
    mockFetch(new Response("Method not supported", { status: 400 }));
    
    await expect(probeMcpEndpoint("https://example.test/mcp")).resolves.toMatchObject({ isMcp: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
    
  it("classifies a POST 405 as not MCP without a GET retry", async () => {
    mockFetch(new Response("Method Not Allowed", { status: 405 }));
    
    await expect(probeMcpEndpoint("https://example.test/mcp")).resolves.toMatchObject({ isMcp: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
  });
});
