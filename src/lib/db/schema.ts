import { mysqlPool } from './mysql';
import { collectTaskRowImageRefs, getTaskImageIdHash } from './task-images';

let initialized = false;

const ID_SQL = 'VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin';
const USER_ID_SQL = 'CHAR(36) CHARACTER SET ascii COLLATE ascii_bin';
const HASH_SQL = 'CHAR(64) CHARACTER SET ascii COLLATE ascii_bin';
const ROLE_SQL = 'VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin';

export async function ensurePlaygroundSchema() {
  if (initialized) return;

  const pool = await mysqlPool();

  // 1. 创建 playground_images 表
  await pool.query(`
    CREATE TABLE IF NOT EXISTS playground_images (
      id ${ID_SQL} NOT NULL PRIMARY KEY,
      data_url VARCHAR(1024) NOT NULL,
      created_at BIGINT,
      source VARCHAR(50),
      width INT,
      height INT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 ROW_FORMAT=DYNAMIC;
  `);

  // 2. 创建 playground_thumbnails 表
  await pool.query(`
    CREATE TABLE IF NOT EXISTS playground_thumbnails (
      id ${ID_SQL} NOT NULL PRIMARY KEY,
      thumbnail_data_url VARCHAR(1024) NOT NULL,
      width INT,
      height INT,
      thumbnail_version INT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 ROW_FORMAT=DYNAMIC;
  `);

  // 3. 检查 hr_employees 表是否存在，如果存在则添加外键约束
  const [tables] = await pool.query<any[]>(
    "SHOW TABLES LIKE 'hr_employees'"
  );
  const hasHrEmployees = tables.length > 0;

  // 3.5 图片内容按 hash 全局去重，归属关系单独记录，避免删除当前用户任务时误删其他用户仍在使用的图片。
  let imageOwnersSql = `
    CREATE TABLE IF NOT EXISTS playground_image_owners (
      image_id ${ID_SQL} NOT NULL,
      user_id ${USER_ID_SQL} NOT NULL,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (image_id, user_id),
      CONSTRAINT fk_playground_image_owners_image FOREIGN KEY (image_id) REFERENCES playground_images(id) ON DELETE CASCADE
  `;
  if (hasHrEmployees) {
    imageOwnersSql += `, CONSTRAINT fk_playground_image_owners_user FOREIGN KEY (user_id) REFERENCES hr_employees(id) ON DELETE CASCADE`;
  }
  imageOwnersSql += `) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 ROW_FORMAT=DYNAMIC;`;
  await pool.query(imageOwnersSql);

  let taskImagesSql = `
    CREATE TABLE IF NOT EXISTS playground_task_images (
      task_id ${ID_SQL} NOT NULL,
      user_id ${USER_ID_SQL} NOT NULL,
      image_id TEXT NOT NULL,
      image_id_hash ${HASH_SQL} NOT NULL,
      role ${ROLE_SQL} NOT NULL,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (task_id, image_id_hash, role),
      INDEX idx_playground_task_images_user_image_hash (user_id, image_id_hash),
      INDEX idx_playground_task_images_task (task_id),
      CONSTRAINT fk_playground_task_images_task FOREIGN KEY (task_id) REFERENCES playground_tasks(id) ON DELETE CASCADE
  `;
  if (hasHrEmployees) {
    taskImagesSql += `, CONSTRAINT fk_playground_task_images_user FOREIGN KEY (user_id) REFERENCES hr_employees(id) ON DELETE CASCADE`;
  }
  taskImagesSql += `) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 ROW_FORMAT=DYNAMIC;`;

  // 4. 创建 playground_tasks 表
  let tasksSql = `
    CREATE TABLE IF NOT EXISTS playground_tasks (
      id ${ID_SQL} NOT NULL PRIMARY KEY,
      user_id ${USER_ID_SQL} NOT NULL,
      prompt TEXT NOT NULL,
      params TEXT NOT NULL,
      api_provider VARCHAR(255),
      api_profile_id VARCHAR(255),
      api_profile_name VARCHAR(255),
      api_mode VARCHAR(50),
      api_model VARCHAR(255),
      api_profile_snapshot LONGTEXT,
      custom_provider_snapshot LONGTEXT,
      fal_request_id VARCHAR(255),
      fal_endpoint VARCHAR(255),
      fal_recoverable TINYINT(1) DEFAULT 0,
      custom_task_id VARCHAR(255),
      custom_recoverable TINYINT(1) DEFAULT 0,
      actual_params TEXT,
      actual_params_by_image TEXT,
      revised_prompt_by_image TEXT,
      input_image_ids TEXT,
      mask_target_image_id ${ID_SQL},
      mask_image_id ${ID_SQL},
      output_images TEXT,
      stream_partial_image_ids TEXT,
      raw_image_urls TEXT,
      raw_response_payload LONGTEXT,
      status VARCHAR(50) NOT NULL,
      error TEXT,
      created_at BIGINT NOT NULL,
      finished_at BIGINT,
      elapsed INT,
      is_favorite TINYINT(1) DEFAULT 0,
      group_id ${ID_SQL},
      owner_fingerprint VARCHAR(255),
      cost DOUBLE DEFAULT NULL
  `;
  if (hasHrEmployees) {
    tasksSql += `, CONSTRAINT fk_playground_tasks_user FOREIGN KEY (user_id) REFERENCES hr_employees(id) ON DELETE CASCADE`;
  }
  tasksSql += `) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 ROW_FORMAT=DYNAMIC;`;
  await pool.query(tasksSql);

  try {
    const [taskImageColumns] = await pool.query<any[]>("SHOW COLUMNS FROM playground_task_images LIKE 'image_id_hash'");
    if (taskImageColumns.length === 0) {
      await pool.query("DROP TABLE IF EXISTS playground_task_images");
    }
  } catch (e: any) {
    if (e.code !== 'ER_NO_SUCH_TABLE' && e.errno !== 1146) {
      console.warn('Failed to inspect playground_task_images schema:', e);
    }
  }
  await pool.query(taskImagesSql);

  // 5. 创建 playground_app_state 表
  let appStateSql = `
    CREATE TABLE IF NOT EXISTS playground_app_state (
      id ${ID_SQL} NOT NULL,
      user_id ${USER_ID_SQL} NOT NULL,
      value LONGTEXT NOT NULL,
      PRIMARY KEY (id, user_id)
  `;
  if (hasHrEmployees) {
    appStateSql += `, CONSTRAINT fk_playground_app_state_user FOREIGN KEY (user_id) REFERENCES hr_employees(id) ON DELETE CASCADE`;
  }
  appStateSql += `) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 ROW_FORMAT=DYNAMIC;`;
  await pool.query(appStateSql);

  // 5.5 创建 playground_groups 表
  let groupsSql = `
    CREATE TABLE IF NOT EXISTS playground_groups (
      id ${ID_SQL} NOT NULL PRIMARY KEY,
      user_id ${USER_ID_SQL} NOT NULL,
      name VARCHAR(255) NOT NULL,
      created_at BIGINT NOT NULL
  `;
  if (hasHrEmployees) {
    groupsSql += `, CONSTRAINT fk_playground_groups_user FOREIGN KEY (user_id) REFERENCES hr_employees(id) ON DELETE CASCADE`;
  }
  groupsSql += `) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 ROW_FORMAT=DYNAMIC;`;
  await pool.query(groupsSql);

  // 5.6 创建 playground_pending_image_transfers 表 - 用于存储待转存的临时图片URL
  let pendingTransfersSql = `
    CREATE TABLE IF NOT EXISTS playground_pending_image_transfers (
      id ${ID_SQL} NOT NULL PRIMARY KEY,
      task_id ${ID_SQL} NOT NULL,
      user_id ${USER_ID_SQL} NOT NULL,
      temp_url VARCHAR(1024) NOT NULL,
      transfer_status VARCHAR(50) NOT NULL DEFAULT 'pending',
      retry_count INT DEFAULT 0,
      last_retry_at BIGINT,
      error_message TEXT,
      created_at BIGINT NOT NULL,
      transferred_image_id ${ID_SQL},
      INDEX idx_task_status (task_id, transfer_status),
      INDEX idx_user_status (user_id, transfer_status),
      INDEX idx_status_retry (transfer_status, last_retry_at),
      CONSTRAINT fk_pending_transfers_task FOREIGN KEY (task_id) REFERENCES playground_tasks(id) ON DELETE CASCADE
  `;
  if (hasHrEmployees) {
    pendingTransfersSql += `, CONSTRAINT fk_pending_transfers_user FOREIGN KEY (user_id) REFERENCES hr_employees(id) ON DELETE CASCADE`;
  }
  pendingTransfersSql += `) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 ROW_FORMAT=DYNAMIC;`;
  await pool.query(pendingTransfersSql);

  // 清理曾经用于复杂配额方案的多余表。当前限额直接从 playground_tasks 统计成功图片数。
  await pool.query("DROP TABLE IF EXISTS playground_daily_usage");
  await pool.query("DROP TABLE IF EXISTS playground_quota_rules");

  // 6. 建立常用索引
  async function createIndex(sql: string) {
    try {
      await pool.query(sql);
    } catch (e: any) {
      if (e.code !== 'ER_DUP_KEYNAME') console.warn(e);
    }
  }

  await createIndex("CREATE INDEX idx_playground_tasks_user ON playground_tasks(user_id)");
  await createIndex("CREATE INDEX idx_playground_tasks_user_created ON playground_tasks(user_id, created_at)");
  await createIndex("CREATE INDEX idx_playground_tasks_user_group_created ON playground_tasks(user_id, group_id, created_at)");
  await createIndex("CREATE INDEX idx_playground_tasks_user_favorite_created ON playground_tasks(user_id, is_favorite, created_at)");
  await createIndex("CREATE INDEX idx_playground_groups_user_created ON playground_groups(user_id, created_at)");
  await createIndex("CREATE INDEX idx_playground_image_owners_user_image ON playground_image_owners(user_id, image_id)");
  await createIndex("CREATE INDEX idx_playground_tasks_worker_pick ON playground_tasks(status, next_poll_at, locked_until)");
  await createIndex("CREATE INDEX idx_playground_tasks_provider_task ON playground_tasks(api_provider, provider_task_id)");

  async function addTaskColumn(sql: string) {
    try {
      await pool.query(`ALTER TABLE playground_tasks ADD COLUMN IF NOT EXISTS ${sql}`);
    } catch (e: any) {
      try {
        await pool.query(`ALTER TABLE playground_tasks ADD COLUMN ${sql}`);
      } catch (innerE: any) {
        if (innerE.code !== 'ER_DUP_COLUMN' && innerE.code !== 'ER_DUP_FIELDNAME' && innerE.errno !== 1060) {
          console.error(`Failed to add column ${sql}:`, innerE);
        }
      }
    }
  }

  async function dropTaskColumn(name: string) {
    try {
      await pool.query(`ALTER TABLE playground_tasks DROP COLUMN IF EXISTS ${name}`);
    } catch (e: any) {
      try {
        await pool.query(`ALTER TABLE playground_tasks DROP COLUMN ${name}`);
      } catch (innerE: any) {
        if (innerE.code !== 'ER_CANT_DROP_FIELD_OR_KEY' && innerE.errno !== 1091) {
          console.error(`Failed to drop column ${name}:`, innerE);
        }
      }
    }
  }

  // 7. 动态升级 playground_tasks 表：保留任务恢复所需的 API 元数据和快照
  await addTaskColumn("api_provider VARCHAR(255)");
  await addTaskColumn("api_profile_id VARCHAR(255)");
  await addTaskColumn("api_profile_name VARCHAR(50)");
  await addTaskColumn("api_mode VARCHAR(50)");
  await addTaskColumn("api_profile_snapshot LONGTEXT");
  await addTaskColumn("custom_provider_snapshot LONGTEXT");
  await addTaskColumn("fal_request_id VARCHAR(255)");
  await addTaskColumn("fal_endpoint VARCHAR(255)");
  await addTaskColumn("fal_recoverable TINYINT(1) DEFAULT 0");
  await addTaskColumn("owner_fingerprint VARCHAR(255)");
  await addTaskColumn("raw_response_payload LONGTEXT");
  await addTaskColumn("cost DOUBLE DEFAULT NULL");
  await addTaskColumn("output_images_pending TEXT");
    // Worker 状态机字段：用于后端任务提交、轮询、转存和恢复
  await addTaskColumn("provider_task_id VARCHAR(255)");
  await addTaskColumn("provider_status VARCHAR(64)");
  await addTaskColumn("submit_status VARCHAR(64)");
  await addTaskColumn("run_attempt INT DEFAULT 1");
  await addTaskColumn("poll_attempts INT DEFAULT 0");
  await addTaskColumn("manual_sync_attempts INT DEFAULT 0");
  await addTaskColumn("last_poll_at BIGINT");
  await addTaskColumn("next_poll_at BIGINT");
  await addTaskColumn("submitted_at BIGINT");
  await addTaskColumn("provider_finished_at BIGINT");
  await addTaskColumn("external_task_expires_at BIGINT");
  await addTaskColumn("worker_id VARCHAR(128)");
  await addTaskColumn("locked_until BIGINT");
  await addTaskColumn("last_provider_payload LONGTEXT");
  await addTaskColumn("last_provider_error TEXT");
  await addTaskColumn("idempotency_key VARCHAR(255)");
  await addTaskColumn("provider_result_raw LONGTEXT");
  await addTaskColumn("copied_from_task_id VARCHAR(128)");
  await dropTaskColumn("quota_date");
  await dropTaskColumn("quota_reserved_cost");
  await dropTaskColumn("quota_settled");

  try {
    const [taskRows] = await pool.query<any[]>(
      `SELECT id, user_id, input_image_ids, mask_target_image_id, mask_image_id, output_images, output_images_pending, stream_partial_image_ids
       FROM playground_tasks`
    );
    const now = Date.now();
    for (const task of taskRows) {
      const refs = collectTaskRowImageRefs(task);
      if (refs.length > 0) {
        await pool.query(
          `INSERT IGNORE INTO playground_task_images (task_id, user_id, image_id, image_id_hash, role, created_at)
           VALUES ?`,
          [refs.map((ref) => [task.id, task.user_id, ref.imageId, getTaskImageIdHash(ref.imageId), ref.role, now])]
        );
      }
      for (const imageId of new Set(refs.map((ref) => ref.imageId))) {
        await pool.query(
          `INSERT IGNORE INTO playground_image_owners (image_id, user_id, created_at)
           SELECT id, ?, ? FROM playground_images WHERE id = ?`,
          [task.user_id, now, imageId]
        );
      }
    }
  } catch (e) {
    console.warn('Failed to backfill playground_image_owners:', e);
  }

  initialized = true;
}
