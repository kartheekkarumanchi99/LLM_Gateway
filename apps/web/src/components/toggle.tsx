'use client';

export function Toggle({
  on,
  onChange,
  disabled,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!on)}
      aria-pressed={on}
      className={`relative h-5 w-9 shrink-0 rounded-full transition ${on ? 'bg-violet-600' : 'bg-gray-300'} disabled:opacity-50`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${on ? 'left-4' : 'left-0.5'}`}
      />
    </button>
  );
}

export function SaveButton({
  pending,
  saved,
  onClick,
  disabled,
}: {
  pending: boolean;
  saved: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={pending || disabled}
      className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-60"
    >
      {pending ? 'Saving…' : saved ? 'Saved' : 'Save'}
    </button>
  );
}
