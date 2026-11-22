import { NextResponse } from 'next/server';
import { mysqlPool } from '@/lib/db/mysql';
import { handleApiError } from '@/lib/api-error';
import { requireCurrentUser } from '@/lib/db/auth';

export const runtime = 'nodejs';

/** 修改当前登录用户的昵称 */
export async function POST(request: Request) {
  try {
    const user = await requireCurrentUser();

    const body = await request.json().catch(() => null);
    const displayName = typeof body?.displayName === 'string' ? body.displayName.trim() : '';
    if (!displayName) {
      return NextResponse.json({ success: false, error: '昵称不能为空' }, { status: 400 });
    }
    if (displayName.length > 50) {
      return NextResponse.json({ success: false, error: '昵称最长 50 个字符' }, { status: 400 });
    }

    const pool = await mysqlPool();
    await pool.query('UPDATE playground_users SET display_name = ? WHERE id = ?', [
      displayName,
      user.id,
    ]);

    return NextResponse.json({
      success: true,
      data: { ...user, displayName },
    });
  } catch (error) {
    return handleApiError(error, '修改昵称');
  }
}
