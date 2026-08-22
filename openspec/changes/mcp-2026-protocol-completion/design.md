# Design: MCP 2026-07-28 Protocol Completion

## 1. Architecture Overview

The protocol completion features flow through three layers:

```
┌─────────────────────────────────────────────────────────────────┐
│                     CALLER LAYER                                 │
│  Proxy Tool (mcp)          │  Direct Tool Executor              │
│  protocolVersion arg ──────►│  DirectToolSpec.protocolVersion    │
│  Resource Templates API    │  Completions API                   │
│  Progress token per call   │  Progress token per call           │
└──────────────┬──────────────┴────────────────┬──────────────────┘
               │                                │
               ▼                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                  SERVER MANAGER LAYER                            │
│  buildClientCapabilities(protocolVersion?)  ← P0 Fix             │
│  getRequestOptions(name, signal, protocolVersion?)               │
│  fetchAllResourceTemplates(client, requestOptions)               │
│  listResourceTemplates(name): Promise<McpResourceTemplate[]>     │
│  complete(name, ref, argument, signal?): Promise<McpCompletionResult>│
│  Progress: notifications/progress handler + progressListeners Map│
│  ServerConnection.resourceTemplates: McpResourceTemplate[]       │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    SDK / TRANSPORT LAYER                         │
│  Client.callTool({ name, arguments, _meta: { protocolVersion,  │
│                   progressToken } }, requestOptions)            │
│  client.complete() or client.request({ method: "completions/complete" })│
│  client.request({ method: "resources/templates/list" })         │
│  notifications/progress handler registered on client             │
└─────────────────────────────────────────────────────────────────┘
```

**Key flows:**

1. **Structured Content**: SDK `CallToolResult` includes `structuredContent`, `outputSchema`, `progressToken`. Captured in `executeCall` and `createDirectToolExecutor`, surfaced in `details`.
2. **Resource Templates**: Fetched during connection via `resources/templates/list` with pagination. Stored on `ServerConnection`. Exposed via `manager.listResourceTemplates()`.
3. **Completions**: Raw `manager.complete()` forwards to SDK `client.complete()` or `client.request({ method: "completions/complete" })`.
4. **Progress Notifications**: Register `notifications/progress` handler on client at connection time. Per-request listeners in `progressListeners: Map<string, (notification) => void>` correlated by `progressToken`. Surfaced via Pi notification system (`ctx.ui.notify` or `state.ui.notify`).

---

## 2. Data Flow Diagrams

### 2.1 Connection Establishment with Resource Templates

```
┌─────────────┐     connect()      ┌──────────────────┐
│  Server     │ ─────────────────►  │   SDK Client     │
│  Manager    │  buildClientCapabilities(protocolVersion)  │
└─────────────┘  omit sampling     └────────┬─────────┘
      │                            when 2026-07-28
      │
      ▼
┌──────────────────┐
│  createClient    │
│  attach handlers │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  fetchAllTools   │
│  fetchAllResources│
│  fetchAllPrompts │
└────────┬─────────┘
         │
         ▼
┌──────────────────────────────────┐
│  fetchAllResourceTemplates       │
│  (only if resources.templates    │
│   capability advertised)         │
│  pagination via nextCursor       │
└────────┬─────────────────────────┘
         │
         ▼
┌──────────────────────────────────┐
│  ServerConnection                │
│  { client, transport, def,       │
│    tools, resources, prompts,    │
│    resourceTemplates: [...] }    │
└──────────────────────────────────┘
```

**Pagination rule:** All pages combined into single `McpResourceTemplate[]` on connection. No per-page metadata needed.

### 2.2 Tool Call with Structured Content, Progress Token, and Resource Links

