import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  supportsOAuth: vi.fn(),
  lazyConnect: vi.fn(),
  updateServerMetadata: vi.fn(),
  updateMetadataCache: vi.fn(),
  notifyToolMetadataUpdated: vi.fn(),
  markKeepAliveAfterConnect: vi.fn(),
  getFailureAgeSeconds: vi.fn(),
  updateStatusBar: vi.fn(),
  clearFailure: vi.fn(),
  recordFailure: vi.fn(),
}));

vi.mock("../mcp-auth-flow.ts", () => ({
  authenticate: mocks.authenticate,
  supportsOAuth: mocks.supportsOAuth,
}));

vi.mock("../init.ts", () => ({
  lazyConnect: mocks.lazyConnect,
  updateServerMetadata: mocks.updateServerMetadata,
  updateMetadataCache: mocks.updateMetadataCache,
  notifyToolMetadataUpdated: mocks.notifyToolMetadataUpdated,
  markKeepAliveAfterConnect: mocks.markKeepAliveAfterConnect,
  getFailureAgeSeconds: mocks.getFailureAgeSeconds,
  updateStatusBar: mocks.updateStatusBar,
  clearFailure: mocks.clearFailure,
  recordFailure: mocks.recordFailure,
}));

vi.mock("../npx-resolver.ts", () => ({
  resolveNpxBinary: vi.fn(async () => null),
}));

function createCallToolResult(overrides: Record<string, unknown> = {}) {
  return {
    isError: false,
    content: [{ type: "text", text: "ok" }],
    _meta: {},
    ...overrides,
  };
}

function createManager(callToolImpl?: (...args: unknown[]) => Promise<unknown>) {
  const connected = {
    status: "connected",
    client: {
      callTool:
        callToolImpl ?? vi.fn(async () => createCallToolResult()),
    },
    tools: [{ name: "tool", description: "Demo" }],
    resources: [],
    prompts: [],
  };
  return {
    getConnection: vi.fn(() => connected),
    getRequestOptions: vi.fn(
      (_name: string, _signal?: AbortSignal, _protocolVersion?: string) => ({}),
    ),
    registerProgressListener: vi.fn(),
    unregisterProgressListener: vi.fn(),
    touch: vi.fn(),
    incrementInFlight: vi.fn(),
    decrementInFlight: vi.fn(),
    connect: vi.fn(async () => connected),
    close: vi.fn(async () => undefined),
  };
}

function createState(manager: ReturnType<typeof createManager>) {
  return {
    owner: { signal: undefined },
    config: {
      settings: {},
      mcpServers: { demo: { command: "demo" } },
    },
    manager,
    toolMetadata: new Map([
      [
        "demo",
        [
          {
            name: "demo_tool",
            originalName: "tool",
            description: "Demo",
            inputSchema: { type: "object", properties: {} },
          },
        ],
      ],
    ]),
    failureTracker: new Map(),
    completedUiSessions: [],
    ui: { notify: vi.fn() },
  } as any;
}

beforeEach(() => {
  vi.resetModules();
  mocks.authenticate.mockReset().mockResolvedValue("authenticated");
  mocks.supportsOAuth.mockReset().mockReturnValue(true);
  mocks.lazyConnect.mockReset().mockResolvedValue(false);
  mocks.getFailureAgeSeconds.mockReset().mockReturnValue(null);
  mocks.clearFailure.mockReset();
  mocks.recordFailure.mockReset();
});

