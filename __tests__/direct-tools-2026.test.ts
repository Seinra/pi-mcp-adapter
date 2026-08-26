import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildToolMetadata } from "../tool-metadata.ts";

const mocks = vi.hoisted(() => ({
  lazyConnect: vi.fn(),
  getFailureAgeSeconds: vi.fn(),
  clearFailure: vi.fn(),
  authenticate: vi.fn(),
  supportsOAuth: vi.fn(),
}));

vi.mock("../init.ts", () => ({
  lazyConnect: mocks.lazyConnect,
  getFailureAgeSeconds: mocks.getFailureAgeSeconds,
  clearFailure: mocks.clearFailure,
}));

vi.mock("../mcp-auth-flow.ts", () => ({
  authenticate: mocks.authenticate,
  supportsOAuth: mocks.supportsOAuth,
}));

function createConnectedClient(
  callToolImpl?: (...args: unknown[]) => Promise<unknown>,
) {
  return {
    callTool:
      callToolImpl ??
      vi.fn(async () => ({
        isError: false,
        content: [{ type: "text", text: "ok" }],
        _meta: {},
      })),
  };
}

function createSpec(protocolVersion?: "auto" | "2026-07-28") {
  return {
    serverName: "demo",
    originalName: "tool",
    prefixedName: "demo_tool",
    description: "Demo tool",
    inputSchema: { type: "object", properties: {} },
    ...(protocolVersion === undefined ? {} : { protocolVersion }),
  };
}

function createState(client: ReturnType<typeof createConnectedClient>) {
  return {
    owner: { signal: undefined },
    config: {
      settings: {},
      mcpServers: { demo: { command: "demo" } },
    },
    manager: {
      getConnection: vi.fn(() => ({
        status: "connected",
        client,
        tools: [{ name: "tool", description: "Demo" }],
        resources: [],
      })),
      getRequestOptions: vi.fn(
        (
          _name: string,
          _signal?: AbortSignal,
          _protocolVersion?: string,
        ) => ({}),
      ),
      registerProgressListener: vi.fn(),
      unregisterProgressListener: vi.fn(),
      touch: vi.fn(),
      incrementInFlight: vi.fn(),
      decrementInFlight: vi.fn(),
      close: vi.fn(async () => undefined),
    },
    toolMetadata: new Map(),
    failureTracker: new Map(),
    completedUiSessions: [],
    ui: { notify: vi.fn() },
  } as any;
}

async function createExecutor(state: any, spec: ReturnType<typeof createSpec>) {
  const { createDirectToolExecutor } = await import("../direct-tools.ts");
  return createDirectToolExecutor(
    () => state,
    () => null,
    spec as any,
  );
}

function runExecutor(executor: any) {
  const controller = new AbortController();
  return executor("id", {}, controller.signal, () => {}, undefined as any);
}

beforeEach(() => {
  vi.resetModules();
  mocks.lazyConnect.mockReset().mockResolvedValue(true);
  mocks.getFailureAgeSeconds.mockReset().mockReturnValue(null);
  mocks.clearFailure.mockReset();
});

describe("direct tools 2026-07-28 features", () => {
  describe("structured metadata capture", () => {
    it("surfaces structuredContent, outputSchema, progressToken, resultType, serverInfo in details", async () => {
      const client = createConnectedClient(async () => ({
        isError: false,
        content: [{ type: "text", text: "result" }],
        structuredContent: { result: "data" },
        outputSchema: {
          type: "object",
          properties: { result: { type: "string" } },
        },
        resultType: "complete",
        _meta: {
          progressToken: "token123",
          serverInfo: { name: "demo-server", version: "1.0.0" },
        },
      }));
      const state = createState(client);
      const executor = await createExecutor(state, createSpec());

      const result = await runExecutor(executor);

      expect(result.details).toMatchObject({
        server: "demo",
        tool: "tool",
        structuredContent: { result: "data" },
        outputSchema: {
          type: "object",
          properties: { result: { type: "string" } },
        },
        progressToken: "token123",
        resultType: "complete",
        serverInfo: { name: "demo-server", version: "1.0.0" },
      });
    });

    it("surfaces structured fields on tool_error results", async () => {
      const client = createConnectedClient(async () => ({
        isError: true,
        content: [{ type: "text", text: "boom" }],
        structuredContent: { code: 7 },
        resultType: "complete",
      }));
      const state = createState(client);
      const executor = await createExecutor(state, createSpec());

      const result = await runExecutor(executor);

      expect(result.details).toMatchObject({
        error: "tool_error",
        structuredContent: { code: 7 },
        resultType: "complete",
      });
    });

    it("omits structured fields when absent from a legacy-style result", async () => {
      const client = createConnectedClient(async () => ({
        isError: false,
        content: [{ type: "text", text: "ok" }],
        _meta: {},
      }));
      const state = createState(client);
      const executor = await createExecutor(state, createSpec());

      const result = await runExecutor(executor);

      expect(result.details).not.toHaveProperty("structuredContent");
      expect(result.details).not.toHaveProperty("outputSchema");
      expect(result.details).not.toHaveProperty("progressToken");
      expect(result.details).not.toHaveProperty("resultType");
      expect(result.details).not.toHaveProperty("serverInfo");
      expect(result.details).toMatchObject({ server: "demo", tool: "tool" });
    });
  });

  describe("per-spec protocolVersion", () => {
    it("threads DirectToolSpec.protocolVersion into getRequestOptions", async () => {
      const client = createConnectedClient();
      const state = createState(client);
      const executor = await createExecutor(state, createSpec("2026-07-28"));

      await runExecutor(executor);

      expect(state.manager.getRequestOptions).toHaveBeenCalledWith(
        "demo",
        expect.anything(),
        "2026-07-28",
      );
    });

    it("omits protocolVersion when spec does not define it", async () => {
      const client = createConnectedClient();
      const state = createState(client);
      const executor = await createExecutor(state, createSpec());

      await runExecutor(executor);

      expect(state.manager.getRequestOptions).toHaveBeenCalledWith(
        "demo",
        expect.anything(),
        undefined,
      );
    });
  });
});
