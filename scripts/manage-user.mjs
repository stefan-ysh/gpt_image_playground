#!/usr/bin/env node
/**
 * Image Studio 用户管理 CLI（无 Web 管理界面，用户维护走本脚本或直接改库）
 *
 * 用法：
 *   node scripts/manage-user.mjs add <email> [显示名] [密码]
 *   node scripts/manage-user.mjs set-password <email> [新密码]
 *   node scripts/manage-user.mjs set-email <旧邮箱> <新邮箱>
 *   node scripts/manage-user.mjs list [关键词]
 *   node scripts/manage-user.mjs disable <email>
 *   node scripts/manage-user.mjs enable <email>
 *
 * 密码存储格式与 src/lib/db/auth.ts 一致：scrypt(salt:hash)，16 字节盐 / 64 字节摘要。
 * 数据库连接读取项目根目录 .env（MYSQL_URL 或 MYSQL_HOST/PORT/USER/PASSWORD/DATABASE）。
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { randomBytes, randomUUID, scryptSync } from 'crypto';
import mysql from 'mysql2/promise';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

// ---- 读取 .env ----
function loadEnv() {
  try {
    const raw = readFileSync(join(PROJECT_ROOT, '.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      const key = match[1];
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // 允许通过环境变量注入
  }
}
loadEnv();

// ---- 密码（与 auth.ts 同一算法）----
function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function generatePassword() {
  // 12 位可读随机密码（避开易混淆字符）
  const alphabet = 'abcdefghjkmnpqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(randomBytes(12)).map((b) => alphabet[b % alphabet.length]).join('');
}

// ---- 数据库连接 ----
async function getConnection() {
  const url = process.env.MYSQL_URL || process.env.DATABASE_URL;
  if (url) return mysql.createConnection(url);
  return mysql.createConnection({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'gpt_image',
  });
}

// ---- 命令实现 ----
async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command) return printUsage();

  const conn = await getConnection();
  try {
    switch (command) {
      case 'add': {
        const [email, displayName, password] = args;
        if (!email) return fail('用法: add <email> [显示名] [密码]');
        const finalPassword = password || generatePassword();
        const normalized = email.trim().toLowerCase();
        try {
          await conn.execute(
            'INSERT INTO playground_users (id, email, display_name, role, status, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [randomUUID(), normalized, displayName || null, 'member', 'active', hashPassword(finalPassword), new Date()],
          );
          console.log(`✅ 用户已创建: ${normalized}${displayName ? ` (${displayName})` : ''}`);
          if (!password) console.log(`初始密码: ${finalPassword}`);
        } catch (err) {
          if (err.code === 'ER_DUP_ENTRY') {
            console.error(`❌ 邮箱已存在: ${normalized}`);
            process.exitCode = 1;
          } else throw err;
        }
        break;
      }

      case 'set-password': {
        const [email, password] = args;
        if (!email) return fail('用法: set-password <email> [新密码]');
        const finalPassword = password || generatePassword();
        const [result] = await conn.execute(
          'UPDATE playground_users SET password_hash = ? WHERE email = ?',
          [hashPassword(finalPassword), email.trim().toLowerCase()],
        );
        if (result.affectedRows === 0) return fail(`用户不存在: ${email}`);
        console.log(`✅ 密码已更新: ${email}`);
        if (!password) console.log(`新密码: ${finalPassword}`);
        break;
      }

      case 'set-email': {
        const [oldEmail, newEmail] = args;
        if (!oldEmail || !newEmail) return fail('用法: set-email <旧邮箱> <新邮箱>');
        const [result] = await conn.execute(
          'UPDATE playground_users SET email = ? WHERE email = ?',
          [newEmail.trim().toLowerCase(), oldEmail.trim().toLowerCase()],
        );
        if (result.affectedRows === 0) return fail(`用户不存在: ${oldEmail}`);
        console.log(`✅ 邮箱已更新: ${oldEmail} → ${newEmail}`);
        break;
      }

      case 'set-admin': {
        const [email, flag] = args;
        if (!email) return fail('用法: set-admin <email> [on|off]');
        const value = flag === 'off' ? 0 : 1;
        const [result] = await conn.execute(
          'UPDATE playground_users SET is_admin = ?, status = CASE WHEN ? = 1 THEN status ELSE status END WHERE email = ?',
          [value, value, email.trim().toLowerCase()],
        );
        if (result.affectedRows === 0) return fail(`用户不存在: ${email}`);
        console.log(`✅ ${email} 超级管理员: ${value ? '开' : '关'}`);
        break;
      }

      case 'list': {
        const keyword = args[0] ? `%${args[0].trim().toLowerCase()}%` : '%';
        const [rows] = await conn.execute(
          `SELECT email, display_name, status, role, password_hash IS NOT NULL AS has_password,
                  created_at, last_login_at
           FROM playground_users WHERE email LIKE ? ORDER BY created_at DESC LIMIT 200`,
          [keyword],
        );
        if (rows.length === 0) return console.log('(无用户)');
        for (const row of rows) {
          const created = row.created_at ? new Date(Number(row.created_at)).toLocaleString('zh-CN') : '-';
          const lastLogin = row.last_login_at ? new Date(Number(row.last_login_at)).toLocaleString('zh-CN') : '从未登录';
          console.log(
            `${row.email}  [${row.status}]${row.has_password ? '' : ' [未设密码]'}  ${row.display_name || '-'}  创建:${created}  最近登录:${lastLogin}`,
          );
        }
        console.log(`共 ${rows.length} 条`);
        break;
      }

      case 'disable':
      case 'enable': {
        const [email] = args;
        if (!email) return fail(`用法: ${command} <email>`);
        const [result] = await conn.execute(
          'UPDATE playground_users SET status = ? WHERE email = ?',
          [command === 'disable' ? 'disabled' : 'active', email.trim().toLowerCase()],
        );
        if (result.affectedRows === 0) return fail(`用户不存在: ${email}`);
        console.log(`✅ 已${command === 'disable' ? '禁用' : '启用'}: ${email}`);
        break;
      }

      default:
        printUsage();
    }
  } finally {
    await conn.end();
  }
}

function fail(message) {
  console.error(`❌ ${message}`);
  process.exitCode = 1;
}

function printUsage() {
  console.log(`Image Studio 用户管理 CLI
用法:
  node scripts/manage-user.mjs add <email> [显示名] [密码]
  node scripts/manage-user.mjs set-password <email> [新密码]
  node scripts/manage-user.mjs set-email <旧邮箱> <新邮箱>
  node scripts/manage-user.mjs list [关键词]
  node scripts/manage-user.mjs disable <email>
  node scripts/manage-user.mjs enable <email>
  node scripts/manage-user.mjs set-admin <email> [on|off]`);
}

main().catch((err) => {
  console.error('执行失败:', err.message);
  process.exitCode = 1;
});
