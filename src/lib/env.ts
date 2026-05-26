/**
 * Runtime environment variable helper
 * Provides type-safe access to environment variables with proper defaults
 */

export const env = {
  // Public environment variables (exposed to client)
  public: {
    // Dashboard/Auth server URL
    dashboardUrl:
      process.env.NEXT_PUBLIC_DASHBOARD_URL,

    // Default API base URL for image generation
    defaultBaseUrl:
      process.env.NEXT_PUBLIC_DEFAULT_BASE_URL || 'https://api.openai.com/v1',

    // Test API base URL for image generation
    testBaseUrl:
      process.env.NEXT_PUBLIC_TEST_BASE_URL || process.env.NEXT_PUBLIC_DEFAULT_BASE_URL || 'https://api.openai.com/v1',

    // Whether to use the test API base URL
    useTestUrl:
      process.env.NEXT_PUBLIC_USE_TEST_URL === 'true',

    // Current app URL (for redirects)
    appUrl: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  },

  // Server-side environment variables (not exposed to client)
  server: {
    // MySQL Database
    mysql: {
      host: process.env.MYSQL_HOST || '127.0.0.1',
      port: parseInt(process.env.MYSQL_PORT || '3306', 10),
      user: process.env.MYSQL_USER || 'root',
      password: process.env.MYSQL_PASSWORD || '',
      database: process.env.MYSQL_DATABASE || 'gpt_image',
    },

    // Tencent Cloud COS (Object Storage)
    cos: {
      secretId: process.env.COS_SECRET_ID || process.env.SecretId || '',
      secretKey: process.env.COS_SECRET_KEY || process.env.SecretKey || '',
      bucket: process.env.COS_BUCKET || '',
      region: process.env.COS_REGION || '',
      publicBaseUrl: process.env.COS_PUBLIC_BASE_URL || '',
    },

    // Node environment
    nodeEnv: process.env.NODE_ENV || 'development',

    // Debug mode
    debug: process.env.DEBUG === 'true',
  },
};

/**
 * Validate that required environment variables are set
 */
export function validateServerEnv() {
  const requiredEnv = {
    MYSQL_HOST: env.server.mysql.host,
    MYSQL_USER: env.server.mysql.user,
    MYSQL_DATABASE: env.server.mysql.database,
  };

  const missing: string[] = [];
  for (const [key, value] of Object.entries(requiredEnv)) {
    if (!value) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    console.warn(`Missing environment variables: ${missing.join(', ')}`);
  }

  return missing.length === 0;
}

export function getActiveBaseUrl(): string {
  return env.public.useTestUrl ? env.public.testBaseUrl : env.public.defaultBaseUrl;
}