```
┌──────────────┐                    ┌─────────────────────┐
│   Caller     │  mcp({tool, args,  │  executeCall /      │
│  (proxy or   │   protocolVersion: │  createDirectTool   │
│   direct)    │   "2026-07-28",    │  Executor           │
│              │   progressToken:   │                     │
│              │   "token-123" })   │                     │
└──────┬───────┘                    └──────────┬──────────┘
       │                                         │
       │ protocolVersion, progressToken          │
       ▼                                         ▼
┌──────────────────────┐               ┌─────────────────────┐
│ getRequestOptions(   │               │ requestOptions =    │
│  server, signal,     │─────────────► │ { signal, timeout,  │
│  protocolVersion )   │               │   _meta: {          │
└──────────────────────┘               │     protocolVersion │
                                       │   } }               │
                                       └──────────┬──────────┘
                                                  │
         ┌───────────────────────────────────────┼───────────────────────┐
         ▼                                       ▼                       ▼
┌────────────────────┐               ┌─────────────────────┐   ┌────────────────────┐
│ Register progress  │               │ callTool({name,     │   │ Register one-shot  │
│ listener for       │               │  arguments,         │   │ progress listener  │
│ "token-123"        │               │  _meta: {           │   │ for "token-123"    │
│ (if progressToken  │               │    protocolVersion, │   │ (in executeCall/   │
│  in request)       │               │    progressToken    │   │  createDirectTool  │
└────────────────────┘               │  }}, requestOptions)│   │  Executor)         │
                                     └──────────┬──────────┘   └────────────────────┘
                                                │
                                                │ CallToolResult
                                                │ { content: [...],
                                                │   structuredContent: {...},
                                                │   outputSchema: {...},
                                                │   _meta: { progressToken,
                                                │   serverInfo: {...} } }
                                                ▼
                                     ┌─────────────────────┐
                                     │  Capture Metadata   │
                                     │  resultMeta = {     │
                                     │   structuredContent,│
                                     │   outputSchema,     │
                                     │   progressToken     │
                                     │   resultType,       │
                                     │   serverInfo        │
                                     │ }                   │
                                     └──────────┬──────────┘
                                                │
                                                ▼
                                     ┌─────────────────────┐
                                     │  ProxyToolResult /  │
                                     │  AgentToolResult    │
                                     │  details: {         │
                                     │   server, tool,     │
                                     │   structuredContent,│
                                     │   outputSchema,     │
                                     │   progressToken,    │
                                     │   resultType,       │
                                     │   serverInfo,       │
                                     │   content: [        │
                                     │     typed McpContent│
                                     │     blocks ]        │
                                     │ }                   │
                                     └─────────────────────┘
```

### 2.3 Progress Notification Flow

```
┌──────────────┐     Server emits      ┌──────────────────────┐
│   Server     │  notifications/progress│  SDK Client          │
│  (long-run)  │  { progressToken:     │  (handler registered │
│              │   "token-123",        │   at connection time)│
│              │   progress: 50,       │                      │
│              │   total: 100,         │                      │
│              │   message: "..." }    │                      │
└──────┬───────┘                       └──────────┬───────────┘
       │                                            │
       │                                            ▼
       │                            ┌────────────────────────────┐
       │                            │  Handler looks up          │
       │                            │  progressListeners.get(    │
       │                            │    "token-123" )           │
       │                            └──────────────┬─────────────┘
       │                                           │
       │                        ┌──────────────────┴──────────────────┐
       │                        ▼                                     ▼
       │               ┌─────────────────┐                 ┌─────────────────┐
       │               │ Listener found  │                 │ No listener     │
       │               │ → Call with     │                 │ → Drop silently │
       │               │ McpProgressNoti-│                 │                 │
       │               │ fication        │                 │                 │
       │               └────────┬────────┘                 └─────────────────┘
       │                        │
       │                        ▼
       │               ┌─────────────────┐
       │               │ Surface via Pi  │
       │               │ notification    │
       │               │ system          │
       │               │ (ui.notify)     │
       │               └────────┬────────┘
       │                        │
       │               ┌────────┴────────┐
       │               ▼                 ▼
       │      ┌────────────────┐ ┌────────────────┐
       │      │ Proxy path:    │ │ Direct path:   │
       │      │ state.ui?.notify│ │ state.ui?.notify│
       │      │ or ctx.ui.notify│ │ (via getState)  │
       │      └────────────────┘ └────────────────┘
       │
       ▼ Tool completes (success/error)
┌──────────────────────┐
│  Cleanup:            │
│  progressListeners.  │
│  delete("token-123") │
└──────────────────────┘
```

### 2.4 Completions Raw Exposure

