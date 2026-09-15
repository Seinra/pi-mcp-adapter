import type {
  JSONRPCMessage,
  MessageExtraInfo,
  Transport,
} from "@modelcontextprotocol/client";

/**
 * Reshape MCP 2026-07-28 spec-literal response envelopes into what the
 * installed @modelcontextprotocol/client 2.0.0 parser accepts.
 *
 * Evidence (node_modules/@modelcontextprotocol/client/dist/):
 * - src-D_zzAWoS.mjs:3178-3182 — response envelope schema is
 *   `z.object({jsonrpc,id,result}).strict()`, so top-level `resultType` /
 *   `_meta` siblings of `result` (13-discover.md example shape) fail
 *   `isJSONRPCResultResponse` and are dropped silently.
 * - src-D_zzAWoS.mjs:2813-2819 — the SDK's own RESULT schemas are loose and
 *   already declare `resultType`/`_meta`, so moving them INTO `result` is
 *   exactly the shape the rest of the SDK expects.
 */

/**
 * Move top-level `resultType` / `_meta` members of a JSON-RPC result response
 * into `result`, never overwriting members already there. Pure, synchronous,
 * total: any other input is returned unchanged (same reference).
 */
export function reshapeResponseEnvelope(message: unknown): unknown {
  if (typeof message !== "object" || message === null || Array.isArray(message)) {
    return message;
  }
  const envelope = message as Record<string, unknown>;
  if (typeof envelope.jsonrpc !== "string" || !("id" in envelope)) return message;
  const result = envelope.result;
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    return message;
  }
  const hasResultType = "resultType" in envelope;
  const hasMeta = "_meta" in envelope;
  if (!hasResultType && !hasMeta) return message;

  const mergedResult = { ...(result as Record<string, unknown>) };
  if (hasResultType && !("resultType" in mergedResult)) {
    mergedResult.resultType = envelope.resultType;
  }
  if (hasMeta && !("_meta" in mergedResult)) {
    mergedResult._meta = envelope._meta;
  }
  const reshaped: Record<string, unknown> = { ...envelope, result: mergedResult };
  delete reshaped.resultType;
  delete reshaped._meta;
  return reshaped;
}

type OnMessageHandler = Transport["onmessage"];

function reshapingDispatcher(inner: OnMessageHandler): OnMessageHandler {
  if (!inner) return undefined;
  return (message: JSONRPCMessage, extra?: MessageExtraInfo) => {
    inner(reshapeResponseEnvelope(message) as JSONRPCMessage, extra);
  };
}

/**
 * Marker for a spec-literal envelope line: `resultType` riding as a TOP-LEVEL
 * sibling of `result` (13-discover.md shape). Used as a cheap byte gate so
 * ordinary inbound lines are never JSON-parsed twice.
 */
const SPEC_ENVELOPE_MARKER = '"resultType"';

/**
 * Reshape one complete newline-delimited wire line BEFORE it enters the
 * transport's `ReadBuffer`. This level is required because the SDK validates
 * every inbound message with the STRICT `JSONRPCMessageSchema` inside
 * `ReadBuffer.readMessage` (`deserializeMessage`, src-D_zzAWoS.mjs:6674-6676):
 * a spec-literal envelope fails that parse and is routed to `onerror` by
 * `processReadBuffer`, so `onmessage`-level reshaping never sees it.
 *
 * Returns the original line unchanged unless reshaping applied.
 */
function reshapeWireLine(line: Buffer): Buffer {
  const text = line.toString("utf8");
  if (!text.includes(SPEC_ENVELOPE_MARKER)) return line;
  try {
    const parsed = JSON.parse(text);
    const reshaped = reshapeResponseEnvelope(parsed);
    if (reshaped === parsed) return line;
    return Buffer.from(JSON.stringify(reshaped), "utf8");
  } catch {
    // Malformed JSON: leave it for the SDK's normal parse-error path.
    return line;
  }
}

const NEWLINE_BYTE = 0x0a;
const NEWLINE = Buffer.from("\n", "utf8");
const EMPTY_CHUNK = Buffer.alloc(0);

/**
 * Wrap a `ReadBuffer.append` so every COMPLETE line is reshaped before the
 * SDK ever parses it; an incomplete trailing line is held back until the next
 * chunk (mirroring how `ReadBuffer` itself frames on `\n`).
 */
function wrapReadBufferAppend(
  buffer: { append: (chunk: Buffer) => void },
): void {
  const appendOriginal = buffer.append.bind(buffer);
  let tail: Buffer | undefined;
  buffer.append = (chunk: Buffer): void => {
    const data = tail !== undefined ? Buffer.concat([tail, chunk]) : chunk;
    tail = undefined;
    const parts: Buffer[] = [];
    let start = 0;
    while (true) {
      const newline = data.indexOf(NEWLINE_BYTE, start);
      if (newline === -1) break;
      parts.push(reshapeWireLine(data.subarray(start, newline)), NEWLINE);
      start = newline + 1;
    }
    if (start < data.length) tail = Buffer.from(data.subarray(start));
    appendOriginal(parts.length > 0 ? Buffer.concat(parts) : EMPTY_CHUNK);
  };
}

