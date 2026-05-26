import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { TaskRecord } from '@/types';
import type { CurrentUser } from './auth';

const DEFAULT_DAILY_IMAGE_LIMIT = 60;
const DAILY_LIMIT_TIMEZONE = 'Asia/Shanghai';

type Queryable = Pool | PoolConnection;

export class DailyImageLimitError extends Error {
  readonly status = 429;
  readonly code = 'DAILY_IMAGE_LIMIT_EXCEEDED';

  constructor(message: string) {
    super(message);
    this.name = 'DailyImageLimitError';
  }
}

export function isDailyImageLimitError(error: unknown): error is DailyImageLimitError {
  return error instanceof DailyImageLimitError || (
    Boolean(error) &&
    typeof error === 'object' &&
    (error as { code?: unknown }).code === 'DAILY_IMAGE_LIMIT_EXCEEDED'
  );
}

function getDailyImageLimit() {
  const parsed = Number(process.env.PLAYGROUND_DAILY_IMAGE_LIMIT ?? DEFAULT_DAILY_IMAGE_LIMIT);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_DAILY_IMAGE_LIMIT;
  return Math.trunc(parsed);
}

function getTimeZoneOffsetMs(timezone: string, date: Date): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );
  return asUtc - date.getTime();
}

function getZonedDayStartMs(timezone: string, date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const localMidnightAsUtc = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day));
  const firstPass = localMidnightAsUtc - getTimeZoneOffsetMs(timezone, new Date(localMidnightAsUtc));
  const secondPass = localMidnightAsUtc - getTimeZoneOffsetMs(timezone, new Date(firstPass));
  return secondPass;
}

function getTodayRangeMs() {
  const start = getZonedDayStartMs(DAILY_LIMIT_TIMEZONE);
  const nextDayAnchor = new Date(start + 36 * 60 * 60 * 1000);
  return {
    start,
    end: getZonedDayStartMs(DAILY_LIMIT_TIMEZONE, nextDayAnchor),
  };
}

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function parseOutputImageCount(value: unknown): number {
  if (!value || typeof value !== 'string') return 0;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string' && item).length : 0;
  } catch {
    return 0;
  }
}

function parseRequestedImageCount(value: unknown): number {
  const params = parseJsonRecord(value);
  const parsed = Number(params?.n);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.max(1, Math.trunc(parsed));
}

function getRequestedImageCount(task: TaskRecord): number {
  const parsed = Number(task.params?.n);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.max(1, Math.trunc(parsed));
}

export async function getTodayCountedImageUsage(pool: Queryable, userId: string): Promise<number> {
  const { start, end } = getTodayRangeMs();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT status, output_images, params
     FROM playground_tasks
     WHERE user_id = ?
       AND (
         (status = 'done' AND finished_at >= ? AND finished_at < ?)
         OR
         (status = 'running' AND created_at >= ? AND created_at < ?)
       )`,
    [userId, start, end, start, end],
  );
  return rows.reduce((sum, row) => {
    if (row.status === 'running') return sum + parseRequestedImageCount(row.params);
    return sum + parseOutputImageCount(row.output_images);
  }, 0);
}

export async function assertDailyImageLimit(pool: Queryable, user: CurrentUser, task: TaskRecord) {
  const limit = getDailyImageLimit();
  const used = await getTodayCountedImageUsage(pool, user.id);
  const requested = getRequestedImageCount(task);

  if (used >= limit) {
    throw new DailyImageLimitError(`今日生成额度已用完（已完成/进行中 ${used}/${limit} 张），明天再来吧。`);
  }

  if (used + requested > limit) {
    throw new DailyImageLimitError(`今日还可提交 ${Math.max(0, limit - used)} 张（含进行中任务），请把本次生成数量调低后再试。`);
  }
}
