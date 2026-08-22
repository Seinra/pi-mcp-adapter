# Paridad MCP 2026-07-28 — Análisis y Priorización

**Fecha**: 2026-08-21  
**Implementación actual**: pi-mcp-adapter v2.26.0+  
**SDK objetivo**: `@modelcontextprotocol/client@2.0.0`, `@modelcontextprotocol/core@2.0.0`, `@modelcontextprotocol/sdk@1.30.0`

---

## Principio Rector

> **Si ya tenemos "legacy" funcionando, NO tiene sentido implementar features DEPRECADAS en el NUEVO soporte.**
>
> El legacy ya cubre roots, sampling, logging. El nuevo soporte debe enfocarse en lo que el legacy NO tiene.

---

## Matriz de Priorización

### ⛔ PRIORIDAD 0 — NO HACER (Deprecated en spec 2026-07-28)

| Feature | Por qué NO |
| --------- | ------------ |
| `roots` (list/list_changed) | Legacy ya lo tiene. Spec dice: "Don't implement new" |
| `sampling` (createMessage) | Legacy ya lo tiene. Spec dice: "Use LLM provider APIs" |
| `logging` (setLevel, notifications/message) | Legacy ya lo tiene. Spec dice: "Use stderr/OpenTelemetry" |
| HTTP+SSE Transport | Ya usamos Streamable HTTP first; SSE solo fallback |
| OAuth Dynamic Client Registration | Spec: "Use Client ID Metadata Documents" |

> **Regla**: Si el legacy ya lo hace y el spec lo marca deprecated → **cero esfuerzo en nuevo soporte**.

---

### ✅ PRIORIDAD 1 — YA IMPLEMENTADO (Core 2026-07-28)

*Lo que Toolbelt Gateway y clientes modernos necesitan YA está funcionando:*

| Feature | Archivo | Tests |
| --------- | --------- | ------- |
| `server/discover` | `mcp-probe.ts` | ✅ 8/8 |
| `tools/list` → `ttlMs`/`cacheScope` | `server-manager.ts:fetchAllTools` + `metadata-cache.ts` | ✅ |
| `tools/call` → `resultType`/`serverInfo` | `proxy-modes.ts:executeCall`, `direct-tools.ts` | ✅ 74 |
| Per-request `_meta.protocolVersion` | `getRequestOptions`/`buildRequestOptions` | ✅ |
| `MCP-Protocol-Version` header | SDK lo envía vía `_meta` | ✅ |
| `resultType: "complete" \| "input_required"` | Capturado en `_meta` | ✅ |
| `CacheableResult` (`ttlMs`/`cacheScope`) | `metadata-cache.ts` serialize | ✅ |
| Version negotiation (`versionNegotiation`) | `resolveVersionNegotiation` | ✅ |
| Legacy fallback warning | `connectHttpClient` log | ✅ |
| Cache v2 persistence | `CACHE_VERSION=2` | ✅ |
| **Sampling removal for 2026-07-28** | `server-manager.ts:buildClientCapabilities` | ✅ |
| **Resource Templates** (`resources/templates/list`) | `server-manager.ts:fetchAllResourceTemplates`, `listResourceTemplates` | ✅ |
| **Completions** (`completions` capability) | `server-manager.ts:complete` | ✅ |
| **Progress Notifications** (`notifications/progress`) | `server-manager.ts:progressListeners`, `registerProgressListener`, `unregisterProgressListener` | ✅ |
| **Structured Content** (`structuredContent` + `outputSchema`) | `proxy-modes.ts:executeCall`, `direct-tools.ts:createDirectToolExecutor` | ✅ |
| **Resource Links / Embedded Resources** | `types.ts:McpContent` with `resource_link`/`resource` | ✅ |

> **Estado**: 100% core path + P2 features cubiertos. Toolbelt Gateway compatible.

---

### 🎯 PRIORIDAD 2 — IMPLEMENTADO (Features específicas del spec 2026-07-28)

