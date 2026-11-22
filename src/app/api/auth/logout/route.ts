import { NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api-error';
import { destroyLocalSession } from '@/lib/db/auth';

export const runtime = 'nodejs';

export async function POST() {
  try {
    await destroyLocalSession();
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, '退出登录');
  }
}
