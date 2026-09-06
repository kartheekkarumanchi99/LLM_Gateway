import { and, eq } from 'drizzle-orm';
import { files, getHttpDb } from '@llmgw/db/http';
import { getCurrentWorkspace } from '@/lib/session';

// Streams a stored file back to the browser, scoped to the current workspace.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCurrentWorkspace();
  if (!ctx) return new Response('Not found', { status: 404 });

  const db = getHttpDb();
  const rows = await db
    .select()
    .from(files)
    .where(and(eq(files.id, id), eq(files.workspaceId, ctx.workspace.id)))
    .limit(1);
  const f = rows[0];
  if (!f) return new Response('Not found', { status: 404 });

  const buffer = Buffer.from(f.contentBase64, 'base64');
  return new Response(buffer, {
    headers: {
      'content-type': f.mime,
      'content-disposition': `attachment; filename="${encodeURIComponent(f.name)}"`,
      'content-length': String(buffer.length),
    },
  });
}
