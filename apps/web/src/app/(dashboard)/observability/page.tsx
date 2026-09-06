import { DEFAULT_OBSERVABILITY_CONFIG, OBSERVABILITY_DESTINATIONS } from '@llmgw/db/http';
import { getCurrentWorkspace } from '@/lib/session';
import { getObservability } from '@/lib/observability';
import { ObservabilityView } from '@/components/observability-view';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const ctx = await getCurrentWorkspace();
  if (!ctx) {
    return (
      <ObservabilityView
        initialConfig={DEFAULT_OBSERVABILITY_CONFIG}
        destinations={[]}
        catalog={OBSERVABILITY_DESTINATIONS}
        connected={false}
      />
    );
  }
  const { config, destinations } = await getObservability(ctx.workspace.id);
  return (
    <ObservabilityView
      initialConfig={config}
      destinations={destinations}
      catalog={OBSERVABILITY_DESTINATIONS}
      connected
    />
  );
}
