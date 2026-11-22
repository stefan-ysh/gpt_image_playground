import { NextResponse } from 'next/server';
import { mysqlPool } from '@/lib/db/mysql';
import { handleApiError } from '@/lib/api-error';
import { requireCurrentUser, hashPassword } from '@/lib/db/auth';

export const runtime = 'nodejs';

/** 修改当前登录用户自己的密码（新用户密码由 CLI 脚本初始化） */
export async function POST(request: Request) {
  try {
    const user = await requireCurrentUser();

    const body = await request.json().catch(() => null);
    const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : '';
    if (newPassword.length < 8) {
      return NextResponse.json({ success: false, error: '密码长度至少 8 位' }, { status: 400 });
    }

    const pool = await mysqlPool();
    await pool.query('UPDATE playground_users SET password_hash = ? WHERE id = ?', [
      hashPassword(newPassword),
      user.id,
    ]);

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, '修改密码');
  }
}