```
┌─────────────┐   manager.complete(    ┌──────────────────┐
│   Caller    │  name, ref, argument,  │   Server Manager │
│             │  signal )              │                  │
└──────┬──────┘                        └────────┬─────────┘
       │                                        │
       │                                        ▼
       │                          ┌────────────────────────┐
       │                          │  Get connection        │
       │                          │  Check completions     │
       │                          │  capability advertised │
       │                          └───────────┬────────────┘
       │                                      │
       │                                      ▼
       │                          ┌────────────────────────┐
       │                          │  Try client.complete() │
       │                          │  (SDK 1.9+)            │
       │                          └───────────┬────────────┘
       │                                      │
       │                    ┌─────────────────┴─────────────────┐
       │                    ▼                                   ▼
       │           ┌─────────────────┐                 ┌─────────────────┐
       │           │ Success         │                 │ Fallback to     │
       │           │ Return result   │                 │ client.request({│
       │           │                 │                 │  method: "com-  │
       │           └─────────────────┘                 │  pletions/       │
       │                                              │  complete" })   │
       │                                              └────────┬────────┘
       │                                                       │
       ▼                                                       ▼
┌────────────────────────────────────────────────────────────────────┐
│ Returns McpCompletionResult:                                       │
│ { completion: { values: string[], total?: number,                 │
│                 hasMore?: boolean } }                              │
│ NO UI integration — caller decides how to use completion values.  │
└────────────────────────────────────────────────────────────────────┘
```

---

## 3. Component Interfaces — Exact Function Signatures

### 3.1 `types.ts`

```typescript
// NEW: Resource Template types
export interface McpResourceTemplate {
  uriTemplate: string;
  name: string;
  description?: string;
  mimeType?: string;
  _meta?: Record<string, unknown>;
}

export interface ListResourceTemplatesResult {
  resourceTemplates: McpResourceTemplate[];
  nextCursor?: string;
  _meta?: Record<string, unknown>;
}

// NEW: Completions types
export interface McpCompletionArgument {
  name: string;
  value: string;
}

export interface McpCompletionContext {
  type: "ref/prompt" | "ref/resource" | string;
  name: string;
}

export interface McpCompletionResult {
  completion: {
    values: string[];
    total?: number;
    hasMore?: boolean;
  };
}

// NEW: Progress Notification types
export interface McpProgressNotification {
  progressToken: string | number;
  progress: number;
  total?: number;
  message?: string;
}

// EXTENDED: McpContent with resource_link and resource types
export interface McpContent {
  type: "text" | "image" | "audio" | "resource" | "resource_link";
  text?: string;
  data?: string;
  mimeType?: string;
  // resource_link fields
  uri?: string;
  name?: string;
  description?: string;
  // resource fields
  resource?: {
    uri: string;
    text?: string;
    blob?: string;
    mimeType?: string;
  };
}

// EXTENDED: McpCallToolResultMeta with structuredContent, outputSchema, progressToken
export interface McpCallToolResultMeta {
  protocolVersion?: string;
  structuredContent?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  progressToken?: string | number;
}

// EXTENDED: ServerConnection with resourceTemplates
export interface ServerConnection {
  client: Client;
  transport: Transport;
  definition: ServerDefinition;
  tools: McpTool[];
  toolsRevision?: number;
  resources: McpResource[];
  prompts: McpPrompt[];
  promptDiscoveryFailed?: boolean;
  instructions?: string;
  lastUsedAt: number;
  inFlight: number;
  status: "connected" | "closed" | "needs-auth";
  credentialsInvalidated?: boolean;
  // NEW:
  resourceTemplates: McpResourceTemplate[];
}

// EXTENDED: DirectToolSpec already has protocolVersion (from 2026-07-28 support)
// No change needed for protocolVersion field

// EXTENDED: CachedTool already has uiStreamMode, uiResourceUri, uiVisibility
// No change needed for template caching (optional)
```

### 3.2 `server-manager.ts`

