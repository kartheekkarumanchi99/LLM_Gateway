import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  email: text('email').notNull().unique(),
  name: text('name'),
  // scrypt hash; null for accounts created before auth (e.g. the demo seed user).
  passwordHash: text('password_hash'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const workspaces = pgTable(
  'workspaces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    // Spend cap in USD; null = no limit.
    budgetLimitUsd: numeric('budget_limit_usd', { precision: 20, scale: 10 }),
    // 'daily' | 'weekly' | 'monthly' | 'lifetime'
    budgetInterval: text('budget_interval').notNull().default('monthly'),
    // Count BYOK-attributed spend toward the workspace budget.
    includeByok: boolean('include_byok').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgSlugUq: uniqueIndex('workspaces_org_slug_uq').on(t.orgId, t.slug),
  }),
);

export const guardrails = pgTable('guardrails', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  isDefault: boolean('is_default').notNull().default(false),
  status: text('status').notNull().default('active'),
  // { budget, modelAccess, promptInjection, sensitiveInfo }
  policies: jsonb('policies'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    keyPrefix: text('key_prefix').notNull(),
    keyLast4: text('key_last4'),
    keyHash: text('key_hash').notNull().unique(),
    guardrailId: uuid('guardrail_id').references(() => guardrails.id, { onDelete: 'set null' }),
    creditLimitUsd: numeric('credit_limit_usd', { precision: 20, scale: 10 }),
    creditLimitInterval: text('credit_limit_interval'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => ({
    prefixIdx: index('api_keys_prefix_idx').on(t.keyPrefix),
    wsIdx: index('api_keys_workspace_idx').on(t.workspaceId),
  }),
);

export const providers = pgTable('providers', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  displayName: text('display_name').notNull(),
  iconUrl: text('icon_url'),
  // Provider data-retention / training policy from the catalog source.
  dataPolicy: jsonb('data_policy'),
  active: boolean('active').notNull().default(true),
});

export const models = pgTable('models', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Public slug used in requests, e.g. "openai/gpt-4o-mini".
  slug: text('slug').notNull().unique(),
  providerSlug: text('provider_slug').notNull(),
  // The model id the upstream provider expects, e.g. "gpt-4o-mini".
  upstreamModel: text('upstream_model').notNull(),
  displayName: text('display_name').notNull(),
  description: text('description'),
  modality: text('modality'),
  contextLength: integer('context_length').notNull().default(8192),
  // Prices are USD per 1,000,000 tokens.
  promptPricePerM: numeric('prompt_price_per_m', { precision: 20, scale: 10 }).notNull().default('0'),
  completionPricePerM: numeric('completion_price_per_m', { precision: 20, scale: 10 }).notNull().default('0'),
  // True when this gateway can actually execute the model (has an adapter + credentials).
  executable: boolean('executable').notNull().default(false),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Cold-start routing prior: relative weight of a model for a task class.
export const modelTaskPriors = pgTable(
  'model_task_priors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskClass: text('task_class').notNull(),
    modelSlug: text('model_slug').notNull(),
    weight: numeric('weight', { precision: 10, scale: 4 }).notNull().default('0'),
  },
  (t) => ({
    uq: uniqueIndex('model_task_priors_uq').on(t.taskClass, t.modelSlug),
  }),
);

export const providerKeys = pgTable('provider_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  providerSlug: text('provider_slug').notNull(),
  label: text('label').notNull(),
  // AES-256-GCM encrypted; never returned to the client.
  encryptedKey: text('encrypted_key').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
});

export const files = pgTable('files', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  path: text('path').notNull().default(''),
  name: text('name').notNull(),
  mime: text('mime').notNull().default('application/octet-stream'),
  sizeBytes: integer('size_bytes').notNull().default(0),
  contentBase64: text('content_base64').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const workspaceSettings = pgTable('workspace_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .unique()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  routing: jsonb('routing'),
  tools: jsonb('tools'),
  observability: jsonb('observability'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const presets = pgTable(
  'presets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    systemPrompt: text('system_prompt'),
    config: jsonb('config'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    slugUq: uniqueIndex('presets_ws_slug_uq').on(t.workspaceId, t.slug),
  }),
);

export const observabilityDestinations = pgTable('observability_destinations', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  name: text('name').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  baseUrl: text('base_url'),
  headers: jsonb('headers'),
  // AES-256-GCM encrypted; never returned to the client.
  apiKeyEnc: text('api_key_enc'),
  samplingRate: numeric('sampling_rate', { precision: 5, scale: 4 }).notNull().default('1'),
  privacyMode: boolean('privacy_mode').notNull().default(false),
  region: text('region').notNull().default('global'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const requestLogs = pgTable(
  'request_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    apiKeyId: uuid('api_key_id').references(() => apiKeys.id, { onDelete: 'set null' }),
    requestId: text('request_id').notNull(),
    modelSlug: text('model_slug').notNull(),
    providerSlug: text('provider_slug').notNull(),
    taskClass: text('task_class'),
    messages: jsonb('messages'),
    completion: text('completion'),
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 20, scale: 10 }).notNull().default('0'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    wsIdx: index('request_logs_workspace_idx').on(t.workspaceId, t.createdAt),
  }),
);

export const usageEvents = pgTable(
  'usage_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Idempotency key: one billable event per request id.
    requestId: text('request_id').notNull().unique(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
    apiKeyId: uuid('api_key_id').references(() => apiKeys.id, { onDelete: 'set null' }),
    modelSlug: text('model_slug').notNull(),
    providerSlug: text('provider_slug').notNull(),
    taskClass: text('task_class'),
    status: text('status').notNull(),
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 20, scale: 10 }).notNull().default('0'),
    latencyMs: integer('latency_ms').notNull().default(0),
    // Whether a customer-provided (BYOK) key served this request.
    byok: boolean('byok').notNull().default(false),
    // Served from our response cache (exact/semantic) → ~zero upstream cost.
    cached: boolean('cached').notNull().default(false),
    // Client app label (from X-Title / Referer), like OpenRouter's app attribution.
    appName: text('app_name'),
    cachedTokens: integer('cached_tokens').notNull().default(0),
    reasoningTokens: integer('reasoning_tokens').notNull().default(0),
    finishReason: text('finish_reason'),
    // Time-to-first-token (streaming) and time spent routing before the upstream call.
    ttftMs: integer('ttft_ms'),
    routingOverheadMs: integer('routing_overhead_ms'),
    routingTrace: jsonb('routing_trace'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    wsIdx: index('usage_events_workspace_idx').on(t.workspaceId, t.createdAt),
  }),
);