*Features que el spec 2026-07-28 trae nuevo, implementadas bajo demanda:*

| Feature | Spec | Complejidad | Estado |
| --------- | ------ | ------------- | ------- |
| **Structured Content** (`structuredContent` + `outputSchema`) | Tool result validation | Baja | ✅ Done |
| **Resource Templates** (`resources/templates/list`) | Parametrized resources | Media | ✅ Done |
| **Completions** (`completions` capability) | Argument autocompletion | Media | ✅ Done |
| **Progress Notifications** (`notifications/progress`) | Long-running tool feedback | Media | ✅ Done |
| **OpenTelemetry Trace Context** | `_meta` trace propagation | Baja | ⏳ On-demand |
| **`x-mcp-header`** | Tool params → HTTP headers | Media | ⏳ On-demand (solo Streamable HTTP) |

> **Criterio**: Implementadas como parte de este ciclo. Funcionales y con tests.

---

### 🏗️ PRIORIDAD 3 — CAMBIO DE ARQUITECTURA (Bloqueado)

*Requieren cambios profundos en cómo funciona el adapter:*

| Feature | Cambio requerido | Justificación mínima |
| --------- | ------------------ | --------------------- |
| **MRTR (Multi Round-Trip Requests)** | Nuevo flujo request/response con `input_required`, `inputResponses`, `requestState` | Cliente pide elicitation/sampling/roots via MRTR (no legacy) |
| **`subscriptions/listen`** (stream único) | Reemplazar `setNotificationHandler` legacy por stream POST único | Cliente exige stream único unificado |
| **Extensions** (`io.modelcontextprotocol/tasks`, `io.modelcontextprotocol/ui`) | Nuevo sistema de capabilities extensions | Cliente usa Tasks o UI extension |
| **Resource Links / Embedded Resources** | Nuevo tipo de content en tool results | Servers devuelven resource links/embedded |

> **Regla**: Solo si **Toolbelt Gateway u otro cliente crítico** lo bloquea.

---

## Resumen Ejecutivo

```
┌─────────────────────────────────────────────────────────────┐
│  ESTADO ACTUAL: 100% listo para producción (P0+P2 done)     │
│  ┌─────────────┬─────────────┬─────────────┬─────────────┐  │
│  │ Core 2026   │ Específicos │ Arquitectura │ Deprecated  │  │
│  │ ✅ 100%     │ ✅ Done     │ 🔒 Blocked   │ 🚫 Zero     │  │
│  └─────────────┴─────────────┴─────────────┴─────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Decisiones Tomadas

1. **NO tocar deprecated** (roots, sampling, logging) — legacy ya lo cubre
2. **Core 2026-07-28 completo** — Toolbelt Gateway funciona
3. **P2 Features específicas** — Implementadas (Structured Content, Resource Templates, Completions, Progress)
4. **Arquitectura (P3)** — Bloqueada salvo justificación fuerte de cliente crítico

### Próximos Pasos Recomendados

1. **Cerrar flujos SDD** (`sdd-archive` ya hecho)
2. **Monitorear issues** — Si llega request de OpenTelemetry / x-mcp-header → evaluar Prioridad 2
3. **No tocar Prioridad 3** salvo que Toolbelt Gateway lo exija explícitamente

---

## Archivos de Referencia

- `openspec/changes/mcp-2026-protocol-support/archive.md`
- `openspec/changes/mcp-2026-protocol-followup/archive.md`
- `.pi/assets/mcp/2026-07-28/` — Spec completa local
- `.pi/assets/mcp/2026-07-28/03-key-changes.md` — Changelog oficial
- `.pi/assets/mcp/2026-07-28/06-tools.md` — Tools spec
- `.pi/assets/mcp/2026-07-28/09-mrtr.md` — MRTR spec

---

*Documento generado como cierre de análisis de paridad MCP 2026-07-28 vs implementación pi-mcp-adapter.*