```typescript
class McpServerManager {
  // ... existing fields ...
  
  // NEW: Progress listeners map (token -> handler)
  private progressListeners = new Map<string, (notification: McpProgressNotification) => void>();

  // P0 FIX: Modified signature with protocolVersion parameter
  private buildClientCapabilities(protocolVersion?: string): Record<string, unknown> {
    const caps: Record<string, unknown> = {};
    
    // Sampling OMITTED when protocolVersion === "2026-07-28"
    if (this.samplingConfig && protocolVersion !== "2026-07-28") {
      caps.sampling = {};
    }
    
    if (this.elicitationConfig) {
      caps.elicitation = {
        form: {},
        ...(this.elicitationConfig.allowUrl ? { url: {} } : {}),
      };
    }
    
    return caps;
  }

  // createClient calls buildClientCapabilities with resolved version
  private createClient(serverName: string, definition: ServerDefinition): Client {
    const versionNegotiation = resolveVersionNegotiation(definition);
    // Extract protocol version from versionNegotiation or definition
    let protocolVersion: string | undefined;
    if (definition.protocolVersion === "2026-07-28") {
      protocolVersion = "2026-07-28";
    } else if (definition.protocolVersion === "legacy") {
      protocolVersion = "legacy";
    } else if (definition.protocolVersion === "auto") {
      // Auto-negotiated; we don't know yet at client creation time
      // Pass undefined — sampling will be included (legacy-safe)
      protocolVersion = undefined;
    }
    
    const capabilities = this.buildClientCapabilities(protocolVersion);
    // ... rest unchanged
  }

  // connectHttpClient also needs to pass protocolVersion
  // The version is resolved from definition.protocolVersion same as above

  // NEW: Fetch all resource templates with pagination
  private async fetchAllResourceTemplates(
    client: Client,
    requestOptions?: RequestOptions,
  ): Promise<McpResourceTemplate[]> {
    const allTemplates: McpResourceTemplate[] = [];
    let cursor: string | undefined;
    
    do {
      // Try SDK method first (if available), fallback to raw request
      let result: ListResourceTemplatesResult;
      if (typeof client.listResourceTemplates === "function") {
        result = await client.listResourceTemplates(
          cursor ? { cursor } : undefined,
          requestOptions,
        );
      } else {
        result = await client.request(
          { method: "resources/templates/list", params: cursor ? { cursor } : undefined },
          requestOptions,
        ) as ListResourceTemplatesResult;
      }
      
      allTemplates.push(...(result.resourceTemplates ?? []));
      cursor = result.nextCursor;
    } while (cursor);
    
    return allTemplates;
  }

  // Modified createConnection: populate resourceTemplates
  private async createConnection(...): Promise<ServerConnection> {
    // ... existing code ...
    
    const [tools, resources, promptResult, resourceTemplates] = await Promise.all([
      this.fetchAllTools(client, requestOptions),
      this.fetchAllResources(client, requestOptions),
      this.fetchAllPrompts(client, requestOptions),
      // Only fetch if server advertises resources.templates capability
      (client.getServerCapabilities?.()?.resources?.templates
        ? this.fetchAllResourceTemplates(client, requestOptions)
        : Promise.resolve([])),
    ]);
    
    const connection: ServerConnection = {
      // ... existing fields ...
      resourceTemplates, // NEW: always initialized (empty array if no capability)
    };
    
    return connection;
  }

  // NEW: Public API for resource templates
  listResourceTemplates(name: string): Promise<McpResourceTemplate[]> {
    const connection = this.connections.get(name);
    if (!connection || connection.status !== "connected") {
      throw new Error(`Server "${name}" is not connected`);
    }
    return connection.resourceTemplates;
  }

  // NEW: Completions raw exposure
  async complete(
    name: string,
    ref: McpCompletionContext,
    argument: McpCompletionArgument,
    signal?: AbortSignal,
  ): Promise<McpCompletionResult> {
    const connection = this.connections.get(name);
    if (!connection || connection.status !== "connected") {
      throw new Error(`Server "${name}" is not connected`);
    }
    
    const capabilities = connection.client.getServerCapabilities?.();
    if (!capabilities?.completions) {
      throw new Error(`Server "${name}" does not support completions`);
    }
    
    const requestOptions = this.getRequestOptions(name, signal);
    
    try {
      // Try SDK method first (if available)
      if (typeof connection.client.complete === "function") {
        return await connection.client.complete(
          { ref, argument },
          requestOptions,
        ) as McpCompletionResult;
      }
      // Fallback to raw request
      return await connection.client.request(
        { method: "completions/complete", params: { ref, argument } },
        requestOptions,
      ) as McpCompletionResult;
    } catch (error) {
      // Don't wrap; let caller handle
      throw error;
    }
  }

  // NEW: Progress notification handler registration (called in createConnection)
  private attachProgressNotificationHandler(serverName: string, client: Client): void {
    client.setNotificationHandler(
      "notifications/progress",
      (notification: McpProgressNotification) => {
        const listener = this.progressListeners.get(String(notification.progressToken));
        if (listener) {
          listener(notification);
        }
        // No listener = drop silently (not our token)
      },
    );
  }

  // NEW: Register a one-shot progress listener for a tool call
  registerProgressListener(
    progressToken: string | number,
    handler: (notification: McpProgressNotification) => void,
  ): void {
    this.progressListeners.set(String(progressToken), handler);
  }

  // NEW: Unregister progress listener (called after tool completes)
  unregisterProgressListener(progressToken: string | number): void {
    this.progressListeners.delete(String(progressToken));
  }

  // getRequestOptions already accepts protocolVersion (from 2026-07-28 support)
  // No change needed
}
```

