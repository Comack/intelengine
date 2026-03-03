import type {
  SubmitForensicsFeedbackRequest,
  SubmitForensicsFeedbackResponse,
  ServerContext,
} from '../../../../src/generated/server/worldmonitor/intelligence/v1/service_server';
import { saveForensicsFeedback } from './forensics-blackboard';

export async function submitForensicsFeedback(
  _ctx: ServerContext,
  req: SubmitForensicsFeedbackRequest,
): Promise<SubmitForensicsFeedbackResponse> {
  if (!req.sourceId || !req.signalType) {
    return { success: false };
  }

  await saveForensicsFeedback({
    sourceId: req.sourceId,
    signalType: req.signalType,
    isTruePositive: req.isTruePositive,
    timestamp: Date.now(),
  });

  return { success: true };
}