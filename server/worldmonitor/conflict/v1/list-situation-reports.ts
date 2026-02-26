import type {
  ServerContext,
  ListSituationReportsRequest,
  ListSituationReportsResponse,
  SituationReport,
} from '../../../../src/generated/server/worldmonitor/conflict/v1/service_server';

const RELIEFWEB_API_URL = 'https://api.reliefweb.int/v2/reports';

export async function listSituationReports(
  _ctx: ServerContext,
  req: ListSituationReportsRequest,
): Promise<ListSituationReportsResponse> {
  const limit = req.limit && req.limit > 0 ? req.limit : 20;
  
  try {
    const url = new URL(RELIEFWEB_API_URL);
    url.searchParams.append('appname', 'worldmonitor');
    url.searchParams.append('limit', limit.toString());
    // Filter for disaster/situation reports
    url.searchParams.append('filter[field]', 'format.name');
    url.searchParams.append('filter[value]', 'Situation Report');
    url.searchParams.append('sort[]', 'date:desc');
    // We want some specific fields to populate our response
    url.searchParams.append('preset', 'latest');
    url.searchParams.append('profile', 'full');

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`Failed to fetch from ReliefWeb: ${response.statusText}`);
    }

    const data = await response.json();
    const reports = (data.data || []).map((item: any): SituationReport => ({
      id: item.id,
      title: item.fields?.title || '',
      body: item.fields?.body || '',
      sourceName: item.fields?.source?.[0]?.name || '',
      sourceUrl: item.fields?.url || '',
      date: item.fields?.date?.created || '',
      countries: (item.fields?.primary_country ? [item.fields.primary_country.name] : []).concat(
        (item.fields?.country || []).map((c: any) => c.name)
      ),
      disasterTypes: (item.fields?.disaster_type || []).map((d: any) => d.name),
    }));

    return { reports };
  } catch (error) {
    console.error('Error fetching ReliefWeb reports:', error);
    return { reports: [] };
  }
}
