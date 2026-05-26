import { cookies } from 'next/headers';
import { mysqlPool } from './mysql';
import { RowDataPacket } from 'mysql2';

export type CurrentUser = {
  id: string;
  email: string;
  displayName: string | null;
  role: string;
};

const DEFAULT_SESSION_COOKIE_NAMES = ['finance_session'];

function getSessionCookieNames() {
  const configured = process.env.AUTH_SESSION_COOKIE_NAMES
    ?.split(',')
    .map((name) => name.trim())
    .filter(Boolean);

  return configured?.length ? configured : DEFAULT_SESSION_COOKIE_NAMES;
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const cookieStore = await cookies();
  const token = getSessionCookieNames()
    .map((name) => cookieStore.get(name)?.value)
    .find(Boolean);
  if (!token) return null;

  const pool = await mysqlPool();

  try {
    // console.log('[Auth] Checking token:', token);
    // 1. 查询 admin_cosmorigin 数据库中匹配 session_token 并且未过期的 session
    const [sessionRows] = await pool.query<RowDataPacket[]>(
      `SELECT user_id, expires_at FROM admin_cosmorigin.auth_sessions 
       WHERE session_token = ? 
       LIMIT 1`,
      [token]
    );

    // console.log('[Auth] sessionRows:', sessionRows);

    if (sessionRows.length === 0) {
      // console.log('[Auth] Token not found in db');
      return null;
    }
    
    // Check expiration manually for debugging
    const expiresAt = new Date(sessionRows[0].expires_at);
    if (expiresAt.getTime() < Date.now()) {
      // console.log('[Auth] Token expired. expires_at:', expiresAt, 'now:', new Date());
      return null;
    }

    const userId = sessionRows[0].user_id;

    // 2. 查询 admin_cosmorigin 数据库对应的 hr_employees 活跃用户信息
    const [userRows] = await pool.query<RowDataPacket[]>(
      `SELECT id, email, display_name, primary_role, is_active, employment_status 
       FROM admin_cosmorigin.hr_employees 
       WHERE id = ? LIMIT 1`,
      [userId]
    );

    if (userRows.length === 0) return null;
    const user = userRows[0];

    // 校验活跃状态
    if (user.is_active !== 1 || user.employment_status === 'terminated') {
      return null;
    }

    return {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      role: user.primary_role,
    };
  } catch (error) {
    console.error('获取当前用户失败:', error);
    throw new Error('AUTH_CHECK_FAILED');
  }
}

export async function requireCurrentUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('UNAUTHENTICATED');
  }
  return user;
}
