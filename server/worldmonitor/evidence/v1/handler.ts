import type { EvidenceServiceHandler } from '../../../../src/generated/server/worldmonitor/evidence/v1/service_server';
import { ingestEvidence } from './ingest-evidence';
import { getEvidence } from './get-evidence';
import { listEvidence } from './list-evidence';

export const evidenceHandler: EvidenceServiceHandler = {
  ingestEvidence,
  getEvidence,
  listEvidence,
};