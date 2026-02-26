import {
  SpaceServiceClient,
  type GetSpaceWeatherResponse,
  type ListSatellitesResponse,
  type SatelliteCategory,
} from '@/generated/client/worldmonitor/space/v1/service_client';

const client = new SpaceServiceClient('', { fetch: fetch.bind(globalThis) });

export async function getSpaceWeather(): Promise<GetSpaceWeatherResponse> {
  try {
    return await client.getSpaceWeather({});
  } catch {
    return { status: undefined };
  }
}

export async function listSatellites(
  category: SatelliteCategory = 'SATELLITE_CATEGORY_UNSPECIFIED',
  limit = 500,
): Promise<ListSatellitesResponse> {
  try {
    return await client.listSatellites({ category, limit });
  } catch {
    return { satellites: [], propagatedAt: String(Date.now()) };
  }
}
