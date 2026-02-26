import type { SpaceServiceHandler } from '../../../../src/generated/server/worldmonitor/space/v1/service_server';
import { getSpaceWeather } from './get-space-weather';
import { listSatellites } from './list-satellites';

export const spaceHandler: SpaceServiceHandler = {
  getSpaceWeather,
  listSatellites,
};
