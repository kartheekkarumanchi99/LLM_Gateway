'use client';

import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Download, FileText, Trash2, Upload, X } from 'lucide-react';
import { deleteFile, uploadFile, type UploadState } from '@/lib/file-actions';
import type { FileRow } from '@/lib/files';

function fmtDate(iso: string): string {
  return iso.slice(0, 10);
}
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function FilesView({ rows, connected }: { rows: FileRow[]; connected: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  const [state, formAction, pending] = useActionState<UploadState | null, FormData>(uploadFile, null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) {
      setOpen(false);
      formRef.current?.reset();
      router.refresh();
    }
  }, [state, router]);

  function onDelete(row: FileRow) {
    if (!window.confirm(`Delete "${row.name}"?`)) return;
    startTransition(async () => {
      await deleteFile(row.id);
      router.refresh();
    });
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">
            Files{' '}
            <span className="align-middle text-xs font-medium text-blue-600">Beta</span>
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Upload and manage files for this workspace. Files can be referenced by the gateway.
          </p>
        </div>
        <button
          onClick={() => setOpen(true)}
          disabled={!connected}
          className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-violet-700 disabled:opacity-50"
        >
          <Upload className="h-4 w-4" />
          Upload
        </button>
      </div>

      {!connected ? (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Not connected to a database yet. Set <code className="font-mono">DATABASE_URL</code> and run{' '}
          <code className="font-mono">pnpm db:push</code>.
        </div>
      ) : null}

      <div className="mt-6 overflow-hidden rounded-xl border border-gray-200 bg-white">
        {rows.length === 0 ? (
          <div className="grid place-items-center px-5 py-16 text-center">
            <FileText className="mb-2 h-7 w-7 text-gray-300" />
            <div className="font-medium text-gray-700">No files here yet</div>
            <div className="mt-1 max-w-sm text-sm text-gray-500">
              Upload a file to get started. Use a folder path like &ldquo;reports/2026/&rdquo; to organize files.
            </div>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-500">
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Size</th>
                <th className="px-5 py-3 font-medium">Type</th>
                <th className="px-5 py-3 font-medium">Added</th>
                <th className="w-24 px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => (
                <tr key={f.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/60">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2 font-medium text-gray-900">
                      <FileText className="h-4 w-4 text-gray-400" />
                      <span>
                        {f.path ? <span className="text-gray-400">{f.path}/</span> : null}
                        {f.name}
                      </span>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-gray-600">{formatBytes(f.sizeBytes)}</td>
                  <td className="px-5 py-4 text-gray-500">{f.mime}</td>
                  <td className="px-5 py-4 text-gray-600">{fmtDate(f.createdAt)}</td>
                  <td className="px-5 py-4">
                    <div className="flex items-center justify-end gap-1">
                      <a
                        href={`/api/files/${f.id}`}
                        className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                        aria-label="Download"
                      >
                        <Download className="h-4 w-4" />
                      </a>
                      <button
                        onClick={() => onDelete(f)}
                        aria-label="Delete file"
                        className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="border-t border-gray-200 px-5 py-3 text-xs text-gray-500">
          {rows.length} {rows.length === 1 ? 'item' : 'items'}
        </div>
      </div>

      {open ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Upload file</h2>
              <button
                onClick={() => setOpen(false)}
                className="rounded p-1 text-gray-400 hover:bg-gray-100"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form ref={formRef} action={formAction} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">File</label>
                <input
                  name="file"
                  type="file"
                  required
                  className="w-full text-sm text-gray-600 file:mr-3 file:rounded-md file:border-0 file:bg-violet-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-violet-700 hover:file:bg-violet-100"
                />
                <p className="mt-1 text-xs text-gray-400">Up to 10 MB.</p>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Folder path <span className="text-gray-400">— optional</span>
                </label>
                <input
                  name="path"
                  placeholder="reports/2026"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
                />
              </div>
              {state?.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-lg border border-gray-300 px-3.5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-lg bg-violet-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-60"
                >
                  {pending ? 'Uploading…' : 'Upload'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
