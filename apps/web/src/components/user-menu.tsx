'use client';

import { LogOut } from 'lucide-react';
import { logoutAction } from '@/lib/auth-actions';

export function UserMenu({ email }: { email: string }) {
  return (
    <div className="space-y-2">
      <div className="truncate px-1 text-xs text-gray-500" title={email}>
        {email}
      </div>
      <form action={logoutAction}>
        <button
          type="submit"
          className="flex w-full items-center gap-2 rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
        >
          <LogOut className="h-4 w-4 text-gray-400" />
          Sign out
        </button>
      </form>
    </div>
  );
}