### 3.3 `proxy-modes.ts`

```typescript
// Extended executeCall signature (protocolVersion already added in 2026-07-28 support)
// Added: progressToken support via requestOptions._meta

export async function executeCall(
  state: McpExtensionState,
  toolName: string,
  args?: Record<string, unknown>,
  serverOverride?: string,
  getPiTools?: () => ToolInfo[],
  signal?: AbortSignal,
  origin?: "proxy" | "script",
  protocolVersion?: string, // already exists
  progressToken?: string | number, // NEW
): Promise<ProxyToolResult> {
  // ... existing code up to callTool ...
  
  // NEW: Build requestOptions with progressToken in _meta
  const requestOptions = state.manager.getRequestOptions(
    serverName, 
    ownedSignal, 
    protocolVersion,
  );
  
  // Add progressToken to _meta if provided
  if (progressToken !== undefined) {
    requestOptions._meta = {
      ...requestOptions._meta,
      progressToken,
    };
  }
  
  // NEW: Register one-shot progress listener if progressToken provided
  let progressCleanup: (() => void) | undefined;
  if (progressToken !== undefined) {
    const progressHandler = (notification: McpProgressNotification) => {
      // Surface via Pi notification system
      const message = notification.message 
        ? `${notification.message} (${notification.progress}${notification.total !== undefined ? `/${notification.total}` : ""})`
        : `Progress: ${notification.progress}${notification.total !== undefined ? `/${notification.total}` : ""}`;
      
      const progressPercent = notification.total 
        ? Math.round((notification.progress / notification.total) * 100)
        : undefined;
      
      // Use state.ui (proxy execution context) or fallback
      state.ui?.notify(message, progressPercent !== undefined ? "progress" : "info");
    };
    
    state.manager.registerProgressListener(progressToken, progressHandler);
    progressCleanup = () => state.manager.unregisterProgressListener(progressToken);
  }
  
  try {
    const result = await withSessionRecovery<ClientCallToolResult>(
      // ... existing ...
      (conn) => abortable(conn.client.callTool({
        name: toolMeta.originalName,
        arguments: normalizedArgs,
        _meta: {
          ...uiSession?.requestMeta,
          ...(progressToken !== undefined ? { progressToken } : {}),
        },
      }, requestOptions), ownedSignal),
    );
    
    // NEW: Capture structuredContent, outputSchema, progressToken from result
    const resultMeta: McpCallToolResultMeta = {
      protocolVersion: result._meta?.protocolVersion,
      structuredContent: (result as any).structuredContent,
      outputSchema: (result as any).outputSchema,
      progressToken: result._meta?.progressToken,
    };
    
    // Also capture resultType and serverInfo (from 2026-07-28 support)
    if (result.resultType) resultMeta.resultType = result.resultType;
    if (result._meta?.serverInfo) resultMeta.serverInfo = result._meta.serverInfo;
    
    // NEW: Transform content to include typed resource_link and resource blocks
    const content = transformMcpContent(result.content ?? [], state.owner?.signal);
    
    const details = {
      server: serverName,
      tool: toolMeta.originalName,
      ...(resultMeta.resultType ? { resultType: resultMeta.resultType } : {}),
      ...(resultMeta.serverInfo ? { serverInfo: resultMeta.serverInfo } : {}),
      ...(resultMeta.structuredContent !== undefined ? { structuredContent: resultMeta.structuredContent } : {}),
      ...(resultMeta.outputSchema !== undefined ? { outputSchema: resultMeta.outputSchema } : {}),
      ...(resultMeta.progressToken !== undefined ? { progressToken: resultMeta.progressToken } : {}),
      ...guardedMcpDetails(guarded),
    };
    
    return { content, isError: result.isError, details };
  } finally {
    // NEW: Cleanup progress listener
    if (progressCleanup) progressCleanup();
  }
}
```

### 3.4 `direct-tools.ts`

