import { NextResponse } from 'next/server';
import { ResultSetHeader, RowDataPacket } from 'mysql2';
import { mysqlPool } from '@/lib/db/mysql';
import { ensurePlaygroundSchema } from '@/lib/db/schema';
import { handleApiError } from '@/lib/api-error';
import { requireAdminUser } from '@/lib/db/auth';

export const runtime = 'nodejs';

/** 强制下线：删除该用户全部本地会话 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> } | { params: { id: string } },
) {
  try {
    await requireAdminUser();
    await ensurePlaygroundSchema();

    const params = await Promise.resolve(context.params);
    const targetId = params.id;

    const pool = await mysqlPool();
    const [target] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM playground_users WHERE id = ? LIMIT 1',
      [targetId]
    );
    if (target.length === 0) {
      return NextResponse.json({ success: false, error: '用户不存在' }, { status: 404 });
    }
    const [result] = await pool.query<ResultSetHeader>(
      'DELETE FROM playground_auth_sessions WHERE user_id = ?',
      [targetId]
    );

    return NextResponse.json({ success: true, data: { revoked: result.affectedRows } });
  } catch (error) {
    return handleApiError(error, '强制下线');
  }
}
