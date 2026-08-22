import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clients: [] as any[],
  transports: [] as any[],
}));

vi.mock("@modelcontextprotocol/client", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Client: vi.fn().mockImplementation(function (
    this: any,
    info: unknown,
    options: unknown,
  ) {
    this.info = info;
    this.options = options;
    this.setRequestHandler = vi.fn();
    this.setNotificationHandler = vi.fn();
    this.connect = vi.fn(async () => undefined);
    this.getServerCapabilities = vi.fn(() => ({ tools: {}, resources: {} }));
    this.listTools = vi.fn(async () => ({ tools: [] }));
    this.listResources = vi.fn(async () => ({ resources: [] }));
    this.listPrompts = vi.fn(async () => ({ prompts: [] }));
    this.close = vi.fn(async () => undefined);
    mocks.clients.push(this);
  }),
  StreamableHTTPClientTransport: vi.fn(),
  SSEClientTransport: vi.fn(),
}));

vi.mock("@modelcontextprotocol/client/stdio", () => ({
  StdioClientTransport: vi.fn().mockImplementation(function (
    this: any,
    options: unknown,
  ) {
    this.options = options;
    this.close = vi.fn(async () => undefined);
    mocks.transports.push(this);
  }),
}));

vi.mock("../npx-resolver.ts", () => ({
  resolveNpxBinary: vi.fn(async () => null),
}));

vi.mock("../sampling-handler.ts", () => ({
  registerSamplingHandler: vi.fn(),
}));

vi.mock("../elicitation-handler.ts", () => ({
  registerElicitationHandler: vi.fn(),
}));

