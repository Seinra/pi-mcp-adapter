import { describe, expect, it, vi } from "vitest";
import type { Transport } from "@modelcontextprotocol/client";
import {
  enableReshapingProbeSiblings,
  installEnvelopeReshaping,
  reshapeResponseEnvelope,
} from "../envelope-reshape.ts";

function specMessage(topLevel: Record<string, unknown> = {}) {
  return {
    jsonrpc: "2.0",
    id: 1,
    ...topLevel,
    result: { tools: [{ name: "ok" }] },
  };
}

describe("reshapeResponseEnvelope", () => {
  it("moves top-level resultType and _meta into result", () => {
    const message = specMessage({
      resultType: "complete",
      _meta: { trace: "abc" },
    });
    const reshaped = reshapeResponseEnvelope(message) as Record<string, any>;
    expect(reshaped).not.toBe(message);
    expect(reshaped.resultType).toBeUndefined();
    expect(reshaped._meta).toBeUndefined();
    expect(reshaped.result).toEqual({
      tools: [{ name: "ok" }],
      resultType: "complete",
      _meta: { trace: "abc" },
    });
    expect(reshaped.jsonrpc).toBe("2.0");
    expect(reshaped.id).toBe(1);
  });

  it("is a no-op returning the same reference when neither member is present", () => {
    const message = specMessage();
    expect(reshapeResponseEnvelope(message)).toBe(message);
  });

  it("does not clobber members already present inside result", () => {
    const message = {
      jsonrpc: "2.0",
      id: 7,
      resultType: "complete",
      _meta: { topLevel: true },
      result: { resultType: "paged", _meta: { inner: true }, nextCursor: "c2" },
    };
    const reshaped = reshapeResponseEnvelope(message) as Record<string, any>;
    expect(reshaped.result.resultType).toBe("paged");
    expect(reshaped.result._meta).toEqual({ inner: true });
    expect(reshaped.result.nextCursor).toBe("c2");
    expect(reshaped.resultType).toBeUndefined();
    expect(reshaped._meta).toBeUndefined();
  });

  it("passes through error responses unchanged by reference", () => {
    const message = {
      jsonrpc: "2.0",
      id: 3,
      error: { code: -32601, message: "Method not found" },
    };
    expect(reshapeResponseEnvelope(message)).toBe(message);
  });

  it("passes through notifications unchanged by reference", () => {
    const message = {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    };
    expect(reshapeResponseEnvelope(message)).toBe(message);
  });

  it("passes through non-object inputs unchanged by reference", () => {
    for (const value of [null, "text", 42, true, [1, 2]]) {
      expect(reshapeResponseEnvelope(value)).toBe(value);
    }
  });
});

function createFakeTransport(preset?: (transport: Record<string, unknown>) => void): Transport {
  const transport: Record<string, unknown> = {};
  if (preset) preset(transport);
  return transport as unknown as Transport;
}

type RecordedCall = { message: unknown; extra: unknown };

function recordHandler(calls: RecordedCall[]) {
  return vi.fn((message: unknown, extra?: unknown) => {
    calls.push({ message, extra });
  });
}

const SPEC_ENVELOPE = {
  jsonrpc: "2.0",
  id: 9,
  resultType: "complete",
  result: { tools: [] },
};

describe("installEnvelopeReshaping", () => {
  it("wraps handlers assigned SDK-style after installation", () => {
    const transport = createFakeTransport();
    installEnvelopeReshaping(transport);
    const calls: RecordedCall[] = [];
    transport.onmessage = recordHandler(calls);

    // Simulate the transport's own internal `this.onmessage?.(...)` dispatch.
    transport.onmessage!(SPEC_ENVELOPE as never, { signal: undefined });

    expect(calls).toHaveLength(1);
    const received = calls[0].message as Record<string, any>;
    expect(received.result).toEqual({ tools: [], resultType: "complete" });
    expect(received.resultType).toBeUndefined();
    expect(calls[0].extra).toEqual({ signal: undefined });
  });

  it("still fires pre-set own-property handlers, reshaped", () => {
    const calls: RecordedCall[] = [];
    const handler = recordHandler(calls);
    const transport = createFakeTransport(t => {
      t.onmessage = handler;
    });
    installEnvelopeReshaping(transport);

    transport.onmessage!(SPEC_ENVELOPE as never);

    expect(calls).toHaveLength(1);
    expect((calls[0].message as Record<string, any>).result.resultType).toBe("complete");
  });

  it("uses the most recently assigned handler after reassignment", () => {
    const transport = createFakeTransport();
    installEnvelopeReshaping(transport);
    const firstCalls: RecordedCall[] = [];
    const secondCalls: RecordedCall[] = [];
    transport.onmessage = recordHandler(firstCalls);
    transport.onmessage = recordHandler(secondCalls);

    transport.onmessage!(specMessage() as never);

    expect(firstCalls).toHaveLength(0);
    expect(secondCalls).toHaveLength(1);
  });
});

describe("enableReshapingProbeSiblings", () => {
  it("shadows constructor so sibling probes reshape too, leaving identity intact", () => {
    const transport = createFakeTransport();
    const originalCtor = transport.constructor;
    enableReshapingProbeSiblings(transport);
    const shadowed = (transport as unknown as Record<string, unknown>).constructor;
    expect(shadowed).not.toBe(originalCtor);

    const sibling = new (shadowed as new (...args: unknown[]) => Transport)();
    const calls: RecordedCall[] = [];
    sibling.onmessage = recordHandler(calls);
    sibling.onmessage!(SPEC_ENVELOPE as never);

    expect(calls).toHaveLength(1);
    expect((calls[0].message as Record<string, any>).result.resultType).toBe("complete");
    // Prototype untouched: instanceof still holds for the original class.
    expect(sibling instanceof originalCtor).toBe(true);
  });

  it("tolerates transports whose constructor cannot be shadowed", () => {
    const transport = createFakeTransport();
    Object.defineProperty(transport, "constructor", {
      value: transport.constructor,
      writable: false,
      configurable: false,
    });
    expect(() => enableReshapingProbeSiblings(transport)).not.toThrow();
  });
});
