import { NextResponse } from 'next/server';
import { RowDataPacket } from 'mysql2';
import { mysqlPool } from '@/lib/db/mysql';
import { ensurePlaygroundSchema } from '@/lib/db/schema';
import { handleApiError } from '@/lib/api-error';
import { requireAdminUser } from '@/lib/db/auth';

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
