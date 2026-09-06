import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { ContentForm } from '@/components/guardrail-forms';
import { getGuardrail } from '@/lib/guardrails';
import { getCurrentWorkspace } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCurrentWorkspace();
  if (!ctx) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Not connected to a database yet.
      </div>
    );
  }
  const g = await getGuardrail(id, ctx.workspace.id);
  if (!g) notFound();

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href="/guardrails" className="flex items-center gap-1 hover:text-gray-900">
          <ArrowLeft className="h-4 w-4" />
          Guardrails
        </Link>
        <ChevronRight className="h-4 w-4" />
        <Link href={`/guardrails/${id}`} className="hover:text-gray-900">
          {g.name}
        </Link>
        <ChevronRight className="h-4 w-4" />
        <span className="text-gray-900">Prompt Injection</span>
      </div>

      <h1 className="mt-3 text-2xl font-semibold text-gray-900">Prompt Injection</h1>
      <p className="mt-1 text-sm text-gray-500">
        Detect and respond to prompt-injection attempts in request inputs (heuristic detection).
      </p>

      <div className="mt-6 max-w-xl">
        <ContentForm id={id} field="promptInjection" value={g.policies?.promptInjection ?? 'off'} />
      </div>
    </div>
  );
}
