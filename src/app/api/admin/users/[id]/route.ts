import { NextResponse } from 'next/server';
import { ResultSetHeader, RowDataPacket } from 'mysql2';
import { mysqlPool } from '@/lib/db/mysql';
import { ensurePlaygroundSchema } from '@/lib/db/schema';
import { handleApiError } from '@/lib/api-error';
import { requireAdminUser } from '@/lib/db/auth';

export const runtime = 'nodejs';

const VALID_STATUS = ['active', 'disabled'];

/** 更新用户状态（启用/禁用）；超级管理员不能禁用自己 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> } | { params: { id: string } },
) {
  try {
    const admin = await requireAdminUser();
    await ensurePlaygroundSchema();

    const params = await Promise.resolve(context.params);
    const targetId = params.id;
    const body = await request.json().catch(() => null);
    const status = typeof body?.status === 'string' ? body.status : '';
    // dailyLimit: null = 恢复全局默认（SET daily_limit = NULL）；数字 = 用户专属限额
    const hasDailyLimitField = body && 'dailyLimit' in body;
    let dailyLimitValue: number | null = null;
    if (hasDailyLimitField && body.dailyLimit !== null) {
      const parsed = Number(body.dailyLimit);
      if (!Number.isFinite(parsed) || parsed < 0) {
        return NextResponse.json({ success: false, error: '无效的限额数值' }, { status: 400 });
      }
      dailyLimitValue = Math.max(0, Math.trunc(parsed));
    }

    const updates: string[] = [];
    const values: unknown[] = [];

    if (status) {
      if (!VALID_STATUS.includes(status)) {
        return NextResponse.json({ success: false, error: '无效的用户状态' }, { status: 400 });
      }
      if (targetId === admin.id && status === 'disabled') {
        return NextResponse.json({ success: false, error: '不能禁用自己的账号' }, { status: 400 });
      }
      updates.push('status = ?');
      values.push(status);
    }

    if (hasDailyLimitField) {
      updates.push('daily_limit = ?');
      values.push(dailyLimitValue);
    }

    if (updates.length === 0) {
      return NextResponse.json({ success: false, error: '没有需要更新的内容' }, { status: 400 });
    }

    const pool = await mysqlPool();
    values.push(targetId);
    const [result] = await pool.query<ResultSetHeader>(
      `UPDATE playground_users SET ${updates.join(', ')} WHERE id = ?`,
      values
    );
    if (result.affectedRows === 0) {
      return NextResponse.json({ success: false, error: '用户不存在' }, { status: 404 });
    }
    // 禁用即踢下线：清空该用户全部本地会话
    if (status === 'disabled') {
      await pool.query('DELETE FROM playground_auth_sessions WHERE user_id = ?', [targetId]);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, '更新用户状态');
  }
}

/** 删除用户：外键级联清除其任务/图片归属（高危操作，UI 需二次确认） */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> } | { params: { id: string } },
) {
  try {
    const admin = await requireAdminUser();
    await ensurePlaygroundSchema();

    const params = await Promise.resolve(context.params);
    const targetId = params.id;
    if (targetId === admin.id) {
      return NextResponse.json({ success: false, error: '不能删除自己的账号' }, { status: 400 });
    }

    const pool = await mysqlPool();
    const [result] = await pool.query<ResultSetHeader>(
      'DELETE FROM playground_users WHERE id = ? AND id <> ?',
      [targetId, admin.id]
    );
    if (result.affectedRows === 0) {
      return NextResponse.json({ success: false, error: '用户不存在' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, '删除用户');
  }
}
