import type { SeismologyServiceHandler } from '../../../../src/generated/server/worldmonitor/seismology/v1/service_server';

import { listEarthquakes } from './list-earthquakes';
import { listTsunamiWarnings } from './list-tsunami-warnings';

export const seismologyHandler: SeismologyServiceHandler = {
  listEarthquakes,
  listTsunamiWarnings,
};