export const creditLedger = pgTable(
  'credit_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    // 'topup' | 'debit' | 'refund' | 'adjustment'
    entryType: text('entry_type').notNull(),
    // Signed USD amount: debits are negative.
    amountUsd: numeric('amount_usd', { precision: 20, scale: 10 }).notNull(),
    ref: text('ref'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index('credit_ledger_org_idx').on(t.orgId, t.createdAt),
    refIdx: index('credit_ledger_ref_idx').on(t.ref),
  }),
);

// Response cache: exact-match (prompt hash) + semantic (embedding cosine). A hit
// returns a stored completion at ~zero upstream cost — the biggest, model-agnostic
// cost lever.
export const responseCache = pgTable(
  'response_cache',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    // sha256 of the normalized messages — exact-match key.
    promptHash: text('prompt_hash').notNull(),
    taskClass: text('task_class'),
    // text-embedding-3-small vector for semantic matching (stored as JSON array).
    embedding: jsonb('embedding'),
    model: text('model').notNull(),
    provider: text('provider').notNull(),
    // Stored OpenAI-shaped response body (choices + usage).
    response: jsonb('response').notNull(),
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    hitCount: integer('hit_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastHitAt: timestamp('last_hit_at', { withTimezone: true }),
  },
  (t) => ({
    wsHashIdx: index('response_cache_ws_hash_idx').on(t.workspaceId, t.promptHash),
    wsTaskIdx: index('response_cache_ws_task_idx').on(t.workspaceId, t.taskClass),
  }),
);

export const classifiers = pgTable(
  'classifiers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    preset: text('preset').notNull().default('custom'),
    modelSlug: text('model_slug').notNull(),
    sampleRate: numeric('sample_rate', { precision: 5, scale: 4 }).notNull().default('1'),
    // [{ name: string, values: string[] }]
    dimensions: jsonb('dimensions').notNull(),
    prompt: text('prompt').notNull().default(''),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    wsIdx: index('classifiers_workspace_idx').on(t.workspaceId),
  }),
);

export const classifierResults = pgTable(
  'classifier_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    classifierId: uuid('classifier_id')
      .notNull()
      .references(() => classifiers.id, { onDelete: 'cascade' }),
    requestId: text('request_id').notNull(),
    modelSlug: text('model_slug'),
    // { [dimensionName]: chosenValue }
    tags: jsonb('tags').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    wsIdx: index('classifier_results_workspace_idx').on(t.workspaceId, t.createdAt),
    reqIdx: index('classifier_results_request_idx').on(t.requestId),
  }),
);

export const managementKeys = pgTable(
  'management_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    keyPrefix: text('key_prefix').notNull(),
    keyLast4: text('key_last4').notNull(),
    keyHash: text('key_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index('management_keys_org_idx').on(t.orgId),
  }),
);

export const notificationSettings = pgTable('notification_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .unique()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  lowBalanceEnabled: boolean('low_balance_enabled').notNull().default(false),
  lowBalanceThresholdUsd: numeric('low_balance_threshold_usd', { precision: 20, scale: 2 })
    .notNull()
    .default('100'),
  notifyEmail: text('notify_email'),
  modelDeprecationEnabled: boolean('model_deprecation_enabled').notNull().default(false),
  modelPriceDropEnabled: boolean('model_price_drop_enabled').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    read: boolean('read').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index('notifications_org_idx').on(t.orgId, t.createdAt),
  }),
);

// A user's membership in an org (foundation for multi-tenant access + RBAC).
export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    // 'owner' | 'admin' | 'member'
    role: text('role').notNull().default('member'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userOrgUq: uniqueIndex('memberships_user_org_uq').on(t.userId, t.orgId),
    orgIdx: index('memberships_org_idx').on(t.orgId),
  }),
);

// Server-side sessions. The cookie holds the raw token; only its hash is stored.
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('sessions_user_idx').on(t.userId),
  }),
);
