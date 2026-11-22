import { NextResponse } from 'next/server';
import { ensurePlaygroundSchema } from '@/lib/db/schema';
import { getCurrentUser } from '@/lib/db/auth';

export const runtime = 'nodejs';

export async function GET() {
  try {
    // 客户端第一个请求走这里：顺带触发 schema 初始化（含用户/会话表迁移）
    await ensurePlaygroundSchema();
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
    }
    return NextResponse.json({ success: true, data: user });
  } catch (error) {
    console.error('[Auth] 登录态校验失败:', error);
    return NextResponse.json(
      { success: false, error: '登录态校验失败，请检查服务端 MySQL 配置' },
      { status: 500 },
    );
  }
}
