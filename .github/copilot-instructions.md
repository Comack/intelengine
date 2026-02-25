# Copilot Instructions

**CRITICAL: You MUST read `README.md` in the project root and `docs/DOCUMENTATION.md` before performing any task. This ensures you have a full grasp of the application's purpose, goals, and technical architecture.**

## What This Is

World Monitor is a tri-variant real-time intelligence dashboard (geopolitical `full`, tech ecosystem `tech`, financial `finance`) built from a single TypeScript codebase. All three variants share the same source; `VITE_VARIANT` controls which panels/features are active.

## Commands

```bash
# Development
npm run dev                    # full variant (default)
npm run dev:tech               # tech variant
npm run dev:finance            # finance variant
vercel dev                     # closest to production (runs edge functions too)

# Build
npm run build                  # default build
npm run build:full|tech|finance

# Type checking
npm run typecheck              # tsc --noEmit

# Tests — Node runner
npm run test:data              # tests/*.test.mjs (data integrity)
npm run test:sidecar           # sidecar + legacy API helper tests

# Run a single Node test file
node --test tests/server-handlers.test.mjs

# Tests — Playwright
npm run test:e2e:runtime       # critical fetch/routing checks (run this first)
npm run test:e2e:full          # full variant E2E
npx playwright test e2e/runtime-fetch.spec.ts  # single spec

# Proto
make install    # one-time: buf + sebuf plugins + npm deps
make lint       # lint protos
make generate   # regenerate src/generated/** and docs/api/** from proto/**
make check      # lint + generate in one step
```

## Architecture

### Request Flow

```
UI (src/components/) 
  → domain service (src/services/{domain}/)
    → generated RPC client (src/generated/client/worldmonitor/{domain}/v1/service_client.ts)
      → POST /api/{domain}/v1/{rpc-path}
        → edge gateway (api/[[...path]].ts) or Vite plugin (vite.config.ts sebufApiPlugin())
          → generated server routes (src/generated/server/worldmonitor/{domain}/v1/service_server.ts)
            → handler (server/worldmonitor/{domain}/v1/handler.ts → per-RPC file)
```

The Vite dev server (`sebufApiPlugin()` in `vite.config.ts`) and the Vercel edge gateway (`api/[[...path]].ts`) both use the same generated route tables, so local dev and production behave identically.

### Domain-Mirrored Contract Pattern

Every feature lives across exactly four layers:

| Layer | Path |
|---|---|
| Proto contract | `proto/worldmonitor/{domain}/v1/` |
| Generated server routes | `src/generated/server/worldmonitor/{domain}/v1/service_server.ts` |
| Handler implementation | `server/worldmonitor/{domain}/v1/handler.ts` + per-RPC files |
| Frontend service | `src/services/{domain}/index.ts` |

Active domains: `aviation`, `climate`, `conflict`, `cyber`, `displacement`, `economic`, `infrastructure`, `intelligence`, `maritime`, `market`, `military`, `news`, `prediction`, `research`, `seismology`, `unrest`, `wildfire`.

### Three Runtime Targets

- **Web**: Vercel edge/runtime. Default.
- **Local dev**: Vite + `sebufApiPlugin()`.
- **Desktop**: Tauri shell + local sidecar (`src-tauri/sidecar/local-api-server.mjs`). Desktop fetch is patched to route `/api/*` to the sidecar first, falling back to cloud. See `src/services/runtime.ts` and `src/services/tauri-bridge.ts`.

## Key Conventions

### Adding a New API Endpoint

**Never create standalone `api/*.js` files.** All JSON endpoints must use sebuf. The full workflow is in `docs/ADDING_ENDPOINTS.md`. Short version:

1. Define proto in `proto/worldmonitor/{domain}/v1/`
2. Run `make check` (lint + generate)
3. Implement handler in `server/worldmonitor/{domain}/v1/`
4. For a **new service**: also register routes in `api/[[...path]].ts` and `vite.config.ts`
5. Consume via generated client in `src/services/{domain}/`
6. Commit generated artifacts in `src/generated/**` and `docs/api/**`

After editing any `.proto`, always run `make generate` before building — CI does not run generation automatically.

### Handler Structure

`handler.ts` is a thin re-export only. Business logic lives in per-RPC files:

```typescript
// server/worldmonitor/seismology/v1/handler.ts
export const seismologyHandler: SeismologyServiceHandler = {
  listEarthquakes,
  getEarthquakeDetails,
};

// server/worldmonitor/seismology/v1/list-earthquakes.ts
export const listEarthquakes: SeismologyServiceHandler['listEarthquakes'] = async (
  _ctx: ServerContext,
  req: ListEarthquakesRequest,
): Promise<ListEarthquakesResponse> => { ... };
```

Always type handler functions using indexed access against the generated interface (`Handler['methodName']`).

### Frontend Service Pattern

```typescript
const client = new MyServiceClient('', { fetch: fetch.bind(globalThis) });
// Empty string base URL = same-origin. fetch.bind(globalThis) is required for Tauri.

const breaker = createCircuitBreaker<MyResponse>({ name: 'MyService' });
// Always wrap client calls in a circuit breaker with a safe fallback response.
```

### Proto Conventions

- **Time fields**: always `int64` with Unix epoch milliseconds + `(sebuf.http.int64_encoding) = INT64_ENCODING_NUMBER`. Never use `google.protobuf.Timestamp`.
- **File naming**: one message per file (`earthquake.proto`), one RPC pair per file (`list_earthquakes.proto`), service in `service.proto`.
- **Comments**: buf lint requires `//` comments on every message, field, service, RPC, and enum value — without them `make lint` fails.
- **Shared core types**: use `GeoCoordinates`, `BoundingBox`, `TimeRange`, `PaginationRequest/Response` from `worldmonitor/core/v1/` instead of redefining them.
- **Route paths**: service base `(sebuf.http.service_config) = {base_path: "/api/{domain}/v1"}`, RPC path `/{verb}-{noun}` in kebab-case.

### Generated Files

Do not hand-edit files in `src/generated/`. Source of truth is in `proto/`. Run `make generate` to sync.

### Reliability

Handlers prefer safe fallback responses over hard failures. Use `createCircuitBreaker` from `src/utils/circuit-breaker.ts` in all frontend domain services.

### Security Utilities

Keep `escapeHtml`, URL sanitization, and API key validation in place when touching any path that handles user or external data. CORS logic lives in `server/cors.ts`; do not inline CORS headers in handlers.

### Naming

- `PascalCase` for component files in `src/components/`
- `kebab-case` for service files in `src/services/` and server handler files in `server/worldmonitor/`

### RSS Proxy

When adding new RSS feeds, add the domain to `ALLOWED_DOMAINS` in `api/rss-proxy.js`.

### Commits and PRs

Conventional Commit style: `fix(scope): ...`, `feat(scope): ...`, `chore: ...`, `perf(scope): ...`. Reference issue/PR IDs where relevant (e.g., `(#220)`). Before opening a PR: run `npm run typecheck` and the relevant test subset.
