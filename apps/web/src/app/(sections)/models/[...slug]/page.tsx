import { notFound } from 'next/navigation';
import { getModelDetail, getModelInsights } from '@/lib/models';
import { ModelDetailView } from '@/components/model-detail-view';

export const dynamic = 'force-dynamic';

export default async function ModelDetailPage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = await params;
  const modelSlug = (slug ?? []).join('/');
  const [model, insights] = await Promise.all([
    getModelDetail(modelSlug),
    getModelInsights(modelSlug),
  ]);
  if (!model) notFound();
  return <ModelDetailView model={model} insights={insights} />;
}
