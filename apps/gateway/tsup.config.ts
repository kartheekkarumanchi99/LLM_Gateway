import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  // Bundle the raw-TS workspace packages (e.g. @llmgw/db) into the output.
  noExternal: [/^@llmgw\//],
  clean: true,
  sourcemap: true,
});
