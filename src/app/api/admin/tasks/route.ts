import { NextResponse } from 'next/server';
import { RowDataPacket } from 'mysql2';
import { mysqlPool } from '@/lib/db/mysql';
import { ensurePlaygroundSchema } from '@/lib/db/schema';
import { handleApiError } from '@/lib/api-error';
import { requireAdminUser } from '@/lib/db/auth';
import { getUnitPrice, parseBilledResolution, BILLABLE_PROVIDERS } from '@/lib/pricing';

export const runtime = 'nodejs';

/** 任务状态筛选分组 */
const STATUS_FILTERS: Record<string, string> = {
  done: `t.status = 'done'`,
  failed: `t.status = 'provider_failed'`,
  submit_unknown: `t.status = 'submit_unknown'`,
  in_flight: `t.status IN ('running','created','queued','submitting','submitted','polling','polling_retryable','succeeded_raw','storing_images','transfer_pending')`,
};

/** 全局任务审计列表（所有用户，含已软删任务，用于对账与运维） */
export async function GET(request: Request) {
  try {
    await requireAdminUser();
    await ensurePlaygroundSchema();

    const searchParams = new URL(request.url).searchParams;
    const page = Math.max(1, Number(searchParams.get('page')) || 1);
    const limit = Math.max(1, Math.min(100, Number(searchParams.get('limit')) || 50));
    const offset = (page - 1) * limit;
    const statusFilter = searchParams.get('status') || 'all';
    const userId = searchParams.get('userId') || '';
    const q = searchParams.get('q')?.trim() || '';

    const conditions: string[] = [];
    const values: unknown[] = [];

    if (STATUS_FILTERS[statusFilter]) {
      conditions.push(STATUS_FILTERS[statusFilter]);
    }
    if (userId) {
      conditions.push('t.user_id = ?');
      values.push(userId);
    }
    if (q) {
      conditions.push('CONVERT(t.prompt USING utf8mb4) LIKE ?');
      values.push(`%${q}%`);
    }
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const pool = await mysqlPool();

    const [countRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM playground_tasks t ${whereClause}`,
      values
    );
    const total = Number(countRows[0]?.total) || 0;

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT t.id, t.prompt, t.status, t.api_provider, t.api_model, t.user_id,
              t.actual_params, t.params, t.error, t.created_at, t.finished_at,
              t.deleted_at, u.email, u.display_name
       FROM playground_tasks t
       JOIN playground_users u ON u.id = t.user_id
       ${whereClause}
       ORDER BY t.created_at DESC
       LIMIT ? OFFSET ?`,
      [...values, limit, offset]
    );

    let stuckCount = 0;
    if (statusFilter === 'submit_unknown') {
      stuckCount = total;
    } else {
      const [stuckRows] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM playground_tasks WHERE status = 'submit_unknown' AND deleted_at IS NULL`
      );
      stuckCount = Number(stuckRows[0]?.n) || 0;
    }

    const tasks = rows.map((row) => {
      let size: string | null = null;
      let resolution: string | null = null;
      try {
        const actual = typeof row.actual_params === 'string' ? JSON.parse(row.actual_params) : null;
        size = typeof actual?.size === 'string' ? actual.size : null;
        resolution = actual?.resolution ?? null;
      } catch {
        // 旧任务 actual_params 可能缺字段
      }
      const billable = row.status === 'done' && BILLABLE_PROVIDERS.includes(row.api_provider);
      return {
        id: row.id,
        prompt: typeof row.prompt === 'string' ? row.prompt.slice(0, 120) : '',
        status: row.status,
        provider: row.api_provider,
        email: row.email,
        displayName: row.display_name,
        userId: row.user_id,
        size,
        resolution,
        cost: billable ? getUnitPrice(parseBilledResolution(row.actual_params)) : 0,
        createdAt: row.created_at,
        finishedAt: row.finished_at,
        deletedAt: row.deleted_at ?? null,
        error: typeof row.error === 'string' && row.error ? row.error.slice(0, 150) : null,
      };
    });

    return NextResponse.json({
      success: true,
      data: tasks,
      stuckCount,
      pagination: { page, limit, total, hasMore: offset + tasks.length < total },
    });
  } catch (error) {
    return handleApiError(error, '获取任务审计列表');
  }
}
