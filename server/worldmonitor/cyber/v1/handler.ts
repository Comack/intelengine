import type { CyberServiceHandler } from '../../../../src/generated/server/worldmonitor/cyber/v1/service_server';

import { listCyberThreats } from './list-cyber-threats';
import { listExploitedVulnerabilities } from './list-exploited-vulnerabilities';
import { listInfoOpsSignals } from './list-info-ops-signals';

export const cyberHandler: CyberServiceHandler = {
  listCyberThreats,
  listExploitedVulnerabilities,
  listInfoOpsSignals,
};