```typescript
// DirectToolSpec already has protocolVersion (from 2026-07-28 support)

export function createDirectToolExecutor(
  getState: () => McpExtensionState | null,
  getInitPromise: () => Promise<McpExtensionState> | null,
  spec: DirectToolSpec,
): DirectToolExecute {
  return async function execute(_toolCallId, params, signal) {
    // ... existing code up to callTool ...
    
    const requestOptions = state.manager.getRequestOptions(
      spec.serverName, 
      ownedSignal, 
      spec.protocolVersion,
    );
    
    // NEW: Support progressToken from spec (if passed via _meta or added to spec)
    // For now, spec doesn't have progressToken — can be added later if needed
    
    const result = await withSessionRecovery<ClientCallToolResult>(
      // ... existing ...
      (conn) => abortable(conn.client.callTool({
        name: spec.originalName,
        arguments: normalizedParams,
        _meta: uiSession?.requestMeta,
      }, requestOptions), ownedSignal),
    );
    
    // NEW: Capture structuredContent, outputSchema, progressToken
    const resultMeta: McpCallToolResultMeta = {
      protocolVersion: result._meta?.protocolVersion,
      structuredContent: (result as any).structuredContent,
      outputSchema: (result as any).outputSchema,
      progressToken: result._meta?.progressToken,
    };
    
    if (result.resultType) resultMeta.resultType = result.resultType;
    if (result._meta?.serverInfo) resultMeta.serverInfo = result._meta.serverInfo;
    
    // ... existing content transformation ...
    
    return {
      content: guarded.content,
      details: {
        server: spec.serverName,
        tool: spec.originalName,
        ...(resultMeta.resultType ? { resultType: resultMeta.resultType } : {}),
        ...(resultMeta.serverInfo ? { serverInfo: resultMeta.serverInfo } : {}),
        ...(resultMeta.structuredContent !== undefined ? { structuredContent: resultMeta.structuredContent } : {}),
        ...(resultMeta.outputSchema !== undefined ? { outputSchema: resultMeta.outputSchema } : {}),
        ...(resultMeta.progressToken !== undefined ? { progressToken: resultMeta.progressToken } : {}),
        ...guardedMcpDetails(guarded),
      },
    };
  };
}
```

### 3.5 `metadata-cache.ts` (Optional)

```typescript
// NEW: CachedResourceTemplate
export interface CachedResourceTemplate {
  uriTemplate: string;
  name: string;
  description?: string;
  mimeType?: string;
}

// EXTENDED: ServerCacheEntry
export interface ServerCacheEntry {
  configHash: string;
  tools: CachedTool[];
  resources: CachedResource[];
  prompts?: CachedPrompt[];
  instructions?: string;
  cachedAt: number;
  // NEW: optional, only persisted if template caching is implemented
  resourceTemplates?: CachedResourceTemplate[];
}

// CACHE_VERSION bump (only if template caching implemented)
const CACHE_VERSION = 2; // or keep at 1 if not caching templates

export function serializeTools(tools: McpTool[]): CachedTool[] {
  // ... existing logic ...
  // NEW: spread ttlMs and cacheScope when defined (from 2026-07-28 support)
  // Already handled by McpTool interface having those fields
}

export function reconstructToolMetadata(
  serverName: string,
  entry: ServerCacheEntry,
  prefix: ToolPrefix,
  definition: Pick<ServerEntry, "exposeResources" | "includeTools" | "excludeTools" | "toolPrefix">,
  configuredServers?: Record<string, ServerEntry>,
  cache?: MetadataCache,
): ToolMetadata[] {
  // ... existing logic ...
  // NEW: templates not reconstructed by default (separate API)
}
```

---

## 4. Key Design Decisions

### 4.1 Protocol Version Resolution at Call Sites

| Call Site | Resolution Logic |
| ----------- | ------------------ |
| `createClient` (stdio/Unix) | From `definition.protocolVersion`: `"2026-07-28"` → pass `"2026-07-28"`; `"legacy"` → pass `"legacy"`; `"auto"` or `undefined` → pass `undefined` (legacy-safe, sampling included) |
| `connectHttpClient` | Same as above; resolved before HTTP transport selection |
| `getRequestOptions` / `buildRequestOptions` | Receives `protocolVersion` from caller (proxy `mcp({ protocolVersion })`, direct `DirectToolSpec.protocolVersion`, or server config default) |
| `manager.complete()` / `manager.listResourceTemplates()` | Uses connection's negotiated version (stored implicitly via client); no per-request override |

