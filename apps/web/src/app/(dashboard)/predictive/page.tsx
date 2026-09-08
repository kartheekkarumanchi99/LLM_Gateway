import { getCurrentWorkspace } from '@/lib/session';
import {
  getPredictiveByTask,
  getPredictiveConfig,
  getPredictiveEvents,
  getPredictiveSummary,
} from '@/lib/predictive';
import { PredictiveView } from '@/components/predictive-view';
import { DEFAULT_PREDICTIVE_CONFIG } from '@llmgw/db/http';

export const dynamic = 'force-dynamic';

export default async function PredictivePage() {
  const ctx = await getCurrentWorkspace();
  if (!ctx) {
    return (
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Predictive Routing</h1>
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Not connected to a database yet.
        </div>
      </div>
    );
  }
  const wsId = ctx.workspace.id;
  const [config, summary, byTask, events] = await Promise.all([
    getPredictiveConfig(wsId),
    getPredictiveSummary(wsId, 30),
    getPredictiveByTask(wsId, 30),
    getPredictiveEvents(wsId, 40),
  ]);
  return (
    <PredictiveView
      config={config ?? DEFAULT_PREDICTIVE_CONFIG}
      summary={summary}
      byTask={byTask}
      events={events}
    />
  );
}
