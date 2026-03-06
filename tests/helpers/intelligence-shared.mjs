export const UPSTREAM_TIMEOUT_MS = 30_000;
export const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
export const GROQ_MODEL = 'llama-3.1-8b-instant';

export const TIER1_COUNTRIES = {
  US: 'United States', RU: 'Russia', CN: 'China', UA: 'Ukraine', IR: 'Iran',
  IL: 'Israel', TW: 'Taiwan', KP: 'North Korea', SA: 'Saudi Arabia', TR: 'Turkey',
  PL: 'Poland', DE: 'Germany', FR: 'France', GB: 'United Kingdom', IN: 'India',
  PK: 'Pakistan', SY: 'Syria', YE: 'Yemen', MM: 'Myanmar', VE: 'Venezuela',
};

export function hashString(input) {
  let h = 0xcbf29ce484222325n;
  const FNV_PRIME = 0x100000001b3n;
  const MASK_52 = (1n << 52n) - 1n;

  for (let i = 0; i < input.length; i += 1) {
    h ^= BigInt(input.charCodeAt(i));
    h = (h * FNV_PRIME) & MASK_52;
  }

  return Number(h).toString(36);
}
