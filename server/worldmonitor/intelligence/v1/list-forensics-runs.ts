import type {
  ListForensicsRunsRequest,
  ListForensicsRunsResponse,
  ServerContext,
} from '../../../../src/generated/server/worldmonitor/intelligence/v1/service_server';
import { listForensicsRunSummaries } from './forensics-blackboard';

export async function listForensicsRuns(
  _ctx: ServerContext,
  req: ListForensicsRunsRequest,
): Promise<ListForensicsRunsResponse> {
  const runs = await listForensicsRunSummaries({
    domain: req.domain,
    status: req.status,
    limit: req.limit,
    offset: req.offset,
  });

  return {
    runs,
    error: '',
  };
}
