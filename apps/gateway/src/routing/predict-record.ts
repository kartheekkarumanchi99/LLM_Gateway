import { getDb, predictiveRoutingEvents } from '@llmgw/db';

// One row per predictive-routing decision. Fire-and-forget: recording telemetry
// must never break the response path.
export interface PredictiveEventDraft {
  requestId: string;
  workspaceId: string | null;
  predictorVersion: string;
  mode: 'observation' | 'speculation';
  predictedTaskClass: string | null;
  actualTaskClass: string | null;
  predictedModel: string | null;
  authoritativeModel: string | null;
  committedModel: string | null;
  predictionConfidence: number | null;
  predictionCorrect: boolean | null;
  speculationStarted: boolean;
  loserCancelled: boolean;
  commitReason: string | null;
  routingOverheadMs: number | null;
  estimatedStandardOverheadMs: number | null;
  predictorLatencyMs: number | null;
  speculationWasteUsd: number;
}

export async function recordPredictiveEvent(e: PredictiveEventDraft): Promise<void> {
  try {
    await getDb()
      .insert(predictiveRoutingEvents)
      .values({
        requestId: e.requestId,
        workspaceId: e.workspaceId ?? null,
        predictorVersion: e.predictorVersion,
        mode: e.mode,
        predictedTaskClass: e.predictedTaskClass ?? null,
        actualTaskClass: e.actualTaskClass ?? null,
        predictedModel: e.predictedModel ?? null,
        authoritativeModel: e.authoritativeModel ?? null,
        committedModel: e.committedModel ?? null,
        predictionConfidence: e.predictionConfidence != null ? e.predictionConfidence.toFixed(4) : null,
        predictionCorrect: e.predictionCorrect ?? null,
        speculationStarted: e.speculationStarted,
        loserCancelled: e.loserCancelled,
        commitReason: e.commitReason ?? null,
        routingOverheadMs: e.routingOverheadMs ?? null,
        estimatedStandardOverheadMs: e.estimatedStandardOverheadMs ?? null,
        predictorLatencyMs: e.predictorLatencyMs ?? null,
        speculationWasteUsd: e.speculationWasteUsd.toFixed(10),
      });
  } catch (err) {
    console.error('[predict] event record failed:', (err as Error).message);
  }
}
