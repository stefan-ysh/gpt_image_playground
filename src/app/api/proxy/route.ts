import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

async function handleProxy(request: Request, method: string): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const requestedTarget = searchParams.get('target')?.trim();
  const configuredProxyTarget = process.env.API_PROXY_URL?.trim();
  const proxyEnabled = process.env.ENABLE_API_PROXY === 'true';
  const target = proxyEnabled && configuredProxyTarget ? configuredProxyTarget : requestedTarget;
  const path = searchParams.get('path')?.trim();

  if (!target || !path) {
    return NextResponse.json({ success: false, error: '缺少 target 或 path 代理转发参数' }, { status: 400 });
  }

  const targetUrl = target.replace(/\/+$/, '');
  const normalizedSubPath = path.replace(/^\/+/, '');

  let finalUrl = '';
  if (targetUrl.endsWith('/v1') && normalizedSubPath.startsWith('media/')) {
    finalUrl = `${targetUrl.slice(0, -3)}/${normalizedSubPath}`;
  } else if (targetUrl.endsWith('/v1') && normalizedSubPath.startsWith('v1/')) {
    finalUrl = `${targetUrl}/${normalizedSubPath.slice(3)}`;
  } else {
    finalUrl = `${targetUrl}/${normalizedSubPath}`;
  }

  // 拼接原请求除了 target 和 path 之外的其它 query params
  const additionalParams = new URLSearchParams();
  searchParams.forEach((value, key) => {
    if (key !== 'target' && key !== 'path') {
      additionalParams.set(key, value);
    }
  });
  if (additionalParams.toString()) {
    finalUrl += `${finalUrl.includes('?') ? '&' : '?'}${additionalParams.toString()}`;
  }

  try {
    const headers = new Headers();
    request.headers.forEach((value, key) => {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey !== 'host' &&
        lowerKey !== 'connection' &&
        lowerKey !== 'content-length'
      ) {
        headers.set(key, value);
      }
    });

    const body = method !== 'GET' && method !== 'HEAD'
      ? Buffer.from(await request.arrayBuffer())
      : undefined;

    console.log(`[Proxy] 正在发起中转代理请求: [${method}] ${finalUrl}`);
    const remoteResponse = await fetch(finalUrl, {
      method,
      headers,
      body,
      redirect: 'follow',
    });

    const responseHeaders = new Headers();
    remoteResponse.headers.forEach((value, key) => {
      if (key.toLowerCase() !== 'access-control-allow-origin') {
        responseHeaders.set(key, value);
      }
    });

    responseHeaders.set('Access-Control-Allow-Origin', '*');

    return new Response(remoteResponse.body, {
      status: remoteResponse.status,
      headers: responseHeaders,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Proxy] 中转代理请求异常! 目标 URL: ${finalUrl}, 错误原因:`, error);
    return NextResponse.json(
      { success: false, error: `中转代理请求失败: ${message} (目标: ${finalUrl})` },
      { status: 502 }
    );
  }
}

export async function GET(request: Request) {
  return handleProxy(request, 'GET');
}

export async function POST(request: Request) {
  return handleProxy(request, 'POST');
}

export async function PUT(request: Request) {
  return handleProxy(request, 'PUT');
}

export async function DELETE(request: Request) {
  return handleProxy(request, 'DELETE');
}

export async function PATCH(request: Request) {
  return handleProxy(request, 'PATCH');
}

export async function OPTIONS() {
  const headers = new Headers({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,PATCH,OPTIONS',
    'Access-Control-Allow-Headers': '*',
  });
  return new Response(null, { status: 204, headers });
}
