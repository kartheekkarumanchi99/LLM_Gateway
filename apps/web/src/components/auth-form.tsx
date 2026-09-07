'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import type { AuthState } from '@/lib/auth-actions';

type AuthAction = (prev: AuthState | null, formData: FormData) => Promise<AuthState>;

export function AuthForm({ mode, action }: { mode: 'login' | 'register'; action: AuthAction }) {
  const [state, formAction, pending] = useActionState<AuthState | null, FormData>(action, null);
  const isRegister = mode === 'register';

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-5">
        <h1 className="text-lg font-semibold text-gray-900">
          {isRegister ? 'Create your account' : 'Sign in'}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          {isRegister ? 'Start using the gateway dashboard.' : 'Welcome back.'}
        </p>
      </div>

      <form action={formAction} className="space-y-4">
        {isRegister ? (
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Name</label>
            <input
              name="name"
              required
              maxLength={80}
              autoComplete="name"
              placeholder="Ada Lovelace"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
            />
          </div>
        ) : null}

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Email</label>
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Password</label>
          <input
            type="password"
            name="password"
            required
            minLength={isRegister ? 8 : undefined}
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            placeholder={isRegister ? 'At least 8 characters' : 'Your password'}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
          />
        </div>

        {state?.error ? <p className="text-sm text-red-600">{state.error}</p> : null}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-violet-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-60"
        >
          {pending ? 'Please wait…' : isRegister ? 'Create account' : 'Sign in'}
        </button>
      </form>

      <p className="mt-4 text-center text-sm text-gray-500">
        {isRegister ? 'Already have an account? ' : "Don't have an account? "}
        <Link
          href={isRegister ? '/login' : '/register'}
          className="font-medium text-violet-600 hover:text-violet-700"
        >
          {isRegister ? 'Sign in' : 'Create one'}
        </Link>
      </p>
    </div>
  );
}
