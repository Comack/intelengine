# Local backend parity matrix (desktop sidecar)

This matrix tracks desktop parity by mapping `src/services/*.ts` consumers to sebuf domain handlers and classifying each feature as:

- **Fully local**: works from desktop sidecar without user credentials.
- **Requires user-provided API key**: local endpoint exists, but capability depends on configured secrets.
- **Requires cloud fallback**: sidecar exists, but operational behavior depends on a cloud relay path.

## Architecture

All JSON API endpoints now use sebuf-generated handlers served through a single catch-all gateway (`api/[[...path]].js`). Handler implementations live in `server/worldmonitor/{domain}/v1/`. The desktop sidecar runs the same handler code locally via an esbuild-compiled bundle.

Remaining non-sebuf `api/*.js` files serve non-JSON content (RSS XML, HTML, redirects) and are not part of this matrix.

## Priority closure order

1. **Priority 1 (core panels + map):** LiveNewsPanel, MonitorPanel, StrategicRiskPanel, critical map layers.
2. **Priority 2 (intelligence continuity):** summaries and market panel.
3. **Priority 3 (enhancements):** enrichment and relay-dependent tracking extras.

## Feature parity matrix

| Priority | Feature / Panel | Service source(s) | Sebuf domain | Handler path | Classification | Closure status |
|---|---|---|---|---|---|---|
| P1 | LiveNewsPanel | `src/services/live-news.ts` | _Non-sebuf (YouTube)_ | `api/youtube/live.js` | Fully local | ✅ Local endpoint available; channel-level video fallback already implemented. |
| P1 | MonitorPanel | _None (panel-local keyword matching)_ | _None_ | _None_ | Fully local | ✅ Client-side only (no backend dependency). |
| P1 | StrategicRiskPanel cached overlays | `src/services/cached-risk-scores.ts` | intelligence | `server/worldmonitor/intelligence/v1/` | Requires user-provided API key | ✅ Explicit fallback: panel continues with local aggregate scoring when cache feed is unavailable. |
| P1 | Map layers (conflicts, outages, AIS, military flights) | `src/services/conflict/`, `src/services/infrastructure/`, `src/services/maritime/`, `src/services/military/` | conflict, infrastructure, maritime, military | `server/worldmonitor/{domain}/v1/` | Requires user-provided API key | ✅ Explicit fallback: unavailable feeds are disabled while map rendering remains active for local/static layers. |
| P2 | Summaries | `src/services/news/` | news | `server/worldmonitor/news/v1/` | Requires user-provided API key | ✅ Explicit fallback chain: Groq → OpenRouter → browser model. |
| P2 | MarketPanel | `src/services/market/`, `src/services/prediction/` | market, prediction | `server/worldmonitor/market/v1/`, `server/worldmonitor/prediction/v1/` | Fully local | ✅ Multi-provider and cache-aware fetch behavior maintained in sidecar mode. |
| P2 | Forensics Engine | `src/services/forensics.ts` | intelligence | `server/worldmonitor/intelligence/v1/` | Fully local | ✅ Heavy compute orchestration executed locally; Redis-aware storage fallback. |
| P3 | Evidence Service | `src/services/evidence.ts` | evidence | `server/worldmonitor/evidence/v1/` | Fully local | ✅ Local ingestion and POLE graph extraction active in sidecar. |
| P3 | Flight enrichment | `src/services/military/` | military | `server/worldmonitor/military/v1/` | Requires user-provided API key | ✅ Explicit fallback: heuristic-only classification mode. |
| P3 | OpenSky relay fallback path | `src/services/military/` | military | `server/worldmonitor/military/v1/` | Requires cloud fallback | ✅ Relay fallback documented; no hard failure when relay is unavailable. |
| P3 | Aviation delays | `src/services/aviation/` | aviation | `server/worldmonitor/aviation/v1/` | Fully local | ✅ FAA ATIS data; no API key required. Falls back to empty state on FAA API failure. |
| P3 | Climate & environment | `src/services/climate/` | climate | `server/worldmonitor/climate/v1/` | Fully local | ✅ Open-Meteo, WAQI, Sentinel-5P (free tier), GFW — all operate without stored credentials in sidecar. |
| P3 | Cyber threat feeds | `src/services/cyber/` | cyber | `server/worldmonitor/cyber/v1/` | Requires user-provided API key | ✅ URLhaus, OTX, AbuseIPDB keys optional; CISA KEV and Wikimedia info-ops run key-free. Layer hidden when keys absent. |
| P3 | Displacement / population exposure | `src/services/displacement/` | displacement | `server/worldmonitor/displacement/v1/` | Fully local | ✅ UNHCR open API; no credentials required. Returns empty state gracefully. |
| P3 | Economic indicators | `src/services/economic/` | economic | `server/worldmonitor/economic/v1/` | Requires user-provided API key | ✅ FRED_API_KEY and EIA_API_KEY optional; World Bank and macro signals operate key-free. |
| P3 | Research & social trends | `src/services/research/` | research | `server/worldmonitor/research/v1/` | Fully local | ✅ arXiv, HackerNews, GitHub Events, Bluesky AT Protocol — all free/open APIs. |
| P3 | Seismology & tsunami | `src/services/earthquakes.ts` | seismology | `server/worldmonitor/seismology/v1/` | Fully local | ✅ USGS (earthquakes) and NWS Tsunami Alerts — no credentials required. |
| P3 | Space weather & satellites | `src/services/space.ts` | space | `server/worldmonitor/space/v1/` | Fully local | ✅ CelesTrak TLE (satellites) and NOAA SWPC (Kp-index) — fully open APIs. |
| P3 | Wildfire detection | `src/services/wildfires/` | wildfire | `server/worldmonitor/wildfire/v1/` | Requires user-provided API key | ✅ NASA_FIRMS_API_KEY optional; layer hidden when absent. EONET/GDACS wildfire data continues without it. |

## Non-parity closure actions completed

- Added **desktop readiness + non-parity fallback visibility** in `ServiceStatusPanel` so operators can see acceptance status and per-feature fallback behavior in desktop runtime.
- Kept local-sidecar strategy as the default path: desktop sidecar executes sebuf handlers locally via the esbuild-compiled bundle and only uses cloud fallback when handler execution or relay path fails.

## Desktop-ready acceptance criteria

A desktop build is considered **ready** when all checks below are green:

1. **Startup:** app launches and local sidecar health reports enabled.
2. **Map rendering:** map loads with local/static layers even when optional feeds are unavailable.
3. **Core intelligence panels:** LiveNewsPanel, MonitorPanel, StrategicRiskPanel render without fatal errors.
4. **Summaries:** at least one summary path works (provider-backed or browser fallback).
5. **Market panel:** panel renders and returns data from at least one market provider.
6. **Live tracking:** at least one live mode (AIS or OpenSky) is available.

These checks are now surfaced in the Service Status UI as "Desktop readiness".
