import { requireCurrentUser } from '@/lib/db/auth';
import { mysqlPool } from '@/lib/db/mysql';
import { ensurePlaygroundSchema } from '@/lib/db/schema';
import { handleApiError } from '@/lib/api-error';
import { NextResponse } from 'next/server';
import { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';

/** 获取当前用户的所有分组列表 */
export async function GET() {
  try {
    const user = await requireCurrentUser();
    await ensurePlaygroundSchema();

    const pool = await mysqlPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM playground_groups WHERE user_id = ? ORDER BY created_at ASC`,
      [user.id]
    );

    const groups = rows.map((r) => ({
      id: r.id,
      name: r.name,
      createdAt: Number(r.created_at),
    }));

    return NextResponse.json({ success: true, data: groups });
  } catch (error) {
    return handleApiError(error, '获取分组列表');
  }
}

/** 创建或重命名分组 */
export async function POST(request: Request) {
  try {
    const user = await requireCurrentUser();
    await ensurePlaygroundSchema();

    const { id, name, createdAt } = await request.json();
    if (!id || !name) {
      return NextResponse.json({ success: false, error: '无效的分组数据' }, { status: 400 });
    }

    const pool = await mysqlPool();
    await pool.query(
      `INSERT INTO playground_groups (id, user_id, name, created_at)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name)`,
      [id, user.id, name, createdAt || Date.now()]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, '保存分组');
  }
}

/** 删除指定分组并清空所有关联任务的 group_id 绑定 */
export async function DELETE(request: Request) {
  try {
    const user = await requireCurrentUser();
    await ensurePlaygroundSchema();

    const searchParams = new URL(request.url).searchParams;
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ success: false, error: '缺少分组 ID' }, { status: 400 });
    }

    const pool = await mysqlPool();
    
    // 1. 将关联此分组的任务的 group_id 置为 NULL，解除关联
    await pool.query(
      `UPDATE playground_tasks SET group_id = NULL WHERE group_id = ? AND user_id = ?`,
      [id, user.id]
    );
    
    // 2. 从 playground_groups 表中物理删除该分组
    await pool.query(
      `DELETE FROM playground_groups WHERE id = ? AND user_id = ?`,
      [id, user.id]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, '删除分组');
  }
}
