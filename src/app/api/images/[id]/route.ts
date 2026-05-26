import { NextResponse } from 'next/server';
import { requireCurrentUser } from '@/lib/db/auth';
import { mysqlPool } from '@/lib/db/mysql';
import { ensurePlaygroundSchema } from '@/lib/db/schema';
import { handleApiError } from '@/lib/api-error';
import { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireCurrentUser();
    await ensurePlaygroundSchema();

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ success: false, error: '缺少 ID' }, { status: 400 });
    }

    const pool = await mysqlPool();
    // console.log('[API Debug] Querying playground_images for id:', id);
    const [images] = await pool.query<RowDataPacket[]>(
      `SELECT i.data_url, i.source, i.created_at, i.width, i.height
       FROM playground_images i
       INNER JOIN playground_image_owners o ON o.image_id = i.id AND o.user_id = ?
       WHERE i.id = ? LIMIT 1`,
      [user.id, id]
    );
    // console.log('[API Debug] Result length:', images.length, 'data:', images);

    if (images.length === 0) {
      return NextResponse.json({ success: false, error: '图片未找到' }, { status: 404 });
    }

    const img = images[0];

    const [thumbnails] = await pool.query<RowDataPacket[]>(
      `SELECT thumbnail_data_url, width, height, thumbnail_version FROM playground_thumbnails WHERE id = ? LIMIT 1`,
      [id]
    );

    const thumb = thumbnails[0];

    return NextResponse.json({
      success: true,
      data: {
        id,
        dataUrl: img.data_url,
        createdAt: img.created_at,
        source: img.source,
        width: img.width || thumb?.width,
        height: img.height || thumb?.height,
        thumbnailDataUrl: thumb?.thumbnail_data_url || img.data_url,
        thumbnailVersion: thumb?.thumbnail_version || 2,
      }
    });
  } catch (error) {
    return handleApiError(error, '获取图片');
  }
}
