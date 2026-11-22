import { NextResponse } from 'next/server';
import { RowDataPacket } from 'mysql2';
import { mysqlPool } from '@/lib/db/mysql';
import { ensurePlaygroundSchema } from '@/lib/db/schema';
import { handleApiError } from '@/lib/api-error';
import { requireAdminUser } from '@/lib/db/auth';
import { getUnitPrice, getUnitPrices } from '@/lib/pricing';

export const runtime = 'nodejs';

/** 管理端总览统计 */
export async function GET() {
  try {
    await requireAdminUser();
    await ensurePlaygroundSchema();

    const pool = await mysqlPool();
    const todayStart = getShanghaiDayStartMs();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT
         (SELECT COUNT(*) FROM playground_users) AS users_total,
         (SELECT COUNT(*) FROM playground_users WHERE status = 'active') AS users_active,
         (SELECT COUNT(*) FROM playground_tasks) AS tasks_total,
         (SELECT COUNT(*) FROM playground_tasks WHERE status = 'done') AS tasks_done,
         (SELECT COUNT(*) FROM playground_tasks WHERE status NOT IN ('done', 'provider_failed', 'cancelled', 'submit_unknown')) AS tasks_in_flight,
         (SELECT COUNT(*) FROM playground_tasks WHERE status = 'done' AND finished_at >= ?) AS done_today,
         (SELECT COUNT(*) FROM playground_images) AS images_total,
         (SELECT COUNT(*) FROM playground_pending_image_transfers WHERE transfer_status = 'pending') AS transfers_pending
       `,
      [todayStart]
    );
    const r = rows[0] ?? {};

    // 花费估算：按文档规则（完成任务按 resolution 档位计费、每任务 1 张）本地推算
    // 注：部分宝塔 MySQL 版本无 JSON 函数，取 actual_params 在 Node 侧解析
    const [resRows] = await pool.query<RowDataPacket[]>(
      `SELECT actual_params, finished_at FROM playground_tasks WHERE status = 'done'`
    );
    let costTotal = 0;
    let costToday = 0;
    for (const row of resRows) {
      let resolution: string | null = null;
      try {
        const parsed = typeof row.actual_params === 'string' ? JSON.parse(row.actual_params) : row.actual_params;
        resolution = typeof parsed?.resolution === 'string' ? parsed.resolution : null;
      } catch {
        resolution = null;
      }
      const amount = getUnitPrice(resolution);
      costTotal += amount;
      const finishedAt = Number(row.finished_at);
      if (finishedAt >= todayStart) costToday += amount;
    }

    return NextResponse.json({
      success: true,
      data: {
        usersTotal: Number(r.users_total) || 0,
        usersActive: Number(r.users_active) || 0,
        tasksTotal: Number(r.tasks_total) || 0,
        tasksDone: Number(r.tasks_done) || 0,
        tasksInFlight: Number(r.tasks_in_flight) || 0,
        doneToday: Number(r.done_today) || 0,
        imagesTotal: Number(r.images_total) || 0,
        transfersPending: Number(r.transfers_pending) || 0,
        costTotal: Math.round(costTotal * 100) / 100,
        costToday: Math.round(costToday * 100) / 100,
        pricing: getUnitPrices(),
      },
    });
  } catch (error) {
    return handleApiError(error, '获取统计数据');
  }
}

function getShanghaiDayStartMs(): number {
  const now = new Date();
  const shanghai = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  shanghai.setHours(0, 0, 0, 0);
  const offsetMs = shanghai.getTime() - new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' })).getTime();
  return shanghai.getTime() - offsetMs;
}
