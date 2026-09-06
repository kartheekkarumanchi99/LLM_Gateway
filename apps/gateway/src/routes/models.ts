import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { getDb, models } from '@llmgw/db';

export function registerModels(app: FastifyInstance): void {
  app.get('/v1/models', async () => {
    const rows = await getDb().select().from(models).where(eq(models.active, true));
    return {
      object: 'list',
      data: [
        {
          id: 'auto',
          object: 'model',
          owned_by: 'llmgw',
          context_length: 0,
          pricing: { prompt: '0', completion: '0' },
        },
        ...rows.map((m) => ({
          id: m.slug,
          object: 'model',
          owned_by: m.providerSlug,
          context_length: m.contextLength,
          pricing: {
            prompt: String(m.promptPricePerM),
            completion: String(m.completionPricePerM),
          },
        })),
      ],
    };
  });
}
