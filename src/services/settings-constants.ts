import type { RuntimeSecretKey, RuntimeFeatureId } from './runtime-config';

export const SIGNUP_URLS: Partial<Record<RuntimeSecretKey, string>> = {
  GROQ_API_KEY: 'https://console.groq.com/keys',
  OPENROUTER_API_KEY: 'https://openrouter.ai/settings/keys',
  FRED_API_KEY: 'https://fred.stlouisfed.org/docs/api/api_key.html',
  EIA_API_KEY: 'https://www.eia.gov/opendata/register.php',
  CLOUDFLARE_API_TOKEN: 'https://dash.cloudflare.com/profile/api-tokens',
  ACLED_ACCESS_TOKEN: 'https://developer.acleddata.com/',
  URLHAUS_AUTH_KEY: 'https://auth.abuse.ch/',
  OTX_API_KEY: 'https://otx.alienvault.com/',
  ABUSEIPDB_API_KEY: 'https://www.abuseipdb.com/login',
  WINGBITS_API_KEY: 'https://wingbits.com/register',
  AISSTREAM_API_KEY: 'https://aisstream.io/authenticate',
  OPENSKY_CLIENT_ID: 'https://opensky-network.org/login?view=registration',
  OPENSKY_CLIENT_SECRET: 'https://opensky-network.org/login?view=registration',
  FINNHUB_API_KEY: 'https://finnhub.io/register',
  NASA_FIRMS_API_KEY: 'https://firms.modaps.eosdis.nasa.gov/api/area/',
  UCDP_ACCESS_TOKEN: 'https://ucdp.uu.se/apidocs/',
  OLLAMA_API_URL: 'https://ollama.com/download',
  OLLAMA_MODEL: 'https://ollama.com/library',
  WTO_API_KEY: 'https://apiportal.wto.org/',
  AVIATIONSTACK_API: 'https://aviationstack.com/signup/free',
  ICAO_API_KEY: 'https://dataservices.icao.int/',
  PORTCAST_API_KEY: 'https://portcast.io/',
  GLOBAL_FISHING_WATCH_API_KEY: 'https://globalfishingwatch.org/our-apis/',
  ELECTRICITY_MAPS_API_KEY: 'https://api-portal.electricitymaps.com/',
  SENTINEL_HUB_CLIENT_ID: 'https://apps.sentinel-hub.com/dashboard/#/account/settings',
  SENTINEL_HUB_CLIENT_SECRET: 'https://apps.sentinel-hub.com/dashboard/#/account/settings',
  WAQI_API_TOKEN: 'https://aqicn.org/data-platform/token/',
  GLOBAL_FOREST_WATCH_API_KEY: 'https://www.globalforestwatch.org/',
  LIVEUAMAP_API_KEY: 'https://liveuamap.com/en/developers',
  WHALE_ALERT_API_KEY: 'https://whale-alert.io/pricing',
  AIRFRAMES_API_KEY: 'https://airframes.io/about',
  GITHUB_TOKEN: 'https://github.com/settings/tokens',
};

export const PLAINTEXT_KEYS = new Set<RuntimeSecretKey>([
  'OLLAMA_API_URL',
  'OLLAMA_MODEL',
  'WS_RELAY_URL',
  'VITE_OPENSKY_RELAY_URL',
  'SENTINEL_HUB_CLIENT_ID',
  'GITHUB_TOKEN',
]);

export const MASKED_SENTINEL = '__WM_MASKED__';

export const HUMAN_LABELS: Record<RuntimeSecretKey, string> = {
  GROQ_API_KEY: 'Groq API Key',
  OPENROUTER_API_KEY: 'OpenRouter API Key',
  FRED_API_KEY: 'FRED API Key',
  EIA_API_KEY: 'EIA API Key',
  CLOUDFLARE_API_TOKEN: 'Cloudflare API Token',
  ACLED_ACCESS_TOKEN: 'ACLED Access Token',
  URLHAUS_AUTH_KEY: 'URLhaus Auth Key',
  OTX_API_KEY: 'AlienVault OTX Key',
  ABUSEIPDB_API_KEY: 'AbuseIPDB API Key',
  WINGBITS_API_KEY: 'Wingbits API Key',
  WS_RELAY_URL: 'WebSocket Relay URL',
  VITE_OPENSKY_RELAY_URL: 'OpenSky Relay URL',
  OPENSKY_CLIENT_ID: 'OpenSky Client ID',
  OPENSKY_CLIENT_SECRET: 'OpenSky Client Secret',
  AISSTREAM_API_KEY: 'AISStream API Key',
  FINNHUB_API_KEY: 'Finnhub API Key',
  NASA_FIRMS_API_KEY: 'NASA FIRMS API Key',
  UCDP_ACCESS_TOKEN: 'UCDP Access Token',
  OLLAMA_API_URL: 'Ollama Server URL',
  OLLAMA_MODEL: 'Ollama Model',
  WORLDMONITOR_API_KEY: 'World Monitor License Key',
  WTO_API_KEY: 'WTO API Key',
  AVIATIONSTACK_API: 'AviationStack API Key',
  ICAO_API_KEY: 'ICAO NOTAM API Key',
  PORTCAST_API_KEY: 'Portcast API Key',
  GLOBAL_FISHING_WATCH_API_KEY: 'Global Fishing Watch API Key',
  ELECTRICITY_MAPS_API_KEY: 'Electricity Maps API Key',
  SENTINEL_HUB_CLIENT_ID: 'Sentinel Hub Client ID',
  SENTINEL_HUB_CLIENT_SECRET: 'Sentinel Hub Client Secret',
  WAQI_API_TOKEN: 'WAQI API Token',
  GLOBAL_FOREST_WATCH_API_KEY: 'Global Forest Watch API Key',
  LIVEUAMAP_API_KEY: 'Liveuamap API Key',
  WHALE_ALERT_API_KEY: 'Whale Alert API Key',
  AIRFRAMES_API_KEY: 'Airframes API Key',
  GITHUB_TOKEN: 'GitHub Personal Access Token',
};

export interface SettingsCategory {
  id: string;
  label: string;
  features: RuntimeFeatureId[];
}

export const SETTINGS_CATEGORIES: SettingsCategory[] = [
  {
    id: 'ai',
    label: 'AI & Summarization',
    features: ['aiOllama', 'aiGroq', 'aiOpenRouter'],
  },
  {
    id: 'economy',
    label: 'Economic & Energy',
    features: ['economicFred', 'energyEia', 'supplyChain', 'electricityMaps'],
  },
  {
    id: 'markets',
    label: 'Markets & Trade',
    features: ['finnhubMarkets', 'wtoTrade', 'whaleAlertMarkets'],
  },
  {
    id: 'security',
    label: 'Security & Threats',
    features: ['internetOutages', 'acledConflicts', 'ucdpConflicts', 'liveuamapConflicts', 'abuseChThreatIntel', 'alienvaultOtxThreatIntel', 'abuseIpdbThreatIntel'],
  },
  {
    id: 'tracking',
    label: 'Tracking & Sensing',
    features: ['aisRelay', 'openskyRelay', 'wingbitsEnrichment', 'nasaFirms', 'aviationStack', 'icaoNotams', 'portcastMaritime', 'globalFishingWatch', 'airframesMilitary', 'newsPerFeedFallback'],
  },
  {
    id: 'climate',
    label: 'Climate & Environment',
    features: ['sentinelHubClimate', 'waqiAirQuality', 'globalForestWatch'],
  },
  {
    id: 'research',
    label: 'Research & Intelligence',
    features: ['githubResearch'],
  },
];
