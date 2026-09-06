# llm-gateway

An OpenAI-compatible, multi-provider LLM gateway (OpenRouter-style). Vendor-neutral:
runs on **Neon Postgres** and your **own OpenAI/Anthropic keys**. No cloud lock-in.

## What works today

- `POST /v1/chat/completions` — streaming (SSE) and non-streaming, OpenAI-compatible
- `GET /v1/models` — model catalog from the database
- `GET /health` — liveness + DB check
- API-key auth (SHA-256 hashed keys), per-request usage metering, double-entry credit ledger
- Provider adapters: **OpenAI** (native) and **Anthropic** (translated to OpenAI shape)
- Idempotent billing via `Idempotency-Key` header (safe retries, no double charge)

## Layout

```
apps/gateway     Fastify gateway (persistent server, streaming-friendly)
packages/db      Drizzle schema + Neon client + seed
```

## Setup

1. Install pnpm (this machine):
   ```powershell
   npm i -g pnpm@10.9.0
   $env:Path = "C:\Users\t-kartheekk\AppData\Roaming\npm;" + $env:Path
   ```
2. Install deps: `pnpm install`
3. Copy `.env.example` to `.env` and fill `DATABASE_URL`, `DIRECT_URL`, `OPENAI_API_KEY`.
4. Create tables: `pnpm db:push`
5. Seed catalog + a demo API key (printed once): `pnpm db:seed`
6. Run the gateway: `pnpm dev`

## Try it

```powershell
curl http://localhost:8787/v1/chat/completions `
  -H "Authorization: Bearer <SEEDED_KEY>" `
  -H "Content-Type: application/json" `
  -d '{ "model": "openai/gpt-4o-mini", "messages": [{ "role": "user", "content": "hi" }] }'
```

Point any OpenAI SDK at `http://localhost:8787/v1` with the seeded key to migrate existing code.

## Notes

- Neon resolves dual-stack; IPv6 is unreliable on some networks, so the gateway forces
  IPv4-first DNS at boot.
- The gateway is a persistent Node server (uses `pg` Pool for real transactions), so host it
  on Render/Fly/Railway rather than short-lived serverless functions.
