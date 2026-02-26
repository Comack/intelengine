import type { IntelligenceServiceHandler } from '../../../../src/generated/server/worldmonitor/intelligence/v1/service_server';

import { getRiskScores } from './get-risk-scores';
import { getPizzintStatus } from './get-pizzint-status';
import { classifyEvent } from './classify-event';
import { getCountryIntelBrief } from './get-country-intel-brief';
import { searchGdeltDocuments } from './search-gdelt-documents';
import { runForensicsShadow } from './run-forensics-shadow';
import { listFusedSignals } from './list-fused-signals';
import { listCalibratedAnomalies } from './list-calibrated-anomalies';
import { getForensicsTrace } from './get-forensics-trace';
import { getForensicsRun } from './get-forensics-run';
import { listForensicsRuns } from './list-forensics-runs';
import { getForensicsPolicy } from './get-forensics-policy';
import { getForensicsTopologySummary } from './get-forensics-topology-summary';
import { submitForensicsFeedback } from './submit-forensics-feedback';
import { explainAnomaly } from './explain-anomaly';

export const intelligenceHandler: IntelligenceServiceHandler = {
  getRiskScores,
  getPizzintStatus,
  classifyEvent,
  getCountryIntelBrief,
  searchGdeltDocuments,
  runForensicsShadow,
  listFusedSignals,
  listCalibratedAnomalies,
  getForensicsTrace,
  getForensicsRun,
  listForensicsRuns,
  getForensicsPolicy,
  getForensicsTopologySummary,
  submitForensicsFeedback,
  explainAnomaly,
};
