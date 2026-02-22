# Repository Guidelines

## Codebase Purpose
World Monitor is a tri-variant intelligence platform built from one TypeScript codebase:
- `full` variant for geopolitical and infrastructure monitoring.
- `tech` variant for technology ecosystem monitoring.
- `finance` variant for markets and macro intelligence.

The core design principle is domain mirroring across contracts, backend handlers, and frontend clients. Most features are organized by domain (`market`, `military`, `conflict`, `cyber`, and others), which keeps API evolution and feature work predictable.

## System Architecture at a Glance
The main runtime path is:
1. UI orchestration starts in `src/main.ts` and `src/App.ts`.
2. `src/components/*` render panels and map interactions.
3. `src/services/*` fetch and transform data for UI use.
4. Domain services call generated RPC clients in `src/generated/client/worldmonitor/*/v1/service_client.ts`.
5. Requests hit `/api/{domain}/v1/{rpc}`.
6. Edge gateway `api/[domain]/v1/[rpc].ts` routes to generated server route tables.
7. Domain handlers in `server/worldmonitor/*/v1/*.ts` call upstream providers and return contract-shaped responses.

In local Vite dev, `sebufApiPlugin()` in `vite.config.ts` emulates the same API routing flow for `/api/{domain}/v1/*`, so frontend integration behavior stays close to production.

## Repository Structure and Ownership Map
- `src/`: frontend application code.
- `src/App.ts`: central app orchestrator; manages refresh loops, panel state, map state, and variant behavior.
- `src/components/`: UI surface and panel components.
- `src/services/`: domain clients, analysis pipelines, caches, feature toggles, and runtime adapters.
- `src/config/`: datasets, panel defaults, variant-specific exports, and source metadata.
- `src/utils/`: shared helpers (sanitization, URL state, circuit breaker utility, DOM helpers).
- `src/workers/`: web worker entrypoints for heavier analysis and ML tasks.
- `src/generated/client/` and `src/generated/server/`: generated sebuf artifacts from proto contracts.
- `proto/worldmonitor/*/v1`: source-of-truth service contracts.
- `server/worldmonitor/*/v1`: domain handler implementations; one composition `handler.ts` per domain plus per-RPC files.
- `api/`: edge entrypoints and legacy/helper routes (`/api/youtube/*`, `/api/rss-proxy.js`, etc.).
- `src-tauri/`: desktop shell (Rust), command bridge, packaging configs, and sidecar integration.
- `src-tauri/sidecar/local-api-server.mjs`: local HTTP API process for desktop runtime.
- `tests/`: Node test-runner suites and browser harness HTML files.
- `e2e/`: Playwright tests and visual snapshots.
- `docs/`: deep implementation docs, API endpoint workflow, release packaging.
- `scripts/`: packaging/build helpers, sidecar tooling, relay scripts.
- `data/`: source datasets used in config generation and geospatial overlays.
- `convex/`: optional Convex-backed registration workflow artifacts.

## Domain-Driven Contract Pattern
The architecture intentionally mirrors each domain in four layers:
- Contract layer: `proto/worldmonitor/{domain}/v1/*.proto`.
- Generated server routes: `src/generated/server/worldmonitor/{domain}/v1/service_server.ts`.
- Handler implementation: `server/worldmonitor/{domain}/v1/handler.ts` plus per-RPC modules.
- Frontend consumption: `src/services/{domain}/index.ts` calling generated clients.

Active domains include `aviation`, `climate`, `conflict`, `cyber`, `displacement`, `economic`, `infrastructure`, `intelligence`, `maritime`, `market`, `military`, `news`, `prediction`, `research`, `seismology`, `unrest`, and `wildfire`.

When adding behavior, follow the existing domain naming and folder conventions before introducing new top-level patterns.

## Runtime Targets
The codebase supports three runtime modes:
- Web production on Vercel edge/runtime.
- Local development through Vite plus plugin-provided API emulation.
- Desktop app through Tauri plus local sidecar API.

Desktop path details:
- Runtime detection and URL rewriting are in `src/services/runtime.ts`.
- Secrets and feature toggles are managed in `src/services/runtime-config.ts`.
- Tauri bridge is in `src/services/tauri-bridge.ts`.
- Rust commands, keychain storage, sidecar lifecycle, and local token management are implemented in `src-tauri/src/main.rs`.
- Local API server logic is in `src-tauri/sidecar/local-api-server.mjs`.

