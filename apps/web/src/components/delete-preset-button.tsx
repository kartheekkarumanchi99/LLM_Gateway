'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { deletePreset } from '@/lib/preset-actions';

export function DeletePresetButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      onClick={() => {
        if (!window.confirm('Delete this preset?')) return;
        start(async () => {
          await deletePreset(id);
          router.push('/presets');
        });
      }}
      disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
    >
      <Trash2 className="h-4 w-4" />
      {pending ? 'Deleting…' : 'Delete'}
    </button>
  );
}
