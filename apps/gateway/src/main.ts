import './bootstrap';
import { buildServer } from './server';
import { config } from './config';

const app = buildServer();

app
  .listen({ port: config.port, host: '0.0.0.0' })
  .then((addr) => app.log.info(`llm-gateway listening on ${addr}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
