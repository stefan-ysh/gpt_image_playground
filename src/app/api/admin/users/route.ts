import { NextResponse } from 'next/server';
import { RowDataPacket } from 'mysql2';
import { mysqlPool } from '@/lib/db/mysql';
import { ensurePlaygroundSchema } from '@/lib/db/schema';
import { handleApiError } from '@/lib/api-error';
import { requireAdminUser } from '@/lib/db/auth';
import { getTodayCountedImageUsage } from '@/lib/db/daily-limit';

export const runtime = 'nodejs';

/** 用户管理列表：账号信息 + 用量统计 + 会话数 */
export async function GET() {
  try {
    await requireAdminUser();
    await ensurePlaygroundSchema();

    const pool = await mysqlPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT u.id, u.email, u.display_name, u.status, u.is_admin, u.login_count,
              u.last_login_ip, u.last_login_ua, u.created_at, u.last_login_at,
              (SELECT COUNT(*) FROM playground_tasks t WHERE t.user_id = u.id) AS task_count,
              (SELECT COUNT(*) FROM playground_tasks t WHERE t.user_id = u.id AND t.status = 'done') AS done_count,
              (SELECT COUNT(*) FROM playground_image_owners o WHERE o.user_id = u.id) AS image_count,
              (SELECT COUNT(*) FROM playground_auth_sessions s WHERE s.user_id = u.id AND s.expires_at > NOW()) AS active_sessions
       FROM playground_users u
       ORDER BY u.is_admin DESC, u.created_at DESC`
    );

    // 今日用量按每人单独计算（时间窗为北京时间自然日）
    const todayStart = getShanghaiDayStartMs();
    const users = [];
    for (const row of rows) {
      const usedToday = await getTodayCountedImageUsage(pool, row.id);
      users.push({
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        status: row.status,
        isAdmin: Boolean(Number(row.is_admin)),
        loginCount: Number(row.login_count) || 0,
        lastLoginIp: row.last_login_ip || null,
        lastLoginUa: row.last_login_ua || null,
        createdAt: row.created_at,
        lastLoginAt: row.last_login_at,
        taskCount: Number(row.task_count) || 0,
        doneCount: Number(row.done_count) || 0,
        imageCount: Number(row.image_count) || 0,
        activeSessions: Number(row.active_sessions) || 0,
        usedToday,
      });
    }

    return NextResponse.json({ success: true, data: users });
  } catch (error) {
    return handleApiError(error, '获取用户列表');
  }
}

function getShanghaiDayStartMs(): number {
  const now = new Date();
  const shanghai = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  shanghai.setHours(0, 0, 0, 0);
  // 转回 UTC 时间戳：本地(上海视图)时间 - 偏移
  const offsetMs = shanghai.getTime() - new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' })).getTime();
  return shanghai.getTime() - offsetMs;
}
