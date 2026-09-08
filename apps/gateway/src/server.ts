import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { registerHealth } from './routes/health';
import { registerModels } from './routes/models';
import { registerChat } from './routes/chat';
import { registerAdmin } from './routes/admin';
import { registerRouting } from './routes/routing';

export function buildServer(): FastifyInstance {
  const app = Fastify({
    logger: true,
    // LLM payloads can be large (images, long contexts).
    bodyLimit: 25 * 1024 * 1024,
  });

  app.register(cors, { origin: true });

  registerHealth(app);
  registerModels(app);
  registerChat(app);
  registerAdmin(app);
  registerRouting(app);

  return app;
}