The desktop fetch patch can route `/api/*` first to local sidecar and selectively fall back to cloud based on secret validity and endpoint class.

## Data, Security, and Reliability Patterns
- CORS and origin checks are centralized in `server/cors.ts`.
- Error normalization is centralized in `server/error-mapper.ts`.
- Static route matching for generated RPC routes is in `server/router.ts`.
- API bot-block middleware is in `middleware.ts`.
- Redis cache helpers and key prefixing are in `server/_shared/redis.ts`.
- Stable hash keys for caches are in `server/_shared/hash.ts`.
- Circuit breaker behavior is used broadly in services to degrade gracefully on upstream failures.
- Most handlers prefer safe fallback responses over hard failures to keep the dashboard operational with partial data.

## Build, Test, and Development Commands
- `npm install`: install Node dependencies.
- `vercel dev`: run frontend and edge functions locally (closest to production behavior).
- `npm run dev`, `npm run dev:tech`, `npm run dev:finance`: frontend-focused variant dev servers.
- `npm run build` or `npm run build:full|tech|finance`: production builds.
- `npm run typecheck`: strict TS checking.
- `npm run test:data`: Node tests in `tests/*.test.mjs`.
- `npm run test:sidecar`: sidecar and API helper tests.
- `npm run test:e2e:runtime`: critical runtime Playwright checks.
- `npm run test:e2e:full|tech|finance`: variant E2E suites.
- `npm run test:e2e:visual` and `npm run test:e2e:visual:update`: visual baseline validation/update.
- `make install`: install proto toolchain dependencies.
- `make lint`: lint proto contracts.
- `make generate`: regenerate `src/generated/**` and `docs/api/**` from `proto/**`.

## Coding Conventions and Change Boundaries
- Language baseline is strict TypeScript with ESM modules.
- Keep explicit types at public boundaries and avoid `any`.
- Prefer existing naming patterns:
- `PascalCase` component files in `src/components/`.
- `kebab-case` service/helper files in `src/services/` and `server/worldmonitor/**`.
- Preserve thin domain composition handlers (`handler.ts`) that delegate to per-RPC files.
- Keep security utilities (`escapeHtml`, URL sanitization, API key checks) in flow when touching user- or external-data paths.
- Avoid hand-editing generated files unless debugging generation output; source changes belong in proto or handler/service code.

## Testing Strategy
- Unit and contract-shape tests use Node’s test runner in `tests/*.test.mjs`.
- Integration and UX flows use Playwright in `e2e/*.spec.ts`.
- Harness pages in `tests/*.html` and `src/e2e/*.ts` support deterministic map/runtime verification.
- Visual regressions are snapshot-based; update snapshots only for intentional rendering changes.
- For API/domain changes, verify both handler-side behavior and frontend service adaptation.

## Commit and PR Expectations
- Use focused commits with Conventional Commit style seen in history:
- `fix(scope): ...`
- `feat(scope): ...`
- `chore: ...`
- `perf(scope): ...`
- Reference issue/PR IDs where relevant, for example `(#220)`.
- PRs should include:
- concise problem and solution summary.
- rationale and risk notes.
- screenshots or clips for UI behavior changes.
- migration or config notes when changing contracts/secrets/runtime behavior.
- Before opening a PR, run build and the relevant test subset for touched areas.

## API Contract Workflow (Required for New JSON APIs)
1. Define or update proto messages and RPCs under `proto/worldmonitor/{domain}/v1/`.
2. Run `make generate`.
3. Implement or update RPC logic in `server/worldmonitor/{domain}/v1/`.
4. Ensure routes are exposed through generated server route creators (used by both Vite plugin and edge gateway).
5. Consume via generated client in `src/services/{domain}/`.
6. Add or update tests in `tests/` and `e2e/` as appropriate.
7. Commit source plus generated artifacts in `src/generated/**` and `docs/api/**`.

Do not create new standalone JSON endpoints when the feature fits an existing or new sebuf domain service. Prefer contract-first changes so web and desktop runtimes stay aligned.