/**
 * Compose envelope reshaping onto a transport IN PLACE, same mechanism as
 * `wrapTransportWithMcpTrace` (mcp-trace.ts:242-272). Two complementary
 * interception points are installed:
 *
 * 1. BYTE LEVEL (`_readBuffer.append`, stdio-shaped transports): the SDK
 *    validates every inbound message with the STRICT `JSONRPCMessageSchema`
 *    inside `ReadBuffer.readMessage` (src-D_zzAWoS.mjs:6674-6676), so a
 *    spec-literal envelope dies before dispatch and reaches `onerror` instead
 *    of `onmessage`. Reshaping the raw line pre-parse is the only point that
 *    fixes both the probe sibling and the session transport.
 * 2. HANDLER LEVEL (own `onmessage` accessor): required because a plain
 *    pre-connect closure cannot work:
 *    - `Protocol.connect` chains a pre-set handler (src-D_zzAWoS.mjs:5754-5762),
 *      but the era-probe `ProbeWindow` REPLACES `onmessage` and deliberately does
 *      not forward inbound messages during the window (dist/index.mjs:2509-2535).
 *    - Only an own property accessor intercepts both outside assignments AND the
 *      transport's internal `this.onmessage?.(...)` dispatch.
 *
 * The setter routes storage through any pre-existing descriptor (e.g. the
 * tracing accessor) and re-reads the effective handler afterwards, so
 * co-installed wrappers keep working regardless of installation order.
 */
export function installEnvelopeReshaping<T extends Transport>(transport: T): T {
  const underlying = Object.getOwnPropertyDescriptor(transport, "onmessage");
  // Transports without an own `onmessage` descriptor get a closure-backed
  // slot; writing through `transport.onmessage = ...` there would re-enter
  // this very accessor and recurse forever.
  let fallbackHandler: OnMessageHandler;
  const readUnderlying = (): OnMessageHandler => {
    if (!underlying) return fallbackHandler;
    return underlying.get
      ? (underlying.get.call(transport) as OnMessageHandler)
      : (underlying.value as OnMessageHandler);
  };
  const writeUnderlying = (handler: OnMessageHandler): void => {
    if (!underlying) {
      fallbackHandler = handler;
    } else if (underlying.set) {
      underlying.set.call(transport, handler);
    } else {
      Object.defineProperty(transport, "onmessage", { ...underlying, value: handler });
    }
  };

  let dispatched: OnMessageHandler = reshapingDispatcher(readUnderlying());
  try {
    Object.defineProperty(transport, "onmessage", {
      configurable: true,
      enumerable: true,
      get: () => dispatched,
      set(handler: OnMessageHandler) {
        writeUnderlying(handler);
        dispatched = reshapingDispatcher(readUnderlying());
      },
    });
  } catch {
    // Best-effort, like mcp-trace.ts: never change connection behavior.
    return transport;
  }
  try {
    const buffer = (
      transport as { _readBuffer?: { append: (chunk: Buffer) => void } }
    )._readBuffer;
    if (typeof buffer?.append === "function") wrapReadBufferAppend(buffer);
  } catch {
    // Best-effort: never change connection behavior.
  }
  return transport;
}

/**
 * Make the SDK's DISPOSABLE PROBE SIBLING reshape envelopes too. In pin/auto
 * mode the SDK probes `server/discover` on a sibling constructed from the
 * session transport's own constructor (dist/index.mjs:2777-2780:
 * `const SiblingTransport = sessionTransport.constructor`), which bypasses
 * anything installed on the session transport. Shadowing the own
 * `constructor` property with a subclass that installs the accessor fixes the
 * sibling while leaving the prototype — and the `_dispose` marker
 * `readStdioServerParams` checks (dist/index.mjs:2757-2761) — untouched.
 */
export function enableReshapingProbeSiblings(transport: Transport): void {
  const BaseCtor = transport.constructor as new (...args: unknown[]) => Transport;
  if (typeof BaseCtor !== "function") return;
  class ReshapingProbeSibling extends BaseCtor {
    constructor(...args: unknown[]) {
      super(...args);
      installEnvelopeReshaping(this);
    }
  }
  try {
    Object.defineProperty(transport, "constructor", {
      value: ReshapingProbeSibling,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  } catch {
    // Best-effort: HTTP transports always probe in place and stay covered by
    // installEnvelopeReshaping alone.
  }
}
