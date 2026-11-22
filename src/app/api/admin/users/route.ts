import { NextResponse } from 'next/server';
import { RowDataPacket } from 'mysql2';
import { mysqlPool } from '@/lib/db/mysql';
import { ensurePlaygroundSchema } from '@/lib/db/schema';
import { handleApiError } from '@/lib/api-error';
import { requireAdminUser } from '@/lib/db/auth';
import { getTodayCountedImageUsage, getZonedDayStartMs } from '@/lib/db/daily-limit';
import { getUnitPrice, getUnitPrices } from '@/lib/pricing';

export const runtime = 'nodejs';

/** 用户管理列表：账号信息 + 用量统计 + 会话数 */
export async function GET() {
  try {
    await requireAdminUser();
    await ensurePlaygroundSchema();

    const pool = await mysqlPool();
    const todayStart = getZonedDayStartMs('Asia/Shanghai');
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT u.id, u.email, u.display_name, u.status, u.is_admin, u.login_count,
              u.last_login_ip, u.last_login_ua, u.created_at, u.last_login_at,
              (SELECT COUNT(*) FROM playground_tasks t WHERE t.user_id = u.id) AS task_count,
              (SELECT COUNT(*) FROM playground_tasks t WHERE t.user_id = u.id AND t.status = 'done') AS done_count,
              (SELECT COUNT(*) FROM playground_tasks t WHERE t.user_id = u.id AND t.status = 'done' AND t.finished_at >= ?) AS done_today,
              (SELECT COUNT(*) FROM playground_image_owners o WHERE o.user_id = u.id) AS image_count,
              (SELECT COUNT(*) FROM playground_auth_sessions s WHERE s.user_id = u.id AND s.expires_at > NOW()) AS active_sessions
       FROM playground_users u
       ORDER BY u.is_admin DESC, u.created_at DESC`,
      [todayStart]
    );
    // 按用户统计完成任务花费（actual_params 在 Node 侧解析，规避旧版 MySQL 无 JSON 函数）
    const [resRows] = await pool.query<RowDataPacket[]>(
      `SELECT user_id, actual_params, finished_at FROM playground_tasks
       WHERE status = 'done' AND api_provider = 'custom-dragoncode-gpt-image-2'
         AND api_profile_snapshot LIKE '%dragoncode.codes%'`
    );
    const costByUser: Record<string, number> = {};
    const costTodayByUser: Record<string, number> = {};
    for (const row of resRows) {
      let resolution: string | null = null;
      try {
        const parsed = typeof row.actual_params === 'string' ? JSON.parse(row.actual_params) : row.actual_params;
        resolution = typeof parsed?.resolution === 'string' ? parsed.resolution : null;
      } catch {
        resolution = null;
      }
      const amount = getUnitPrice(resolution);
      costByUser[row.user_id] = (costByUser[row.user_id] ?? 0) + amount;
      if (Number(row.finished_at) >= todayStart) {
        costTodayByUser[row.user_id] = (costTodayByUser[row.user_id] ?? 0) + amount;
      }
    }

    // 今日用量按每人单独计算（时间窗为北京时间自然日）
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
        doneToday: Number(row.done_today) || 0,
        costTotal: Math.round((costByUser[row.id] ?? 0) * 100) / 100,
        costToday: Math.round((costTodayByUser[row.id] ?? 0) * 100) / 100,
      });
    }

    return NextResponse.json({ success: true, data: users, pricing: getUnitPrices() });
  } catch (error) {
    return handleApiError(error, '获取用户列表');
  }
}

