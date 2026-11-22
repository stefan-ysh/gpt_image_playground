import { cookies } from 'next/headers';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { mysqlPool } from './mysql';
import { RowDataPacket } from 'mysql2';

export type CurrentUser = {
  id: string;
  email: string;
  displayName: string | null;
  role: string;
  isAdmin: boolean;
};

/** 本地会话 cookie：本项目自建认证，不再依赖 admin/ERP 的 finance_session */
const LOCAL_SESSION_COOKIE = process.env.AUTH_SESSION_COOKIE_NAME || 'image_studio_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// ---- 密码（scrypt，存储格式 "salt:hash"，与 scripts/manage-user.mjs 保持一致）----

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = scryptSync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function setSessionCookie(token: string) {
  const cookieStore = await cookies();
  cookieStore.set(LOCAL_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

/** 签发本地会话：登录成功后调用，写入会话表并下发 httpOnly cookie */
export async function issueLocalSession(
  userId: string,
  userAgent: string | null,
  loginIp: string | null = null,
): Promise<string> {
  const pool = await mysqlPool();
  const token = randomBytes(32).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await pool.query(
    'INSERT INTO playground_auth_sessions (session_token, user_id, expires_at, created_at, user_agent, login_ip) VALUES (?, ?, ?, ?, ?, ?)',
    [token, userId, expiresAt, now, userAgent?.slice(0, 255) ?? null, loginIp?.slice(0, 64) ?? null]
  );
  // 顺手清理该用户的过期会话
  await pool.query('DELETE FROM playground_auth_sessions WHERE user_id = ? AND expires_at < NOW()', [userId]);
  await setSessionCookie(token);
  return token;
}

/** 注销：删除会话记录并清除 cookie */
export async function destroyLocalSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(LOCAL_SESSION_COOKIE)?.value;
  if (token) {
    const pool = await mysqlPool();
    await pool.query('DELETE FROM playground_auth_sessions WHERE session_token = ?', [token]);
  }
  cookieStore.delete(LOCAL_SESSION_COOKIE);
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(LOCAL_SESSION_COOKIE)?.value;
  if (!token) return null;

  const pool = await mysqlPool();

  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT u.id, u.email, u.display_name, u.status, u.is_admin, s.expires_at
       FROM playground_auth_sessions s
       JOIN playground_users u ON u.id = s.user_id
       WHERE s.session_token = ?
       LIMIT 1`,
      [token]
    );

    if (rows.length === 0) return null;
    const row = rows[0];
    if (new Date(row.expires_at).getTime() < Date.now()) return null;
    if (row.status !== 'active') return null;

    return {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      role: 'member',
      isAdmin: Boolean(Number(row.is_admin)),
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

/** 管理接口守卫：非超级管理员返回 FORBIDDEN（handleApiError → 403） */
export async function requireAdminUser(): Promise<CurrentUser> {
  const user = await requireCurrentUser();
  if (!user.isAdmin) {
    throw new Error('FORBIDDEN');
  }
  return user;
}
