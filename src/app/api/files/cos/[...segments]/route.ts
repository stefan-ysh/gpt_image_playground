import { NextResponse } from 'next/server';
import COS from 'cos-nodejs-sdk-v5';
import mime from 'mime';
import { requireCurrentUser } from '@/lib/db/auth';
import { env } from '@/lib/env';

export const runtime = 'nodejs';

// 302 跳转签名直链的有效期：足够浏览器立即发起下载，过期后重新鉴权换新链接
const SIGNED_URL_EXPIRES_SECONDS = 600;

function badRequestResponse(message: string) {
  return NextResponse.json({ success: false, error: message }, { status: 400 });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ segments: string[] }> }
) {
  try {
    await requireCurrentUser();
  } catch {
    return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
  }

  const config = env.server.cos;
  if (!config.secretId || !config.secretKey || !config.bucket || !config.region) {
    return badRequestResponse('COS 未配置');
  }

  const resolved = await params;
  const key = (resolved.segments ?? [])
    .map((segment) => decodeURIComponent(segment))
    .join('/')
    .replace(/^\/+/, '');

  if (!key) {
    return badRequestResponse('文件路径不能为空');
  }

  try {
    const cos = new COS({
      SecretId: config.secretId,
      SecretKey: config.secretKey,
    });

    // 内容寻址的 SHA-256 路径不可变：让 COS 直接下发一年期 immutable 缓存头，
    // 浏览器跨会话复用本地缓存，图片字节不再经过本机中转
    const query: Record<string, string> = {
      'response-cache-control': 'max-age=31536000, immutable',
      'response-content-type': mime.getType(key) || 'application/octet-stream',
    };
    const fileName = new URL(request.url).searchParams.get('filename')?.trim();
    if (fileName) {
      query['response-content-disposition'] =
        `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`;
    }

    const signedUrl = await new Promise<string>((resolve, reject) => {
      cos.getObjectUrl(
        {
          Bucket: config.bucket!,
          Region: config.region!,
          Key: key,
          Sign: true,
          Expires: SIGNED_URL_EXPIRES_SECONDS,
          Query: query,
        },
        (err, data) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(data.Url);
        }
      );
    });

    return NextResponse.redirect(signedUrl, {
      status: 302,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    console.error('生成 COS 签名直链失败:', error);
    return NextResponse.json({ success: false, error: '读取文件失败' }, { status: 404 });
  }
}
