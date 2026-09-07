import { listCatalogModels } from '@/lib/models';
import { ModelsView } from '@/components/models-view';

export const dynamic = 'force-dynamic';

export default async function ModelsPage() {
  const models = await listCatalogModels();
  return <ModelsView models={models} />;
}
