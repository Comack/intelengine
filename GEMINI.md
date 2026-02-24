# World Monitor Project Context

World Monitor is a tri-variant intelligence platform (Geopolitical, Tech, Finance) providing real-time global situational awareness. It is a monorepo-style TypeScript project built with a "contract-first" architecture using Protocol Buffers and custom code generation.

## Project Overview

- **Purpose**: Real-time news aggregation, geopolitical monitoring, infrastructure tracking, and market intelligence.
- **Variants**:
  - `full`: Geopolitical, military, and infrastructure focus.
  - `tech`: Startups, AI/ML, and cloud ecosystem focus.
  - `finance`: Global markets, central banks, and macro signals focus.
- **Key Technologies**:
  - **Frontend**: React (TypeScript), Vite, deck.gl (3D Globe), MapLibre GL, D3.js.
  - **Desktop**: Tauri (Rust) with a Node.js sidecar for local API execution.
  - **API**: Vercel Edge Functions, Protocol Buffers (`sebuf` for RPC-over-HTTP).
  - **AI/Intelligence**: Local LLM (Ollama), Groq/OpenRouter cloud fallback, Browser-side ML (Transformers.js).
  - **Data/State**: Convex (optional), Upstash Redis (caching), OS Keychain (desktop secrets).

## Architecture & Domain Mirroring

The project follows a strict domain-driven contract pattern. Features are organized by domains (e.g., `military`, `market`, `conflict`).

1. **Contract**: Defined in `proto/worldmonitor/{domain}/v1/*.proto`.
2. **Generation**: `make generate` creates clients/servers in `src/generated/`.
3. **Handler**: Implemented in `server/worldmonitor/{domain}/v1/`.
4. **Service**: Frontend consumption in `src/services/{domain}/`.

### Key Directories

- `src/`: Frontend application code.
  - `src/App.ts`: Central app orchestrator.
  - `src/components/`: UI components (PascalCase).
  - `src/services/`: Domain clients and analysis pipelines (kebab-case).
- `proto/`: Source of truth for API contracts.
- `server/`: Backend handler logic for all 17+ domains.
- `api/`: Vercel Edge Function entrypoints and legacy routes.
- `src-tauri/`: Desktop app shell (Rust) and sidecar logic.
- `docs/`: Extensive documentation on endpoints and release processes.

## Development Workflow

### Building and Running

- **Install Dependencies**: `npm install` and `make install` (requires Go for proto plugins).
- **Generate API Code**: `make generate` (Run this after any `.proto` change).
- **Full Local Dev**: `vercel dev` (Frontend + API Edge Functions).
- **Frontend Only**: `npm run dev` (or `dev:tech`, `dev:finance`).
- **Desktop Dev**: `npm run desktop:dev` (Tauri + local sidecar).
- **Production Build**: `npm run build:full` (or `build:tech`, `build:finance`).

### Testing

- **E2E Tests**: `npm run test:e2e:full` (Playwright).
- **Visual Tests**: `npm run test:e2e:visual` (Snapshot-based).
- **Data/Unit Tests**: `npm run test:data` (Node test runner).
- **Sidecar Tests**: `npm run test:sidecar`.

## Development Conventions

### Coding Style

- **Components**: Use `PascalCase` for files in `src/components/`.
- **Services/Handlers**: Use `kebab-case` for files in `src/services/` and `server/`.
- **TypeScript**: Strict mode enabled. Avoid `any`, prefer explicit boundaries.
- **State**: Prefer `localStorage` for UI persistence and URL parameters for shareable state.
- **Generated Code**: **DO NOT** edit files in `src/generated/` directly. Update the `.proto` and run `make generate`.

### Commit Guidelines

- Follow **Conventional Commits**:
  - `feat(domain): description`
  - `fix(domain): description`
  - `chore: description`
- Example: `feat(military): add aircraft enrichment via wingbits`

### PR Requirements

- PRs should include a summary of the problem, the solution, and any visual/UI changes (screenshots/clips).
- Run `npm run typecheck` and relevant tests before opening a PR.

## Runtime Environments

- **Web**: Deployed on Vercel. Uses `api/` edge functions.
- **Desktop**: Tauri app. Intercepts `/api/*` calls in `src/services/runtime.ts` to route them to a local sidecar or fall back to the cloud.
- **Local Dev**: Vite plugin `sebufApiPlugin` emulates the API routing.