describe("proxy-modes 2026-07-28 features", () => {
  describe("structured content capture", () => {
    it("surfaces structuredContent, outputSchema, progressToken in details when present", async () => {
      const { executeCall } = await import("../proxy-modes.ts");

      const manager = createManager(async () =>
        createCallToolResult({
          content: [{ type: "text", text: "result" }],
          structuredContent: { result: "data" },
          outputSchema: {
            type: "object",
            properties: { result: { type: "string" } },
          },
          _meta: { progressToken: "token123" },
        }),
      );
      const state = createState(manager);

      const result = await executeCall(state, "demo_tool", {}, "demo");

      expect(result.details).toMatchObject({
        structuredContent: { result: "data" },
        outputSchema: {
          type: "object",
          properties: { result: { type: "string" } },
        },
        progressToken: "token123",
      });
    });

    it("omits structured fields when absent from a legacy-style result", async () => {
      const { executeCall } = await import("../proxy-modes.ts");

      const manager = createManager(async () =>
        createCallToolResult({
          content: [{ type: "text", text: "result" }],
        }),
      );
      const state = createState(manager);

      const result = await executeCall(state, "demo_tool", {}, "demo");

      expect(result.details).not.toHaveProperty("structuredContent");
      expect(result.details).not.toHaveProperty("outputSchema");
      expect(result.details).not.toHaveProperty("progressToken");
      expect(result.details).toMatchObject({ server: "demo", tool: "tool" });
    });

    it("surfaces structured fields on tool_error results too", async () => {
      const { executeCall } = await import("../proxy-modes.ts");

      const manager = createManager(async () =>
        createCallToolResult({
          isError: true,
          content: [{ type: "text", text: "boom" }],
          structuredContent: { code: 7 },
        }),
      );
      const state = createState(manager);

      const result = await executeCall(state, "demo_tool", {}, "demo");

      expect(result.details).toMatchObject({
        error: "tool_error",
        structuredContent: { code: 7 },
      });
    });
  });

  describe("progress notifications", () => {
    it("registers one-shot listener before the call and cleans up after success", async () => {
      const { executeCall } = await import("../proxy-modes.ts");

      const manager = createManager();
      const state = createState(manager);

      await executeCall(
        state, "demo_tool", {}, "demo",
        undefined, undefined, undefined, undefined,
        "token123",
      );

      expect(manager.registerProgressListener).toHaveBeenCalledWith(
        "token123",
        expect.any(Function),
      );
      expect(manager.unregisterProgressListener).toHaveBeenCalledWith("token123");
    });

    it("cleans up the listener when the call fails", async () => {
      const { executeCall } = await import("../proxy-modes.ts");

      const manager = createManager(async () => {
        throw new Error("call failed");
      });
      const state = createState(manager);

      await expect(
        executeCall(
          state, "demo_tool", {}, "demo",
          undefined, undefined, undefined, undefined,
          "token123",
        ),
      ).resolves.toBeDefined();

      expect(manager.unregisterProgressListener).toHaveBeenCalledWith("token123");
    });

    it("puts the progress token into request options _meta", async () => {
      const { executeCall } = await import("../proxy-modes.ts");

      const manager = createManager();
      const state = createState(manager);

      await executeCall(
        state, "demo_tool", {}, "demo",
        undefined, undefined, undefined, undefined,
        "token123",
      );

      const [, requestOptions] = (manager.getConnection().client.callTool as any)
        .mock.calls[0];
      expect(requestOptions._meta).toMatchObject({ progressToken: "token123" });
    });

    it("listener handler notifies through state.ui", async () => {
      const { executeCall } = await import("../proxy-modes.ts");

      const manager = createManager();
      const state = createState(manager);

      await executeCall(
        state, "demo_tool", {}, "demo",
        undefined, undefined, undefined, undefined,
        "token123",
      );

      const handler = manager.registerProgressListener.mock.calls[0][1] as (
        n: { progress: number; total?: number; message?: string },
      ) => void;
      handler({ progress: 50, total: 100, message: "Working" });

      expect(state.ui.notify).toHaveBeenCalledWith(
        "Working (50/100)",
        "info",
      );
    });
  });

  describe("per-request protocolVersion", () => {
    it("threads protocolVersion into getRequestOptions", async () => {
      const { executeCall } = await import("../proxy-modes.ts");

      const manager = createManager();
      const state = createState(manager);

      await executeCall(
        state, "demo_tool", {}, "demo",
        undefined, undefined, undefined, "2026-07-28",
      );

      expect(manager.getRequestOptions).toHaveBeenCalledWith(
        "demo",
        undefined,
        "2026-07-28",
      );
    });

    it("omits protocolVersion argument when not provided", async () => {
      const { executeCall } = await import("../proxy-modes.ts");

      const manager = createManager();
      const state = createState(manager);

      await executeCall(state, "demo_tool", {}, "demo");

      expect(manager.getRequestOptions).toHaveBeenCalledWith(
        "demo",
        undefined,
        undefined,
      );
    });
  });

  describe("resource_link / resource content typing", () => {
    it("materializes resource_link blocks into text with URI", async () => {
      const { executeCall } = await import("../proxy-modes.ts");

      const manager = createManager(async () =>
        createCallToolResult({
          content: [
            {
              type: "resource_link",
              uri: "file:///resource/1",
              name: "Resource 1",
              description: "Description",
              mimeType: "text/plain",
            },
          ],
        }),
      );
      const state = createState(manager);

      const result = await executeCall(state, "demo_tool", {}, "demo");

      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toMatchObject({
        type: "text",
        text: "[Resource Link: Resource 1]\nURI: file:///resource/1",
      });
    });

    it("materializes embedded resource blocks into text with content", async () => {
      const { executeCall } = await import("../proxy-modes.ts");

      const manager = createManager(async () =>
        createCallToolResult({
          content: [
            {
              type: "resource",
              resource: {
                uri: "file:///resource/2",
                text: "Embedded",
                mimeType: "text/plain",
              },
            },
          ],
        }),
      );
      const state = createState(manager);

      const result = await executeCall(state, "demo_tool", {}, "demo");

      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toMatchObject({
        type: "text",
        text: "[Resource: file:///resource/2]\nEmbedded",
      });
    });
  });
});
