import { NextResponse } from 'next/server';
import { RowDataPacket } from 'mysql2';
import { mysqlPool } from '@/lib/db/mysql';
import { ensurePlaygroundSchema } from '@/lib/db/schema';
import { handleApiError } from '@/lib/api-error';
import { verifyPassword, issueLocalSession } from '@/lib/db/auth';

function getRequestIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip');
}

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    await ensurePlaygroundSchema();

    const body = await request.json().catch(() => null);
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    if (!email || !password) {
      return NextResponse.json({ success: false, error: '请输入邮箱和密码' }, { status: 400 });
    }

    const pool = await mysqlPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT id, email, display_name, status, is_admin, password_hash FROM playground_users WHERE email = ? LIMIT 1',
      [email]
    );
    const user = rows[0];

    // 统一失败文案，避免枚举有效邮箱
    if (!user || user.status !== 'active' || !verifyPassword(password, user.password_hash ?? null)) {
      return NextResponse.json({ success: false, error: '邮箱或密码错误' }, { status: 401 });
    }

    await issueLocalSession(user.id, request.headers.get('user-agent'), getRequestIp(request));
    await pool.query(
      `UPDATE playground_users
       SET last_login_at = NOW(),
           last_login_ip = ?,
           last_login_ua = ?,
           login_count = login_count + 1
       WHERE id = ?`,
      [
        getRequestIp(request),
        (request.headers.get('user-agent') || '').slice(0, 255),
        user.id,
      ]
    );

    return NextResponse.json({
      success: true,
      data: { id: user.id, email: user.email, displayName: user.display_name, role: 'member', isAdmin: Boolean(Number(user.is_admin)) },
    });
  } catch (error) {
    return handleApiError(error, '登录');
  }
}