**Rationale:** Connection-negotiated version (via SDK `versionNegotiation`) determines server capabilities. Per-request `protocolVersion` in `_meta` is for edge cases (e.g., testing, multi-version server). The P0 fix for sampling only cares about the pinned version at connection time.

### 4.2 Progress Listener Registration Timing

1. **Connection-time**: Global `notifications/progress` handler registered once per client in `attachProgressNotificationHandler` (called from `createConnection`).
2. **Per-request**: One-shot listener registered in `executeCall` / `createDirectToolExecutor` **before** `callTool` when `progressToken` is provided.
3. **Cleanup**: Listener removed in `finally` block after tool completes (success or error).

**Race condition mitigation**: Handler registered before call; SDK guarantees in-order delivery. Token correlation ensures correct listener invoked.

### 4.3 Pi Notification System Integration

- **Proxy path (`executeCall`)**: Has access to `state.ui` (the Pi UI context). Uses `state.ui?.notify(message, type)` where `type` can be `"progress"`, `"info"`, etc.
- **Direct path (`createDirectToolExecutor`)**: Has access to `state.ui` via `getState()`. Same pattern.
- **Progress handler in server-manager**: Receives `McpProgressNotification` but has no direct UI context. The per-request listener (registered by proxy/direct) captures the UI context at registration time and calls `ui.notify`.

**Notification payload**:

```typescript
const message = notification.message 
  ? `${notification.message} (${notification.progress}${notification.total !== undefined ? `/${notification.total}` : ""})`
  : `Progress: ${notification.progress}${notification.total !== undefined ? `/${notification.total}` : ""}`;

const progressPercent = notification.total 
  ? Math.round((notification.progress / notification.total) * 100)
  : undefined;

ui.notify(message, progressPercent !== undefined ? "progress" : "info");
```

### 4.4 Fallback for SDK Methods

| Feature | Primary SDK Method | Fallback |
| --------- | ------------------- | ---------- |
| Resource Templates | `client.listResourceTemplates()` | `client.request({ method: "resources/templates/list" })` |
| Completions | `client.complete()` | `client.request({ method: "completions/complete" })` |
| Progress Notifications | `client.setNotificationHandler("notifications/progress", ...)` | Same (notification handler API stable) |

**Implementation pattern**: Check `typeof client.method === "function"` before calling; fallback to `client.request()` with explicit method name.

### 4.5 Error Handling for Unsupported Capabilities

| Operation | Missing Capability | Behavior |
| ----------- | ------------------- | ---------- |
| `listResourceTemplates` | `resources.templates` not advertised | Return `[]` (empty array) — not an error |
| `complete` | `completions` not advertised | Throw `Error: Server "name" does not support completions` |
| Progress notifications | `notifications/progress` not sent by server | Handler never invoked; no error |
| Structured content | Not in `CallToolResult` | Fields omitted from `details`; no error |

---

## 5. File Change Summary

| File | Change Type | Est. Lines |
| ------ | ------------- | ------------ |
| `types.ts` | New interfaces + extended types | ~60 |
| `server-manager.ts` | `buildClientCapabilities` fix, `fetchAllResourceTemplates`, `complete`, progress handlers, `resourceTemplates` field, `listResourceTemplates` | ~120 |
| `proxy-modes.ts` | Structured content capture, progress listener registration/cleanup in `executeCall` | ~50 |
| `direct-tools.ts` | Structured content capture in `createDirectToolExecutor` | ~30 |
| `metadata-cache.ts` | Optional: `CachedResourceTemplate`, `ServerCacheEntry.resourceTemplates`, `CACHE_VERSION` bump | ~25 |

**Total:** ~285 lines across 4-5 files. All changes additive; no breaking changes to existing APIs.

---

## 6. Rollback Plan

Revert the 4-5 modified files. No config migration needed — new fields are optional. If `metadata-cache.ts` `CACHE_VERSION` bumped, old caches ignored automatically (existing `loadMetadataCache` returns `null` on version mismatch).

---

## 7. Testing Strategy

### 7.1 Unit Tests (per modified function)

