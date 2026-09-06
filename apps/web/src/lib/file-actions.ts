'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { files, getHttpDb } from '@llmgw/db/http';
import { getCurrentWorkspace } from './session';

export interface UploadState {
  ok: boolean;
  error?: string;
}

const MAX_BYTES = 10 * 1024 * 1024;

export async function uploadFile(_prev: UploadState | null, formData: FormData): Promise<UploadState> {
  const file = formData.get('file');
  const path = String(formData.get('path') ?? '')
    .trim()
    .replace(/^\/+|\/+$/g, '');

  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'Choose a file to upload.' };
  if (file.size > MAX_BYTES) return { ok: false, error: 'File exceeds the 10 MB limit.' };

  const ctx = await getCurrentWorkspace();
  if (!ctx) return { ok: false, error: 'No database connected.' };

  const buffer = Buffer.from(await file.arrayBuffer());
  const db = getHttpDb();
  await db.insert(files).values({
    workspaceId: ctx.workspace.id,
    path,
    name: file.name.slice(0, 200),
    mime: file.type || 'application/octet-stream',
    sizeBytes: file.size,
    contentBase64: buffer.toString('base64'),
  });

  revalidatePath('/files');
  return { ok: true };
}

export async function deleteFile(id: string): Promise<{ ok: boolean }> {
  const ctx = await getCurrentWorkspace();
  if (!ctx) return { ok: false };
  const db = getHttpDb();
  await db.delete(files).where(and(eq(files.id, id), eq(files.workspaceId, ctx.workspace.id)));
  revalidatePath('/files');
  return { ok: true };
}
