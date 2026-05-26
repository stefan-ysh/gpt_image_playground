import COS from 'cos-nodejs-sdk-v5';
import { env } from '@/lib/env';

export function isCosConfigured(): boolean {
  const config = env.server.cos;
  return Boolean(config.secretId && config.secretKey && config.bucket && config.region);
}

function getCosInstance() {
  const config = env.server.cos;
  if (!config.secretId || !config.secretKey) {
    throw new Error('COS credentials not found');
  }
  return new COS({
    SecretId: config.secretId,
    SecretKey: config.secretKey,
  });
}

export async function uploadBufferToCos(
  buffer: Buffer,
  key: string,
  contentType: string
): Promise<string> {
  const config = env.server.cos;
  if (!config.bucket || !config.region) {
    throw new Error('COS bucket or region not configured');
  }
  const cos = getCosInstance();

  await new Promise<void>((resolve, reject) => {
    cos.putObject(
      {
        Bucket: config.bucket!,
        Region: config.region!,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      },
      (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      }
    );
  });

  const publicBaseUrl = env.server.cos.publicBaseUrl?.trim();
  if (publicBaseUrl) {
    return `${publicBaseUrl.replace(/\/+$/, '')}/${key}`;
  }
  return `/api/files/cos/${key}`;
}

interface CosObjectItem {
  Key: string;
}

export async function deleteCosFolder(prefix: string): Promise<void> {
  if (!isCosConfigured()) return;
  const config = env.server.cos;
  const cos = getCosInstance();

  // 1. 列出该前缀下的所有对象
  const objects = await new Promise<unknown[]>((resolve, reject) => {
    cos.getBucket(
      {
        Bucket: config.bucket!,
        Region: config.region!,
        Prefix: prefix,
        MaxKeys: 1000,
      },
      (err, data) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(data.Contents || []);
      }
    );
  });

  if (objects.length === 0) return;

  // 2. 批量删除对象
  const keys = objects.map((obj) => ({ Key: (obj as CosObjectItem).Key }));
  await new Promise<void>((resolve, reject) => {
    cos.deleteMultipleObject(
      {
        Bucket: config.bucket!,
        Region: config.region!,
        Objects: keys,
      },
      (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      }
    );
  });
}

export async function deleteCosObjects(keys: string[]): Promise<void> {
  const uniqueKeys = Array.from(new Set(keys.filter(Boolean)));
  if (!isCosConfigured() || uniqueKeys.length === 0) return;

  const config = env.server.cos;
  const cos = getCosInstance();

  for (let i = 0; i < uniqueKeys.length; i += 1000) {
    const batch = uniqueKeys.slice(i, i + 1000).map((Key) => ({ Key }));
    await new Promise<void>((resolve, reject) => {
      cos.deleteMultipleObject(
        {
          Bucket: config.bucket!,
          Region: config.region!,
          Objects: batch,
        },
        (err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        }
      );
    });
  }
}
