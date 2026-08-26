    const PROBE_TIMEOUT_MS = 5_000;
    /** Pinned MCP protocol revision; shared with server-manager version negotiation. */
    export const MODERN_PROTOCOL_VERSION = "2026-07-28";
    const JSON_ACCEPT = "application/json, text/event-stream";
    const AMBIGUOUS_STATUSES = new Set([202, 401, 503]);
    
    export interface McpProbeResult {
      isMcp: boolean;
      classification: string;
    }
    
    const DISCOVER_REQUEST = {
      jsonrpc: "2.0",
      id: 1,
      method: "server/discover",
      params: {},
    };
    
    type JsonRpcEnvelopeInfo =
      | { kind: "result"; protocolVersion: unknown }
      | { kind: "error" };
    
    function jsonRpcEnvelopeInfo(value: unknown): JsonRpcEnvelopeInfo | null {
      if (typeof value !== "object" || value === null || (value as { jsonrpc?: unknown }).jsonrpc !== "2.0") {
        return null;
      }
      if ("result" in value) {
        const result = (value as { result?: unknown }).result;
        return {
          kind: "result",
          protocolVersion: typeof result === "object" && result !== null
            ? (result as { protocolVersion?: unknown }).protocolVersion
            : undefined,
        };
      }
      if ("error" in value) return { kind: "error" };
      return null;
    }
    
    function isBearerChallenge(response: Response): boolean {
      return /(?:^|,)\s*Bearer\b/i.test(response.headers.get("www-authenticate") ?? "");
    }
    
    function responseKind(response: Response): string {
      const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (contentType === "text/html") return "HTML";
      if (contentType) return contentType;
      return "an untyped response";
    }
    
    async function getJsonRpcEnvelopeInfo(response: Response): Promise<JsonRpcEnvelopeInfo | null> {
      try {
        return jsonRpcEnvelopeInfo(JSON.parse(await response.text()));
      } catch {
        return null;
      }
    }
    
    async function classifyModernResponse(response: Response): Promise<McpProbeResult> {
      const isSse = response.headers.get("content-type")?.toLowerCase().startsWith("text/event-stream");
      if (response.ok && isSse) {
        return { isMcp: true, classification: "endpoint responded with an MCP event stream" };
      }
    
      const envelope = await getJsonRpcEnvelopeInfo(response);
      if (response.ok && envelope) {
        if (envelope.kind === "error" || envelope.protocolVersion !== MODERN_PROTOCOL_VERSION) {
          return notMcp(response);
        }
        return {
          isMcp: true,
          classification: `endpoint supports stateless MCP ${MODERN_PROTOCOL_VERSION} server/discover`,
        };
      }
      if (response.status === 401 && isBearerChallenge(response) && envelope) {
        return {
          isMcp: true,
          classification: `endpoint requires Bearer authentication during MCP ${MODERN_PROTOCOL_VERSION} server/discover probing`,
        };
      }
    
      return notMcp(response);
    }
    
    function notMcp(response: Response): McpProbeResult {
      const responseDescription = `endpoint returned ${responseKind(response)} (${response.status})`;
      return {
        isMcp: false,
        classification: response.status === 503
          ? `${responseDescription} — server is temporarily unavailable; MCP endpoint shape could not be determined`
          : response.status === 202
            ? `${responseDescription} — MCP endpoint shape could not be determined`
          : response.status === 401
            ? `${responseDescription} — authentication may be required; MCP endpoint shape could not be determined`
            : `${responseDescription} — this URL does not appear to speak MCP`,
      };
    }
    
    /** Makes one unauthenticated metadata-only request to identify an HTTP endpoint's protocol shape. */
    export async function probeMcpEndpoint(url: string | URL): Promise<McpProbeResult> {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Accept: JSON_ACCEPT,
          "Content-Type": "application/json",
          "MCP-Protocol-Version": MODERN_PROTOCOL_VERSION,
          "Mcp-Method": "server/discover",
        },
        body: JSON.stringify(DISCOVER_REQUEST),
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      return classifyModernResponse(response);
    }
