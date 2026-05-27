import 'dotenv/config'

export const config = {
  workerId:
    process.env.WORKER_ID ||
    `worker-${Math.random().toString(36).slice(2, 8)}`,

  concurrency: Number(process.env.WORKER_CONCURRENCY || 3),
  pollIntervalMs: Number(process.env.WORKER_POLL_INTERVAL_MS || 3000),
  lockTtlMs: Number(process.env.WORKER_LOCK_TTL_MS || 120000),
  providerSubmitTimeoutMs: Number(process.env.PROVIDER_SUBMIT_TIMEOUT_MS || 90000),
  providerPollTimeoutMs: Number(process.env.PROVIDER_POLL_TIMEOUT_MS || 30000),

  mysqlUrl:
    process.env.MYSQL_URL ||
    process.env.DATABASE_URL ||
    (
      process.env.MYSQL_USER && process.env.MYSQL_DATABASE
        ? `mysql://${encodeURIComponent(process.env.MYSQL_USER)}:${encodeURIComponent(process.env.MYSQL_PASSWORD || '')}@${process.env.MYSQL_HOST || '127.0.0.1'}:${process.env.MYSQL_PORT || '3306'}/${process.env.MYSQL_DATABASE}`
        : ''
    ),

  wsPort: Number(process.env.WS_PORT || 3210),

  app: {
    publicOrigin:
      process.env.PUBLIC_APP_ORIGIN ||
      process.env.NEXT_PUBLIC_APP_ORIGIN ||
      '',
  },

  cos: {
    secretId: process.env.COS_SECRET_ID || '',
    secretKey: process.env.COS_SECRET_KEY || '',
    bucket: process.env.COS_BUCKET || '',
    region: process.env.COS_REGION || '',
    publicBaseUrl:
      process.env.COS_PUBLIC_BASE_URL ||
      process.env.COS_DOMAIN ||
      '',
  },
}
if (!config.mysqlUrl) {
  throw new Error(
    'Missing MySQL connection config. Please set MYSQL_URL or DATABASE_URL in worker/.env.',
  )
}
