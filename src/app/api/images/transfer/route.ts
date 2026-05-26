import { NextResponse } from 'next/server';
import { requireCurrentUser } from '@/lib/db/auth';
import { mysqlPool } from '@/lib/db/mysql';
import { ensurePlaygroundSchema } from '@/lib/db/schema';
import { handleApiError } from '@/lib/api-error';
import {
  getPendingTransfersForRetry,
  attemptImageTransfer,
  updateTransferStatus,
  replaceTemporaryUrlsInTask,
  cleanupExpiredTransfers,
} from '@/lib/db/imageTransferQueue';
import { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * 后台轮询 API - 处理待转存的图片
 * POST /api/images/transfer
 */
export async function POST(request: Request) {
  try {
    const token = request.headers.get('x-transfer-token');
    const expectedToken = process.env.IMAGE_TRANSFER_TOKEN;
    if (expectedToken && token === expectedToken) {
      // Cron/worker trigger authenticated by token.
    } else if (expectedToken && token) {
      return NextResponse.json({ success: false, error: 'Invalid token' }, { status: 401 });
    } else {
      await requireCurrentUser();
    }

    await ensurePlaygroundSchema();

    // 获取待转存的任务
    const pendingTransfers = await getPendingTransfersForRetry();
    
    if (pendingTransfers.length === 0) {
      return NextResponse.json({
        success: true,
        processed: 0,
        transferred: 0,
        failed: 0,
      });
    }

    let transferred = 0;
    let failed = 0;
    const urlToIdMappingByTask: Record<string, Record<string, string>> = {};

    // 批处理转存
    for (const transfer of pendingTransfers) {
      try {
        const result = await attemptImageTransfer(transfer);

        if (result.success && result.transferredImageId) {
          // 记录成功的转存
          await updateTransferStatus(transfer.id, 'transferred', result.transferredImageId);
          
          if (!urlToIdMappingByTask[transfer.taskId]) {
            urlToIdMappingByTask[transfer.taskId] = {};
          }
          urlToIdMappingByTask[transfer.taskId][transfer.tempUrl] = result.transferredImageId;
          
          transferred++;
        } else {
          // 记录失败，等待下次重试
          await updateTransferStatus(transfer.id, 'failed', undefined, result.error);
          failed++;
        }
      } catch (err) {
        console.error(`Failed to transfer image ${transfer.id}:`, err);
        await updateTransferStatus(
          transfer.id,
          'failed',
          undefined,
          err instanceof Error ? err.message : String(err)
        );
        failed++;
      }
    }

    // 替换任务中的临时 URL
    for (const [taskId, mapping] of Object.entries(urlToIdMappingByTask)) {
      await replaceTemporaryUrlsInTask(taskId, mapping);
    }

    // 清理过期的转存记录
    await cleanupExpiredTransfers();

    return NextResponse.json({
      success: true,
      processed: pendingTransfers.length,
      transferred,
      failed,
    });
  } catch (error) {
    return handleApiError(error, '处理图片转存队列');
  }
}

/**
 * GET /api/images/transfer
 * 获取转存统计信息
 */
export async function GET(request: Request) {
  try {
    await requireCurrentUser();
    await ensurePlaygroundSchema();

    const pool = await mysqlPool();
    const [stats] = await pool.query<RowDataPacket[]>(
      `SELECT 
        transfer_status,
        COUNT(*) as count
       FROM playground_pending_image_transfers
       WHERE transfer_status IN ('pending', 'transferred', 'failed')
       GROUP BY transfer_status`
    );

    const result = {
      pending: 0,
      transferred: 0,
      failed: 0,
    };

    for (const row of stats) {
      result[row.transfer_status as keyof typeof result] = row.count;
    }

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    return handleApiError(error, '获取转存统计');
  }
}
