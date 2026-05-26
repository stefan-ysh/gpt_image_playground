import { requireCurrentUser } from '@/lib/db/auth';
import { mysqlPool, mysqlQuery } from '@/lib/db/mysql';
import { ensurePlaygroundSchema } from '@/lib/db/schema';
import { handleApiError } from '@/lib/api-error';
import { NextResponse } from 'next/server';
import { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const user = await requireCurrentUser();
    await ensurePlaygroundSchema();

    const searchParams = new URL(request.url).searchParams;
    const key = searchParams.get('key');
    if (!key) {
      return NextResponse.json({ success: false, error: '缺少 Key' }, { status: 400 });
    }

    const pool = await mysqlPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT value FROM playground_app_state WHERE id = ? AND user_id = ? LIMIT 1`,
      [key, user.id]
    );

    if (rows.length === 0) {
      return NextResponse.json({ success: true, data: null });
    }

    return NextResponse.json({ success: true, data: JSON.parse(rows[0].value) });
  } catch (error) {
    return handleApiError(error, '获取应用状态');
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireCurrentUser();
    await ensurePlaygroundSchema();

    const { key, value } = await request.json();
    if (!key) {
      return NextResponse.json({ success: false, error: '缺少 Key' }, { status: 400 });
    }

    await mysqlQuery`
      INSERT INTO playground_app_state (id, user_id, value)
      VALUES (${key}, ${user.id}, ${JSON.stringify(value)})
      ON DUPLICATE KEY UPDATE value = VALUES(value)
    `;

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, '保存应用状态');
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireCurrentUser();
    await ensurePlaygroundSchema();

    const searchParams = new URL(request.url).searchParams;
    const key = searchParams.get('key');
    if (!key) {
      return NextResponse.json({ success: false, error: '缺少 Key' }, { status: 400 });
    }

    const pool = await mysqlPool();
    await pool.query(
      `DELETE FROM playground_app_state WHERE id = ? AND user_id = ?`,
      [key, user.id]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, '删除应用状态');
  }
}