describe("McpServerManager 2026-07-28 features", () => {
  beforeEach(() => {
    mocks.clients.length = 0;
    mocks.transports.length = 0;
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("buildClientCapabilities protocolVersion behavior", () => {
    let McpServerManager: any;

    beforeEach(async () => {
      const mod = await import("../server-manager.ts");
      McpServerManager = mod.McpServerManager;
    });

    it("omits sampling when protocolVersion is '2026-07-28'", () => {
      const manager = new McpServerManager();
      manager.setSamplingConfig({
        autoApprove: true,
        modelRegistry: {} as any,
        getCurrentModel: () => undefined,
        getSignal: () => undefined,
      });

      const caps = manager.buildClientCapabilities("2026-07-28");
      expect(caps).not.toHaveProperty("sampling");
      expect(caps).toEqual({});
    });

    it("includes sampling when protocolVersion is 'legacy' and sampling config exists", () => {
      const manager = new McpServerManager();
      manager.setSamplingConfig({
        autoApprove: true,
        modelRegistry: {} as any,
        getCurrentModel: () => undefined,
        getSignal: () => undefined,
      });

      const caps = manager.buildClientCapabilities("legacy");
      expect(caps).toHaveProperty("sampling");
      expect(caps.sampling).toEqual({});
    });

    it("includes sampling when protocolVersion is undefined and sampling config exists", () => {
      const manager = new McpServerManager();
      manager.setSamplingConfig({
        autoApprove: true,
        modelRegistry: {} as any,
        getCurrentModel: () => undefined,
        getSignal: () => undefined,
      });

      const caps = manager.buildClientCapabilities(undefined);
      expect(caps).toHaveProperty("sampling");
      expect(caps.sampling).toEqual({});
    });

    it("omits sampling when no sampling config exists regardless of protocolVersion", () => {
      const manager = new McpServerManager();

      const caps = manager.buildClientCapabilities("legacy");
      expect(caps).not.toHaveProperty("sampling");
    });

    it("includes elicitation when elicitation config exists", () => {
      const manager = new McpServerManager();
      manager.setElicitationConfig({ allowUrl: true, ui: {} as any });

      const caps = manager.buildClientCapabilities("2026-07-28");
      expect(caps).toHaveProperty("elicitation");
      expect(caps.elicitation).toEqual({ form: {}, url: {} });
    });
  });

  describe("fetchAllResourceTemplates", () => {
    it("returns all templates with multi-page pagination", async () => {
      const { McpServerManager } = await import("../server-manager.ts");
      const manager = new McpServerManager();

      const client = {
        listResourceTemplates: vi
          .fn()
          .mockResolvedValueOnce({
            resourceTemplates: [
              { uriTemplate: "file:///template/{id}", name: "template1" },
            ],
            nextCursor: "cursor1",
          })
          .mockResolvedValueOnce({
            resourceTemplates: [
              { uriTemplate: "file:///template/{id}", name: "template2" },
            ],
            nextCursor: undefined,
          }),
        getServerCapabilities: vi.fn(() => ({
          resources: { templates: true },
        })),
        close: vi.fn(async () => undefined),
        setRequestHandler: vi.fn(),
        setNotificationHandler: vi.fn(),
        connect: vi.fn(async () => undefined),
        listTools: vi.fn(async () => ({ tools: [] })),
        listResources: vi.fn(async () => ({ resources: [] })),
        listPrompts: vi.fn(async () => ({ prompts: [] })),
      };

      const result = await (manager as any).fetchAllResourceTemplates(
        client,
        undefined,
      );

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("template1");
      expect(result[1].name).toBe("template2");
      expect(client.listResourceTemplates).toHaveBeenCalledTimes(2);
    });

    it("returns single page when no nextCursor", async () => {
      const { McpServerManager } = await import("../server-manager.ts");
      const manager = new McpServerManager();

      const client = {
        listResourceTemplates: vi
          .fn()
          .mockResolvedValueOnce({
            resourceTemplates: [
              { uriTemplate: "file:///template/{id}", name: "template1" },
            ],
            nextCursor: undefined,
          }),
        getServerCapabilities: vi.fn(() => ({
          resources: { templates: true },
        })),
        close: vi.fn(async () => undefined),
        setRequestHandler: vi.fn(),
        setNotificationHandler: vi.fn(),
        connect: vi.fn(async () => undefined),
        listTools: vi.fn(async () => ({ tools: [] })),
        listResources: vi.fn(async () => ({ resources: [] })),
        listPrompts: vi.fn(async () => ({ prompts: [] })),
      };

      const result = await (manager as any).fetchAllResourceTemplates(
        client,
        undefined,
      );

      expect(result).toHaveLength(1);
      expect(client.listResourceTemplates).toHaveBeenCalledTimes(1);
    });

    it("falls back to raw request when SDK method not available", async () => {
      const { McpServerManager } = await import("../server-manager.ts");
      const manager = new McpServerManager();

      const client = {
        listResourceTemplates: undefined,
        request: vi
          .fn()
          .mockResolvedValue({
            resourceTemplates: [
              { uriTemplate: "file:///template/{id}", name: "template1" },
            ],
            nextCursor: undefined,
          }),
        getServerCapabilities: vi.fn(() => ({
          resources: { templates: true },
        })),
        close: vi.fn(async () => undefined),
        setRequestHandler: vi.fn(),
        setNotificationHandler: vi.fn(),
        connect: vi.fn(async () => undefined),
        listTools: vi.fn(async () => ({ tools: [] })),
        listResources: vi.fn(async () => ({ resources: [] })),
        listPrompts: vi.fn(async () => ({ prompts: [] })),
      };

      const result = await (manager as any).fetchAllResourceTemplates(
        client,
        undefined,
      );

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("template1");
      expect(client.request).toHaveBeenCalledWith(
        { method: "resources/templates/list", params: {} },
        undefined,
      );
    });

    it("returns empty array when no capability advertised", async () => {
      const { McpServerManager } = await import("../server-manager.ts");
      const manager = new McpServerManager();

      const client = {
        listResourceTemplates: vi
          .fn()
          .mockResolvedValue({ resourceTemplates: [], nextCursor: undefined }),
        getServerCapabilities: vi.fn(() => ({ resources: {} })),
        close: vi.fn(async () => undefined),
        setRequestHandler: vi.fn(),
        setNotificationHandler: vi.fn(),
        connect: vi.fn(async () => undefined),
        listTools: vi.fn(async () => ({ tools: [] })),
        listResources: vi.fn(async () => ({ resources: [] })),
        listPrompts: vi.fn(async () => ({ prompts: [] })),
      };

      const result = await (manager as any).fetchAllResourceTemplates(
        client,
        undefined,
      );

      expect(result).toEqual([]);
    });

    it("handles templates with optional fields", async () => {
      const { McpServerManager } = await import("../server-manager.ts");
      const manager = new McpServerManager();

      const client = {
        listResourceTemplates: vi.fn().mockResolvedValueOnce({
          resourceTemplates: [
            {
              uriTemplate: "file:///template/{id}",
              name: "template1",
              description: "Desc 1",
              mimeType: "text/plain",
            },
            { uriTemplate: "file:///template/{id}", name: "template2" },
          ],
          nextCursor: undefined,
        }),
        getServerCapabilities: vi.fn(() => ({
          resources: { templates: true },
        })),
        close: vi.fn(async () => undefined),
        setRequestHandler: vi.fn(),
        setNotificationHandler: vi.fn(),
        connect: vi.fn(async () => undefined),
        listTools: vi.fn(async () => ({ tools: [] })),
        listResources: vi.fn(async () => ({ resources: [] })),
        listPrompts: vi.fn(async () => ({ prompts: [] })),
      };

      const result = await (manager as any).fetchAllResourceTemplates(
        client,
        undefined,
      );

      expect(result).toHaveLength(2);
      expect(result[0].description).toBe("Desc 1");
      expect(result[0].mimeType).toBe("text/plain");
      expect(result[1].description).toBe("");
      expect(result[1].mimeType).toBe("");
    });
  });

  describe("listResourceTemplates", () => {
    it("returns typed array when connected", async () => {
      const { McpServerManager } = await import("../server-manager.ts");
      const manager = new McpServerManager();

      const connection = {
        status: "connected",
        resourceTemplates: [
          {
            uriTemplate: "file:///template/{id}",
            name: "template1",
            description: "Desc 1",
            mimeType: "text/plain",
          },
          {
            uriTemplate: "file:///template/{id}",
            name: "template2",
            description: "",
            mimeType: "",
          },
        ],
      };
      (manager as any).connections.set("demo", connection);

      const result = await manager.listResourceTemplates("demo");

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("template1");
      expect(result[1].name).toBe("template2");
    });

    it("throws Error when server not connected", async () => {
      const { McpServerManager } = await import("../server-manager.ts");
      const manager = new McpServerManager();

      try {
        await manager.listResourceTemplates("nonexistent");
        throw new Error("Expected promise to reject");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe(
          'Server "nonexistent" is not connected',
        );
      }
    });

    it("returns empty array when no capability advertised", async () => {
      const { McpServerManager } = await import("../server-manager.ts");
      const manager = new McpServerManager();

      const connection = {
        status: "connected",
        resourceTemplates: [],
      };
      (manager as any).connections.set("demo", connection);

      const result = await manager.listResourceTemplates("demo");

      expect(result).toEqual([]);
    });

    it("returns empty array when resourceTemplates is undefined", async () => {
      const { McpServerManager } = await import("../server-manager.ts");
      const manager = new McpServerManager();

      const connection = {
        status: "connected",
      };
      (manager as any).connections.set("demo", connection);

      const result = await manager.listResourceTemplates("demo");

      expect(result).toEqual([]);
    });
  });

  describe("complete", () => {
    it("returns McpCompletionResult on success with SDK method", async () => {
      const { McpServerManager } = await import("../server-manager.ts");
      const manager = new McpServerManager();

      const client = {
        complete: vi
          .fn()
          .mockResolvedValue({
            completion: { values: ["val1", "val2"], total: 2, hasMore: false },
          }),
        getServerCapabilities: vi.fn(() => ({ completions: {} })),
        close: vi.fn(async () => undefined),
        setRequestHandler: vi.fn(),
        setNotificationHandler: vi.fn(),
        connect: vi.fn(async () => undefined),
        listTools: vi.fn(async () => ({ tools: [] })),
        listResources: vi.fn(async () => ({ resources: [] })),
        listPrompts: vi.fn(async () => ({ prompts: [] })),
      };
      (manager as any).connections.set("demo", { status: "connected", client });

      const result = await manager.complete(
        "demo",
        { type: "ref/prompt", name: "myPrompt" },
        { name: "arg", value: "val" },
      );

      expect(result).toEqual({
        completion: { values: ["val1", "val2"], total: 2, hasMore: false },
      });
      expect(client.complete).toHaveBeenCalledWith(
        {
          ref: { type: "ref/prompt", name: "myPrompt" },
          argument: { name: "arg", value: "val" },
        },
        undefined,
      );
    });

    it("falls back to raw request when SDK method not available", async () => {
      const { McpServerManager } = await import("../server-manager.ts");
      const manager = new McpServerManager();

      const client = {
        complete: undefined,
        request: vi
          .fn()
          .mockResolvedValue({
            completion: { values: ["val1"], total: 1, hasMore: false },
          }),
        getServerCapabilities: vi.fn(() => ({ completions: {} })),
        close: vi.fn(async () => undefined),
        setRequestHandler: vi.fn(),
        setNotificationHandler: vi.fn(),
        connect: vi.fn(async () => undefined),
        listTools: vi.fn(async () => ({ tools: [] })),
        listResources: vi.fn(async () => ({ resources: [] })),
        listPrompts: vi.fn(async () => ({ prompts: [] })),
      };
      (manager as any).connections.set("demo", { status: "connected", client });

      const result = await manager.complete(
        "demo",
        { type: "ref/resource", name: "file:///resource" },
        { name: "arg", value: "val" },
      );

      expect(result).toEqual({
        completion: { values: ["val1"], total: 1, hasMore: false },
      });
      expect(client.request).toHaveBeenCalledWith(
        {
          method: "completion/complete",
          params: {
            ref: { type: "ref/resource", uri: "file:///resource" },
            argument: { name: "arg", value: "val" },
          },
        },
        undefined,
      );
    });

    it("throws when server not connected", async () => {
      const { McpServerManager } = await import("../server-manager.ts");
      const manager = new McpServerManager();

      await expect(
        manager.complete(
          "nonexistent",
          { type: "ref/prompt", name: "prompt" },
          { name: "arg", value: "val" },
        ),
      ).rejects.toThrow('Server "nonexistent" is not connected');
    });

    it("throws when server does not support completions capability", async () => {
      const { McpServerManager } = await import("../server-manager.ts");
      const manager = new McpServerManager();

      const client = {
        getServerCapabilities: vi.fn(() => ({ tools: {} })),
        close: vi.fn(async () => undefined),
        setRequestHandler: vi.fn(),
        setNotificationHandler: vi.fn(),
        connect: vi.fn(async () => undefined),
        listTools: vi.fn(async () => ({ tools: [] })),
        listResources: vi.fn(async () => ({ resources: [] })),
        listPrompts: vi.fn(async () => ({ prompts: [] })),
      };
      (manager as any).connections.set("demo", { status: "connected", client });

      await expect(
        manager.complete(
          "demo",
          { type: "ref/prompt", name: "prompt" },
          { name: "arg", value: "val" },
        ),
      ).rejects.toThrow('Server "demo" does not support completions');
    });

    it("handles custom ref type", async () => {
      const { McpServerManager } = await import("../server-manager.ts");
      const manager = new McpServerManager();

      const client = {
        complete: vi
          .fn()
          .mockResolvedValue({
            completion: { values: ["val1"], total: 1, hasMore: false },
          }),
        getServerCapabilities: vi.fn(() => ({ completions: {} })),
        close: vi.fn(async () => undefined),
        setRequestHandler: vi.fn(),
        setNotificationHandler: vi.fn(),
        connect: vi.fn(async () => undefined),
        listTools: vi.fn(async () => ({ tools: [] })),
        listResources: vi.fn(async () => ({ resources: [] })),
        listPrompts: vi.fn(async () => ({ prompts: [] })),
      };
      (manager as any).connections.set("demo", { status: "connected", client });

      await manager.complete(
        "demo",
        { type: "custom/ref", name: "custom" },
        { name: "arg", value: "val" },
      );

      expect(client.complete).toHaveBeenCalledWith(
        {
          ref: { type: "custom/ref", name: "custom" },
          argument: { name: "arg", value: "val" },
        },
        undefined,
      );
    });
  });

  describe("progress listeners", () => {
    it("registers and unregisters listener by token", async () => {
      const { McpServerManager } = await import("../server-manager.ts");
      const manager = new McpServerManager();

      const handler = vi.fn();
      manager.registerProgressListener("token123", handler);
      expect((manager as any).progressListeners.has("token123")).toBe(true);

      manager.unregisterProgressListener("token123");
      expect((manager as any).progressListeners.has("token123")).toBe(false);
    });

    it("normalizes string and number tokens to different string keys", async () => {
      const { McpServerManager } = await import("../server-manager.ts");
      const manager = new McpServerManager();

      const handler1 = vi.fn();
      const handler2 = vi.fn();
      manager.registerProgressListener("token123", handler1);
      manager.registerProgressListener(123, handler2);

      // "token123" and "123" are different keys
      expect((manager as any).progressListeners.size).toBe(2);
      expect((manager as any).progressListeners.get("token123")).toBe(handler1);
      expect((manager as any).progressListeners.get("123")).toBe(handler2);
    });

    it("invokes handler when notification matches token", async () => {
      const { McpServerManager } = await import("../server-manager.ts");
      const manager = new McpServerManager();

      const handler = vi.fn();
      manager.registerProgressListener("token123", handler);

      const params = { progressToken: "token123", progress: 50, total: 100 };
      const listener = (manager as any).progressListeners.get("token123");
      if (listener) {
        listener(params);
      }

      expect(handler).toHaveBeenCalledWith({
        progressToken: "token123",
        progress: 50,
        total: 100,
      });
    });

    it("drops notification with unknown token silently", async () => {
      const { McpServerManager } = await import("../server-manager.ts");
      const manager = new McpServerManager();

      const handler = vi.fn();
      manager.registerProgressListener("known-token", handler);

      // Simulate unknown token
      const listener = (manager as any).progressListeners.get("unknown-token");
      expect(listener).toBeUndefined();

      // Directly test that no handler is invoked for unknown token
      const unknownListener = (manager as any).progressListeners.get(
        "unknown-token",
      );
      if (unknownListener) {
        unknownListener({
          progressToken: "unknown-token",
          progress: 50,
          total: 100,
        });
      }

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("progress listener with UI notify", () => {
    it("calls ui.notify with formatted progress message when listener registered", async () => {
      const { McpServerManager } = await import("../server-manager.ts");
      const manager = new McpServerManager();

      const ui = {
        notify: vi.fn(),
      };
      manager.setElicitationConfig({ allowUrl: false, ui: ui as any });

      // Register a listener that mimics executeCall pattern
      manager.registerProgressListener("token123", (notification) => {
        ui.notify(
          `Progress: ${notification.progress}/${notification.total} - ${notification.message}`,
          "progress",
        );
      });

      // Directly invoke the listener
      const listener = (manager as any).progressListeners.get("token123");
      if (listener) {
        listener({
          progressToken: "token123",
          progress: 50,
          total: 100,
          message: "Processing...",
        });
        listener({
          progressToken: "token123",
          progress: 75,
          total: 100,
          message: "Almost done",
        });
      }

      expect(ui.notify).toHaveBeenCalledWith(
        "Progress: 50/100 - Processing...",
        "progress",
      );
      expect(ui.notify).toHaveBeenCalledWith(
        "Progress: 75/100 - Almost done",
        "progress",
      );
    });
  });
});
