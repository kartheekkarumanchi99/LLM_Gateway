// Observability contracts shared by the web app and gateway.

export interface ObservabilityConfig {
  inputOutputLogging: boolean;
  broadcast: boolean;
}

export const DEFAULT_OBSERVABILITY_CONFIG: ObservabilityConfig = {
  inputOutputLogging: false,
  broadcast: false,
};

export interface ObsDestinationType {
  id: string;
  label: string;
  description: string;
  defaultBaseUrl?: string;
}

// Catalog of supported external trace destinations. The generic connection
// fields (base URL + headers + API key) cover OTLP/HTTP-style endpoints.
export const OBSERVABILITY_DESTINATIONS: ObsDestinationType[] = [
  { id: 'arize', label: 'Arize AX', description: 'OTLP traces to Arize AX.', defaultBaseUrl: 'https://otlp.arize.com' },
  { id: 'braintrust', label: 'Braintrust', description: 'Send traces to Braintrust.' },
  { id: 'clickhouse', label: 'ClickHouse', description: 'Insert traces into ClickHouse.' },
  { id: 'cometopik', label: 'Comet Opik', description: 'Send traces to Comet Opik.' },
  { id: 'datadog', label: 'Datadog', description: 'Send traces to Datadog.' },
  { id: 'bigquery', label: 'Google BigQuery', description: 'Stream traces into BigQuery.' },
  { id: 'grafana', label: 'Grafana Cloud', description: 'OTLP traces to Grafana Cloud.' },
  { id: 'langfuse', label: 'Langfuse', description: 'Send traces to Langfuse.', defaultBaseUrl: 'https://cloud.langfuse.com' },
  { id: 'langsmith', label: 'LangSmith', description: 'Send traces to LangSmith.' },
  { id: 'newrelic', label: 'New Relic AI', description: 'OTLP traces to New Relic.' },
  { id: 'otel', label: 'OpenTelemetry Collector', description: 'Generic OTLP/HTTP collector.' },
  { id: 'posthog', label: 'PostHog', description: 'Send events to PostHog.' },
];

export function destinationLabel(id: string): string {
  return OBSERVABILITY_DESTINATIONS.find((d) => d.id === id)?.label ?? id;
}