| File | Function | Test Cases |
| ------ | ---------- | ------------ |
| `types.ts` | Type compilation | All new interfaces construct; `McpContent` discriminant works for `resource_link`/`resource`; `McpCallToolResultMeta` accepts all new fields |
| `server-manager.ts` | `buildClientCapabilities` | `protocolVersion: "2026-07-28"` → no `sampling`; `protocolVersion: "legacy"` → `sampling` when config exists; no config → no `sampling` |
| | `fetchAllResourceTemplates` | Pagination across pages; empty when no capability; SDK method + fallback |
| | `listResourceTemplates` | Returns typed array; throws when not connected; returns `[]` when no capability |
| | `complete` | Returns `McpCompletionResult`; throws on missing capability; throws on disconnected; SDK + fallback |
| | Progress handlers | Listener registered/cleaned up; token correlation; notification surfaced via mocked `ui.notify` |
| `proxy-modes.ts` | `executeCall` | `structuredContent`/`outputSchema`/`progressToken` in `details`; progress listener cleanup on error; resource_link/resource content typed |
| `direct-tools.ts` | `createDirectToolExecutor` | Same capture as proxy; `DirectToolSpec.protocolVersion` used |
| `metadata-cache.ts` | (Optional) | `CACHE_VERSION` bump invalidates v1; `resourceTemplates` serialized/deserialized |

### 7.2 Integration Test Scenarios

| # | Scenario | Setup | Assertion |
| --- | ---------- | ------- | ----------- |
| 1 | **P0 Fix**: Sampling omitted for 2026-07-28 | Server config `protocolVersion: "2026-07-28"` with `samplingConfig` | `buildClientCapabilities("2026-07-28")` returns no `sampling` key |
| 2 | **P0 Fix**: Sampling included for legacy | Server config `protocolVersion: "legacy"` with `samplingConfig` | `buildClientCapabilities("legacy")` returns `sampling: {}` |
| 3 | **Structured Content**: Proxy surfaces fields | 2026-07-28 server returns `structuredContent` + `outputSchema` | `executeCall` result `details` has both fields |
| 4 | **Structured Content**: Direct surfaces fields | 2026-07-28 server returns `structuredContent` + `outputSchema` | Direct tool result `details` has both fields |
| 5 | **Structured Content**: No validation | Server returns `structuredContent` violating `outputSchema` | Adapter surfaces both without error |
| 6 | **Resource Templates**: `listResourceTemplates` returns typed array | Server advertises `resources.templates` | `manager.listResourceTemplates(name)` returns `McpResourceTemplate[]` |
| 7 | **Resource Templates**: Pagination handled | Server returns paginated templates | `fetchAllResourceTemplates` returns all pages combined |
| 8 | **Completions**: `complete` returns `McpCompletionResult` | Server with completions capability | `manager.complete(name, ref, arg)` returns typed result |
| 9 | **Completions**: Throws on missing capability | Server without completions | `manager.complete` throws `Error: Server "name" does not support completions` |
| 10 | **Progress Notifications**: Listener receives `McpProgressNotification` | Long-running tool emits progress | Handler receives notification with `progressToken`, `progress`, `total?`, `message?` |
| 11 | **Progress Notifications**: Surfaced via Pi notification | Progress notification received | `ui.notify` called with progress message |
| 12 | **Resource Links**: `resource_link` content typed | Tool returns `resource_link` block | `details.content` includes typed `McpContent` with `type: "resource_link"` |
| 13 | **Embedded Resources**: `resource` content typed | Tool returns `resource` block | `details.content` includes typed `McpContent` with `type: "resource"` |
| 14 | **TypeScript passes** | `npm run typecheck` | Exit code 0 |
| 15 | **No regression** | Existing test suite | All tests pass |

---

## 8. Implementation Sequence (from Proposal)

1. **Types** (`types.ts`) — Foundation: new interfaces, extended types
2. **P0 Fix** (`server-manager.ts:buildClientCapabilities`) — Bug fix first
3. **Server Manager** (`server-manager.ts`) — Resource Templates, Completions, Progress handlers, `resourceTemplates` storage
4. **Proxy Modes** (`proxy-modes.ts`) — Structured Content, Progress surfacing in `executeCall`
5. **Direct Tools** (`direct-tools.ts`) — Same capture/surface as proxy
6. **Metadata Cache** (`metadata-cache.ts`) — Optional: persist `resourceTemplates`
7. **Documentation** (`MCP_2026_PARITY_ANALYSIS.md`) — Update parity matrix
8. **Tests** — Add coverage for new features
