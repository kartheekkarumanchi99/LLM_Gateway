import { desc, eq } from 'drizzle-orm';
import { files, getHttpDb } from '@llmgw/db/http';

export interface FileRow {
  id: string;
  path: string;
  name: string;
  mime: string;
  sizeBytes: number;
  createdAt: string;
}

export async function listFiles(workspaceId: string): Promise<FileRow[]> {
  const db = getHttpDb();
  const rows = await db
    .select({
      id: files.id,
      path: files.path,
      name: files.name,
      mime: files.mime,
      sizeBytes: files.sizeBytes,
      createdAt: files.createdAt,
    })
    .from(files)
    .where(eq(files.workspaceId, workspaceId))
    .orderBy(desc(files.createdAt));
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}
