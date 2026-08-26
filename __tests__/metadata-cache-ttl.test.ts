import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { McpServerManager } from "../server-manager.ts";
import {
  computeServerHash,
  isServerCacheValid,
  loadMetadataCache,
  serializeTools,
} from "../metadata-cache.ts";
import { updateMetadataCache } from "../init.ts";
import type { CachedTool, ServerCacheEntry, ServerEntry } from "../types.ts";

const BASE_TIME = 1_700_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_AGE_MS = 7 * DAY_MS;

function tool(name: string, ttlMs?: number): CachedTool {
  return (ttlMs === undefined ? { name } : { name, ttlMs }) as CachedTool;
}

function makeDefinition(): ServerEntry {
  return { command: "node", args: ["server.js"] };
}

function makeEntry(
  definition: ServerEntry,
  ageMs: number,
  tools: CachedTool[],
): ServerCacheEntry {
  return {
    configHash: computeServerHash(definition),
    cachedAt: Date.now() - ageMs,
    tools,
    resources: [],
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(BASE_TIME);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("isServerCacheValid ttlMs honoring", () => {
  it("expires an entry once its declared ttlMs elapsed, before the default max age", () => {
    const definition = makeDefinition();
    // ttl 1s, entry 2s old: well inside the 7-day default, past the ttl.
    const entry = makeEntry(definition, 2_000, [tool("search", 1_000)]);

    expect(isServerCacheValid(entry, definition)).toBe(false);
  });

  it("expires exactly at cachedAt + ttlMs", () => {
    const definition = makeDefinition();
    const entry = makeEntry(definition, 1_000, [tool("search", 1_000)]);

    expect(isServerCacheValid(entry, definition)).toBe(false);
  });

  it("keeps a fresh entry whose declared ttlMs has not elapsed", () => {
    const definition = makeDefinition();
    const entry = makeEntry(definition, 500, [tool("search", 1_000)]);

    expect(isServerCacheValid(entry, definition)).toBe(true);
  });

  it("uses the smallest declared ttlMs across all tools", () => {
    const definition = makeDefinition();
    const stale = makeEntry(definition, 2_000, [
      tool("a", 5_000),
      tool("b", 1_000),
    ]);
    expect(isServerCacheValid(stale, definition)).toBe(false);

    const fresh = makeEntry(definition, 800, [
      tool("a", 5_000),
      tool("b", 1_000),
    ]);
    expect(isServerCacheValid(fresh, definition)).toBe(true);
  });

  // PIN: mixed pages (one tool stamped by a page-level ttlMs, one unstamped
  // from a page without hints) expire together at the tightest DECLARED ttl.
  it("pins: mixed entry with one ttl-less tool expires at cachedAt + declared ttlMs", () => {
    const definition = makeDefinition();
    const entry = makeEntry(definition, 0, [
      tool("stamped", 1_000),
      tool("unstamped"),
    ]);

    vi.setSystemTime(BASE_TIME + 500);
    expect(isServerCacheValid(entry, definition)).toBe(true);

    vi.setSystemTime(BASE_TIME + 1_500);
    expect(isServerCacheValid(entry, definition)).toBe(false);
  });

  // PIN: ttlMs = 0 is a valid declared ttl and means "never serve from cache".
  it("pins: ttlMs = 0 makes the entry invalid at any age, including age 0", () => {
    const definition = makeDefinition();
    const entry = makeEntry(definition, 0, [tool("no-cache", 0)]);

    expect(isServerCacheValid(entry, definition)).toBe(false);

    vi.setSystemTime(BASE_TIME + 500);
    expect(isServerCacheValid(entry, definition)).toBe(false);
  });

  it("ignores missing, non-numeric, and negative ttlMs values", () => {
    const definition = makeDefinition();
    const entry = makeEntry(definition, 2 * DAY_MS, [
      tool("no-ttl"),
      tool("negative", -5),
      tool("string-ttl", "soon" as unknown as number),
    ]);

    // No usable ttlMs declared anywhere -> default 7-day max age still applies.
    expect(isServerCacheValid(entry, definition)).toBe(true);
  });

  it("honors an entry-level ttlMs hint alongside per-tool declarations", () => {
    const definition = makeDefinition();
    const entry = makeEntry(definition, 0, [tool("search")]);
    entry.ttlMs = 1_000;

    vi.setSystemTime(BASE_TIME + 500);
    expect(isServerCacheValid(entry, definition)).toBe(true);

    vi.setSystemTime(BASE_TIME + 1_500);
    expect(isServerCacheValid(entry, definition)).toBe(false);

    // The tightest declaration wins across entry and tools.
    entry.ttlMs = 60_000;
    entry.tools = [tool("fast", 1_000)];
    vi.setSystemTime(BASE_TIME + 1_500);
    expect(isServerCacheValid(entry, definition)).toBe(false);
  });

  it("preserves the exact default max-age behavior when no ttlMs is declared", () => {
    const definition = makeDefinition();

    const sixDays = makeEntry(definition, 6 * DAY_MS, [tool("plain")]);
    expect(isServerCacheValid(sixDays, definition)).toBe(true);

    const eightDays = makeEntry(definition, 8 * DAY_MS, [tool("plain")]);
    expect(isServerCacheValid(eightDays, definition)).toBe(false);

    // Existing strict-greater-than boundary at the default max age is untouched.
    const exactlySevenDays = makeEntry(definition, DEFAULT_MAX_AGE_MS, [
      tool("plain"),
    ]);
    expect(isServerCacheValid(exactlySevenDays, definition)).toBe(true);
  });

  it("does not extend validity beyond the default max age when ttlMs is larger", () => {
    const definition = makeDefinition();

    const eightDays = makeEntry(definition, 8 * DAY_MS, [
      tool("slow", 14 * DAY_MS),
    ]);
    expect(isServerCacheValid(eightDays, definition)).toBe(false);

    const sixDays = makeEntry(definition, 6 * DAY_MS, [
      tool("slow", 14 * DAY_MS),
    ]);
    expect(isServerCacheValid(sixDays, definition)).toBe(true);
  });

  it("takes the minimum when an explicit maxAgeMs exceeds the declared ttlMs", () => {
    const definition = makeDefinition();

    const stale = makeEntry(definition, 11_000, [tool("search", 10_000)]);
    expect(isServerCacheValid(stale, definition, 60_000)).toBe(false);

    const fresh = makeEntry(definition, 9_000, [tool("search", 10_000)]);
    expect(isServerCacheValid(fresh, definition, 60_000)).toBe(true);
  });

  it("still respects an explicit maxAgeMs tighter than the declared ttlMs", () => {
    const definition = makeDefinition();

    const stale = makeEntry(definition, 11_000, [tool("search", 60_000)]);
    expect(isServerCacheValid(stale, definition, 10_000)).toBe(false);

    const fresh = makeEntry(definition, 9_000, [tool("search", 60_000)]);
    expect(isServerCacheValid(fresh, definition, 10_000)).toBe(true);
  });

  it("applies the declared ttlMs even when age checking is disabled via maxAgeMs <= 0", () => {
    const definition = makeDefinition();

    const expired = makeEntry(definition, 1_500, [tool("search", 1_000)]);
    expect(isServerCacheValid(expired, definition, 0)).toBe(false);

    const fresh = makeEntry(definition, 500, [tool("search", 1_000)]);
    expect(isServerCacheValid(fresh, definition, 0)).toBe(true);
  });

  it("keeps rejecting entries whose config hash no longer matches, ttl or not", () => {
    const definition = makeDefinition();
    const entry = makeEntry(definition, 0, [tool("search", 60_000)]);
    entry.configHash = "stale-hash";

    expect(isServerCacheValid(entry, definition)).toBe(false);
  });
});

describe("CacheableResult write-side pipeline", () => {
  it("serializeTools round-trips ttlMs and cacheScope onto cached tools", () => {
    const cached = serializeTools([
      { name: "a", ttlMs: 1_000, cacheScope: "private" },
      { name: "b" },
    ] as never);

    expect(cached).toHaveLength(2);
    expect(cached[0].ttlMs).toBe(1_000);
    expect(cached[0].cacheScope).toBe("private");
    expect(cached[1]).not.toHaveProperty("ttlMs");
    expect(cached[1]).not.toHaveProperty("cacheScope");
  });

  it("expires an entry built through OUR serializeTools writes at cachedAt + ttlMs", () => {
    const definition = makeDefinition();
    const entry = makeEntry(definition, 0, [
      ...serializeTools([{ name: "a", ttlMs: 1_000 }] as never),
    ]);

    vi.setSystemTime(BASE_TIME + 500);
    expect(isServerCacheValid(entry, definition)).toBe(true);

    vi.setSystemTime(BASE_TIME + 1_500);
    expect(isServerCacheValid(entry, definition)).toBe(false);
  });

  it("does not invent ttl hints when the list response declares none", () => {
    const cached = serializeTools([{ name: "a" }] as never);
    expect(cached[0]).not.toHaveProperty("ttlMs");
    expect(cached[0]).not.toHaveProperty("cacheScope");
  });
});

describe("fetchAllTools CacheableResult capture", () => {
  it("returns {tools, hints} and stamps page-level ttlMs/cacheScope on each tool of that page", async () => {
    const manager = new McpServerManager();

    const client = {
      listTools: vi
        .fn()
        .mockResolvedValueOnce({
          tools: [{ name: "fast" }],
          ttlMs: 5_000,
          cacheScope: "private",
          nextCursor: "cursor1",
        })
        .mockResolvedValueOnce({
          tools: [{ name: "slow" }],
          ttlMs: 60_000,
          nextCursor: undefined,
        }),
    };

    const result = await (manager as any).fetchAllTools(client, undefined);

    expect(result.tools).toHaveLength(2);
    // First page's declaration becomes the connection/entry-level hint (#431)...
    expect(result.hints).toEqual({ ttlMs: 5_000, cacheScope: "private" });
    // ...and every page stamps its own declaration onto that page's tools.
    expect(result.tools[0]).toEqual({
      name: "fast",
      ttlMs: 5_000,
      cacheScope: "private",
    });
    expect(result.tools[1]).toEqual({ name: "slow", ttlMs: 60_000 });
    expect(client.listTools).toHaveBeenCalledTimes(2);
  });

  it("leaves tools unstamped and omits hints when pages declare no usable ttlMs", async () => {
    const manager = new McpServerManager();

    const client = {
      listTools: vi.fn().mockResolvedValueOnce({
        tools: [{ name: "plain" }],
        ttlMs: "soon",
        nextCursor: undefined,
      }),
    };

    const result = await (manager as any).fetchAllTools(client, undefined);

    expect(result.hints).toBeUndefined();
    expect(result.tools).toEqual([{ name: "plain" }]);
  });

  it("keeps list hints at the result and cache-entry levels while stamping page tools", async () => {
    const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
    const agentDir = mkdtempSync(join(tmpdir(), "pi-mcp-cache-ttl-"));
    process.env.PI_CODING_AGENT_DIR = agentDir;
    try {
      const manager = new McpServerManager();
      const result = await (manager as any).fetchAllTools({
        listTools: vi.fn().mockResolvedValue({
          tools: [{ name: "search" }],
          ttlMs: 5_000,
          cacheScope: "private",
        }),
      });

      expect(result.hints).toEqual({ ttlMs: 5_000, cacheScope: "private" });
      expect(result.tools[0]).toMatchObject({ ttlMs: 5_000, cacheScope: "private" });

      updateMetadataCache(
        {
          config: { mcpServers: { demo: makeDefinition() } },
          manager: {
            getConnection: () => ({
              status: "connected",
              tools: result.tools,
              resources: [],
              prompts: [],
              toolListHints: result.hints,
            }),
          },
        } as any,
        "demo",
      );

      const cached = loadMetadataCache()?.servers.demo;
      expect(cached).toMatchObject({ ttlMs: 5_000, cacheScope: "private" });
    } finally {
      if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
      rmSync(agentDir, { recursive: true, force: true });
    }
  });
});
