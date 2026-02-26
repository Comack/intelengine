import type { MaritimeServiceHandler } from '../../../../src/generated/server/worldmonitor/maritime/v1/service_server';

import { getVesselSnapshot } from './get-vessel-snapshot';
import { listNavigationalWarnings } from './list-navigational-warnings';
import { listSarDetections } from './list-sar-detections';
import { getPortCongestion } from './get-port-congestion';

export const maritimeHandler: MaritimeServiceHandler = {
  getVesselSnapshot,
  listNavigationalWarnings,
  listSarDetections,
  getPortCongestion,
};
