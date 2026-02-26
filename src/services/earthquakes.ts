import {
  SeismologyServiceClient,
  type Earthquake,
  type ListEarthquakesResponse,
  type TsunamiWarning,
  type ListTsunamiWarningsResponse,
} from '@/generated/client/worldmonitor/seismology/v1/service_client';
import { createCircuitBreaker } from '@/utils';

// Re-export the proto Earthquake type as the domain's public type
export type { Earthquake, TsunamiWarning };

const client = new SeismologyServiceClient('', { fetch: fetch.bind(globalThis) });
const earthquakeBreaker = createCircuitBreaker<ListEarthquakesResponse>({ name: 'Seismology' });
const tsunamiBreaker = createCircuitBreaker<ListTsunamiWarningsResponse>({ name: 'TsunamiWarnings' });

const emptyFallback: ListEarthquakesResponse = { earthquakes: [] };
const emptyTsunamiFallback: ListTsunamiWarningsResponse = { warnings: [] };

export async function fetchEarthquakes(): Promise<Earthquake[]> {
  const response = await earthquakeBreaker.execute(async () => {
    return client.listEarthquakes({ minMagnitude: 0 });
  }, emptyFallback);
  return response.earthquakes;
}

export async function fetchTsunamiWarnings(): Promise<TsunamiWarning[]> {
  const response = await tsunamiBreaker.execute(async () => {
    return client.listTsunamiWarnings({});
  }, emptyTsunamiFallback);
  return response.warnings;
}
