import { sql } from 'drizzle-orm';
import { getDb, shadowSamples, MAX_PENDING_SAMPLES } from '@llmgw/db';
import type { ChatMessage } from '../providers/types';
import { getSentinelConfig } from './config';
import { scrubMessages, scrubText } from './scrub';

export interface ShadowSampleInput {
  orgId: string;
  workspaceId: string;
  requestId: string;
  taskClass: string;
  baselineModel: string;
  baselineProvider: string;
  messages: ChatMessage[];
  referenceOutput: string;
  referenceTokens: number;
  maxTokens: number;
}

// Fire-and-forget: probabilistically enqueue a PII-scrubbed duplicate of a served request
// for background shadow evaluation. Never throws — sampling must not affect the response.
export async function maybeShadowSample(input: ShadowSampleInput): Promise<void> {
  try {
    if (!input.referenceOutput.trim()) return; // nothing to compare candidates against
    const cfg = await getSentinelConfig(input.workspaceId);
    if (!cfg.enabled || cfg.sampleRatePct <= 0) return;
    if (Math.random() * 100 >= cfg.sampleRatePct) return;

    const db = getDb();
    // Backpressure: don't let the queue grow unbounded if the worker falls behind.
    const pending = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(shadowSamples)
      .where(sql`${shadowSamples.status} = 'pending'`);
    if (Number(pending[0]?.n ?? 0) >= MAX_PENDING_SAMPLES) return;

    const scrubbed = scrubMessages(input.messages);
    const ref = scrubText(input.referenceOutput);

    await db.insert(shadowSamples).values({
      workspaceId: input.workspaceId,
      orgId: input.orgId,
      requestId: input.requestId,
      taskClass: input.taskClass,
      baselineModel: input.baselineModel,
      baselineProvider: input.baselineProvider,
      messages: scrubbed.messages as unknown as object,
      referenceOutput: ref.text.slice(0, 20_000),
      referenceTokens: input.referenceTokens,
      scrubbed: scrubbed.redacted || ref.redacted,
      maxTokens: input.maxTokens,
      status: 'pending',
    });
  } catch (e) {
    console.error('[sentinel] sample enqueue failed:', (e as Error).message);
  }
}
