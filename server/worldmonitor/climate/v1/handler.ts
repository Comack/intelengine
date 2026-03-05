import type { ClimateServiceHandler } from '../../../../src/generated/server/worldmonitor/climate/v1/service_server';

import { listClimateAnomalies } from './list-climate-anomalies';
import { listAirQualityReadings } from './list-air-quality-readings';
import { listDeforestationAlerts } from './list-deforestation-alerts';
import { getPollutionGrid } from './get-pollution-grid';
import { getWeatherForecast } from './get-weather-forecast';

export const climateHandler: ClimateServiceHandler = {
  listClimateAnomalies,
  listAirQualityReadings,
  listDeforestationAlerts,
  getPollutionGrid,
  getWeatherForecast,
};
