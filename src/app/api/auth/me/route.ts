import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/db/auth';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
    }
    return NextResponse.json({ success: true, data: user });
  } catch (error) {
    console.error('[Auth] 登录态校验失败:', error);
    return NextResponse.json(
      { success: false, error: '登录态校验失败，请检查 MySQL、鉴权库和会话表配置' },
      { status: 500 },
    );
  }
}
