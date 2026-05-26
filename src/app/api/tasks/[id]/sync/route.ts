import { NextResponse } from 'next/server'
import { RowDataPacket } from 'mysql2'
import { requireCurrentUser } from '@/lib/db/auth'
import { mysqlPool } from '@/lib/db/mysql'
import { ensurePlaygroundSchema } from '@/lib/db/schema'
import { handleApiError } from '@/lib/api-error'

export const runtime = 'nodejs'

const SYNCABLE_STATUSES = new Set([
    'created',
    'queued',
    'submitting',
    'submitted',
    'polling',
    'polling_retryable',
    'succeeded_raw',
    'storing_images',
    'transfer_pending',
    'submit_unknown',
])

export async function POST(
    _request: Request,
    context: { params: Promise<{ id: string }> } | { params: { id: string } },
) {
    try {
        const user = await requireCurrentUser()
        await ensurePlaygroundSchema()

        const params = await Promise.resolve(context.params)
        const taskId = params.id

        const pool = await mysqlPool()

        const [rows] = await pool.query<RowDataPacket[]>(
            `
      SELECT id, status
      FROM playground_tasks
      WHERE id = ?
        AND user_id = ?
      LIMIT 1
      `,
            [taskId, user.id],
        )

        if (rows.length === 0) {
            return NextResponse.json(
                {
                    success: false,
                    error: '任务不存在',
                },
                { status: 404 },
            )
        }

        const status = String(rows[0].status)

        if (!SYNCABLE_STATUSES.has(status)) {
            return NextResponse.json({
                success: true,
                data: {
                    id: taskId,
                    status,
                    synced: false,
                    message: '当前任务状态无需同步',
                },
            })
        }

        await pool.query(
            `
      UPDATE playground_tasks
      SET
        manual_sync_attempts = COALESCE(manual_sync_attempts, 0) + 1,
        next_poll_at = 0,
        locked_until = NULL,
        worker_id = NULL
      WHERE id = ?
        AND user_id = ?
      `,
            [taskId, user.id],
        )

        return NextResponse.json({
            success: true,
            data: {
                id: taskId,
                status,
                synced: true,
            },
        })
    } catch (error) {
        return handleApiError(error, '同步任务')
    }
}