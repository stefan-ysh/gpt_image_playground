import mysql, { Pool, PoolOptions, RowDataPacket } from 'mysql2/promise';

// 防止在 Next.js 开发阶段由于热更新创建多个连接池
const globalForMysql = globalThis as unknown as { mysqlPool: Pool | null };

function resolvePoolOptions(): PoolOptions {
  const connectionLimit = Number(process.env.MYSQL_POOL_SIZE ?? '10');
  const mysqlTimezone = process.env.MYSQL_TIMEZONE?.trim() || '+08:00';

  const host = process.env.MYSQL_HOST?.trim() || '127.0.0.1';
  const port = Number(process.env.MYSQL_PORT ?? '3306');
  const user = process.env.MYSQL_USER?.trim() || 'root';
  const password = process.env.MYSQL_PASSWORD ?? '';
  const database = process.env.MYSQL_DATABASE?.trim() || 'gpt_image';

  return {
    host,
    port,
    user,
    password,
    database,
    waitForConnections: true,
    connectionLimit,
    decimalNumbers: true,
    timezone: mysqlTimezone,
  } satisfies PoolOptions;
}

async function getPool(): Promise<Pool> {
  if (!globalForMysql.mysqlPool) {
    const options = resolvePoolOptions();
    const { database } = options;

    if (database) {
      const { database: _, ...optionsWithoutDb } = options;
      try {
        const tempConn = await mysql.createConnection(optionsWithoutDb);
        await tempConn.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
        await tempConn.end();
        // console.log(`[MySQL] Database "${database}" ensured successfully.`);
      } catch (err) {
        console.warn(`[MySQL Warning] Failed to ensure database "${database}":`, err);
      }
    }

    globalForMysql.mysqlPool = mysql.createPool(options);
  }
  return globalForMysql.mysqlPool;
}

function buildQuery(strings: TemplateStringsArray, values: unknown[]) {
  let sql = '';
  for (let i = 0; i < strings.length; i += 1) {
    sql += strings[i];
    if (i < values.length) {
      sql += '?';
    }
  }
  return { sql, values };
}

export type MysqlQueryResult<T> = { rows: T[] };

export async function mysqlQuery<T extends RowDataPacket = RowDataPacket>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<MysqlQueryResult<T>> {
  const poolInstance = await getPool();
  const { sql, values: params } = buildQuery(strings, values);

  const start = performance.now();
  try {
    const [rows] = await poolInstance.query<T[]>(sql, params);
    const duration = performance.now() - start;

    if (process.env.NODE_ENV === 'development') {
      console.log(`[MySQL] ${duration.toFixed(2)}ms - ${sql}`);
    }

    return { rows };
  } catch (error) {
    console.error('[MySQL Error]', sql, error);
    throw error;
  }
}

export { getPool as mysqlPool };
