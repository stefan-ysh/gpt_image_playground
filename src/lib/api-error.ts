import { NextResponse } from 'next/server';

export type ApiResponse<T = unknown> = {
  success: boolean;
  data?: T;
  error?: string;
};

/**
 * 统一的 API 错误处理函数
 * UNAUTHENTICATED 错误返回 401
 * FORBIDDEN/PERMISSION_DENIED 返回 403
 * 其他错误返回 500
 */
export function handleApiError(error: unknown, context = 'API Error') {
  console.error(`[${context}]`, error);

  if (error instanceof Error) {
    // 处理特定的已知错误模式
    if (error.message === 'UNAUTHENTICATED') {
      return NextResponse.json(
        { success: false, error: '未登录' },
        { status: 401 }
      );
    }
    if (error.message === 'FORBIDDEN' || error.message === 'PERMISSION_DENIED') {
      return NextResponse.json(
        { success: false, error: '无权访问' },
        { status: 403 }
      );
    }
    if (error.message === 'NOT_FOUND') {
      return NextResponse.json(
        { success: false, error: '资源不存在' },
        { status: 404 }
      );
    }
    // 返回自定义错误消息
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json(
    { success: false, error: '服务器内部错误' },
    { status: 500 }
  );
}
