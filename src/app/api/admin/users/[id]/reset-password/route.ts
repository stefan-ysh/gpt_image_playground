import { NextResponse } from 'next/server';
import { ResultSetHeader, RowDataPacket } from 'mysql2';
import { mysqlPool } from '@/lib/db/mysql';
import { ensurePlaygroundSchema } from '@/lib/db/schema';
import { handleApiError } from '@/lib/api-error';
import { requireAdminUser, hashPassword } from '@/lib/db/auth';

export const runtime = 'nodejs';

/** 管理员重置用户密码（重置后同时踢下线） */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> } | { params: { id: string } },
) {
  try {
    await requireAdminUser();
    await ensurePlaygroundSchema();

    const params = await Promise.resolve(context.params);
    const targetId = params.id;
    const body = await request.json().catch(() => null);
    const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : '';
    if (newPassword.length < 8) {
      return NextResponse.json({ success: false, error: '密码长度至少 8 位' }, { status: 400 });
    }

    const pool = await mysqlPool();
    const [result] = await pool.query<ResultSetHeader>(
      'UPDATE playground_users SET password_hash = ? WHERE id = ?',
      [hashPassword(newPassword), targetId]
    );
    if (result.affectedRows === 0) {
      return NextResponse.json({ success: false, error: '用户不存在' }, { status: 404 });
    }
    await pool.query('DELETE FROM playground_auth_sessions WHERE user_id = ?', [targetId]);

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, '重置用户密码');
  }
}
