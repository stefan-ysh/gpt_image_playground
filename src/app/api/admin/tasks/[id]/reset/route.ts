import { NextResponse } from 'next/server';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { mysqlPool } from '@/lib/db/mysql';
import { ensurePlaygroundSchema } from '@/lib/db/schema';
import { handleApiError } from '@/lib/api-error';
import { requireAdminUser } from '@/lib/db/auth';

export const runtime = 'nodejs';

/**
 * 重置卡死任务（仅 submit_unknown）：清空提交状态让 worker 重新提交。
 * ⚠️ 若原提交实际已在服务商侧创建任务，重提会重复扣费——调用方需先人工确认。
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> } | { params: { id: string } },
) {
  try {
    await requireAdminUser();
    await ensurePlaygroundSchema();

    const params = await Promise.resolve(context.params);
    const taskId = params.id;

    const pool = await mysqlPool();
    const [existing] = await pool.query<RowDataPacket[]>(
      'SELECT status FROM playground_tasks WHERE id = ? LIMIT 1',
      [taskId]
    );
    if (existing.length === 0) {
      return NextResponse.json({ success: false, error: '任务不存在' }, { status: 404 });
    }
    if (existing[0].status !== 'submit_unknown') {
      return NextResponse.json(
        { success: false, error: '仅提交状态未知（submit_unknown）的任务可以重置' },
        { status: 400 }
      );
    }

    const [result] = await pool.query<ResultSetHeader>(
      `UPDATE playground_tasks
       SET status = 'created',
           provider_status = NULL,
           submit_status = NULL,
           last_provider_error = NULL,
           last_provider_payload = NULL,
           locked_until = NULL,
           next_poll_at = NULL,
           worker_id = NULL,
           idempotency_key = NULL,
           provider_task_id = NULL
       WHERE id = ?`
    );

    return NextResponse.json({ success: true, data: { reset: result.affectedRows > 0 } });
  } catch (error) {
    return handleApiError(error, '重置卡死任务');
  }
}
