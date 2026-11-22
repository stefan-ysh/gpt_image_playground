import { NextResponse } from 'next/server';
import { RowDataPacket } from 'mysql2';
import { mysqlPool } from '@/lib/db/mysql';
import { ensurePlaygroundSchema } from '@/lib/db/schema';
import { handleApiError } from '@/lib/api-error';
import { requireAdminUser } from '@/lib/db/auth';
import { getUnitPrice } from '@/lib/pricing';

export const runtime = 'nodejs';

/** 计费渠道：DragonCode 家族（含早期 gpt-image-2 内置渠道，均按 DragonCode 账单结算） */
const BILLABLE_PROVIDERS = ['custom-dragoncode-gpt-image-2', 'gpt-image-2'];

/** COS 绝对地址 → 应用代理路径（浏览器带管理员会话经 302 取图） */
function normalizeCosProxyUrl(url: string | null | undefined): string | null {
  if (typeof url !== 'string') return null;
  const match = url.match(/(uploads\/.+)$/);
  return match ? `/api/files/cos/${match[1]}` : url.startsWith('/') ? url : null;
}

function parseResolution(raw: unknown): string {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const resolution = parsed?.resolution;
    // 早期任务没有 resolution 字段，实际按默认 1k 档计费
    return resolution === '1k' || resolution === '2k' || resolution === '4k' ? resolution : '1k';
  } catch {
    return '1k';
  }
}

/** 查看某用户的关联任务及其详情 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> } | { params: { id: string } },
) {
  try {
    await requireAdminUser();
    await ensurePlaygroundSchema();

    const params = await Promise.resolve(context.params);
    const targetId = params.id;

    const pool = await mysqlPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, prompt, status, api_provider, api_model, params, actual_params,
              output_images, input_image_ids, error, created_at, finished_at, cost
       FROM playground_tasks
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 200`,
      [targetId]
    );

    const [imageRows] = await pool.query<RowDataPacket[]>(
      'SELECT id, data_url FROM playground_images'
    );
    const imageUrls = new Map<string, string>();
    for (const row of imageRows) {
      const proxy = normalizeCosProxyUrl(row.data_url);
      if (proxy) imageUrls.set(row.id, proxy);
    }

    const tasks = rows.map((row) => {
      let size: string | null = null;
      let resolution: string | null = null;
      try {
        const actual = typeof row.actual_params === 'string' ? JSON.parse(row.actual_params) : null;
        size = typeof actual?.size === 'string' ? actual.size : null;
        resolution = actual?.resolution ?? null;
      } catch {
        // 旧任务 actual_params 缺字段，按默认档计费
      }
      const outputIds = typeof row.output_images === 'string' && row.output_images.trim()
        ? (JSON.parse(row.output_images) as string[])
        : [];
      const billable = BILLABLE_PROVIDERS.includes(row.api_provider) && row.status === 'done';
      const taskResolution = billable ? parseResolution(row.actual_params) : null;
      const images = outputIds.map((id) => ({
        id,
        url: imageUrls.get(id) ?? `/api/images/${id}`,
      }));
      return {
        id: row.id,
        prompt: typeof row.prompt === 'string' ? row.prompt.slice(0, 200) : '',
        status: row.status,
        provider: row.api_provider,
        model: row.api_model,
        size,
        resolution,
        createdAt: row.created_at,
        finishedAt: row.finished_at,
        error: typeof row.error === 'string' && row.error ? row.error.slice(0, 300) : null,
        cost: billable ? getUnitPrice(taskResolution) : 0,
        billed: billable,
        billedResolution: taskResolution,
        images,
      };
    });

    return NextResponse.json({ success: true, data: tasks });
  } catch (error) {
    return handleApiError(error, '获取用户任务');
  }
}
