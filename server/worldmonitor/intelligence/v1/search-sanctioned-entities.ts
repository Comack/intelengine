import type {
  ServerContext,
  SearchSanctionedEntitiesRequest,
  SearchSanctionedEntitiesResponse,
  SanctionedEntity,
} from '../../../../src/generated/server/worldmonitor/intelligence/v1/service_server';

const OPENSANCTIONS_API_URL = 'https://api.opensanctions.org/search/';

export async function searchSanctionedEntities(
  _ctx: ServerContext,
  req: SearchSanctionedEntitiesRequest,
): Promise<SearchSanctionedEntitiesResponse> {
  const query = req.query || '';
  const limit = req.limit && req.limit > 0 ? req.limit : 10;

  if (!query) {
    return { entities: [] };
  }

  try {
    const url = new URL(OPENSANCTIONS_API_URL + encodeURIComponent(query));
    url.searchParams.append('limit', limit.toString());

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`Failed to fetch from OpenSanctions: ${response.statusText}`);
    }

    const data = await response.json();
    const results = (data.results || []).map((item: any): SanctionedEntity => ({
      id: item.id,
      schema: item.schema,
      name: item.caption || item.properties?.name?.[0] || 'Unknown',
      aliases: item.properties?.alias || [],
      countries: item.properties?.country || item.properties?.jurisdiction || [],
      datasets: item.datasets || [],
      firstSeen: item.first_seen || '',
      lastSeen: item.last_seen || '',
    }));

    return { entities: results };
  } catch (error) {
    console.error('Error searching OpenSanctions:', error);
    return { entities: [] };
  }
}
