import { NextResponse } from 'next/server';
import { requireCurrentUser } from '@/lib/db/auth';
import { ensurePlaygroundSchema } from '@/lib/db/schema';
import { handleApiError } from '@/lib/api-error';
import { enqueuePendingImageTransfer, cleanupPendingTransfersForTask } from '@/lib/db/imageTransferQueue';
import { mysqlPool } from '@/lib/db/mysql';
import { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';

interface EnqueueRequest {
  taskId: string;
  tempUrls: string[];
}

interface CleanupRequest {
  taskId: string;
}

/**
 * POST /api/images/enqueue-transfer
 * 将临时图片 URL 添加到转存队列
 */
export async function POST(request: Request) {
  try {
    const user = await requireCurrentUser();
    await ensurePlaygroundSchema();

    const { taskId, tempUrls } = (await request.json()) as EnqueueRequest;

    if (!taskId || !Array.isArray(tempUrls) || tempUrls.length === 0) {
      return NextResponse.json(
        { success: false, error: '缺少必要参数' },
        { status: 400 }
      );
    }

    // 验证任务属于当前用户
    const pool = await mysqlPool();
    const [tasks] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM playground_tasks WHERE id = ? AND user_id = ?`,
      [taskId, user.id]
    );

    if (tasks.length === 0) {
      return NextResponse.json(
        { success: false, error: '任务不存在或无权限' },
        { status: 403 }
      );
    }

    // 将临时 URL 加入队列
    const transferIds: string[] = [];
    for (let i = 0; i < tempUrls.length; i++) {
      const transferId = await enqueuePendingImageTransfer(taskId, user.id, tempUrls[i], i);
      transferIds.push(transferId);
    }

    return NextResponse.json({
      success: true,
      data: {
        taskId,
        enqueuedCount: transferIds.length,
        transferIds,
      },
    });
  } catch (error) {
    return handleApiError(error, '加入转存队列');
  }
}

/**
 * DELETE /api/images/enqueue-transfer?taskId=...
 * 删除任务的待转存记录（任务删除时调用）
 */
export async function DELETE(request: Request) {
  try {
    const user = await requireCurrentUser();
    await ensurePlaygroundSchema();

    const url = new URL(request.url);
    const taskId = url.searchParams.get('taskId');

    if (!taskId) {
      return NextResponse.json(
        { success: false, error: '缺少 taskId 参数' },
        { status: 400 }
      );
    }

    // 验证任务属于当前用户
    const pool = await mysqlPool();
    const [tasks] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM playground_tasks WHERE id = ? AND user_id = ?`,
      [taskId, user.id]
    );

    if (tasks.length === 0) {
      return NextResponse.json(
        { success: false, error: '任务不存在或无权限' },
        { status: 403 }
      );
    }

    // 清理待转存记录
    const { cleanupPendingTransfersForTask } = await import('@/lib/db/imageTransferQueue');
    await cleanupPendingTransfersForTask(taskId);

    return NextResponse.json({
      success: true,
      data: { taskId },
    });
  } catch (error) {
    return handleApiError(error, '清理转存队列');
  }
}
