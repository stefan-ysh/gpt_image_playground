import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'
import { normalizeDevProxyConfig } from './src/lib/devProxy'

function loadDevProxyConfig() {
  try {
    return normalizeDevProxyConfig(
      JSON.parse(readFileSync('./dev-proxy.config.json', 'utf-8')) as unknown,
    )
  } catch (error) {
    const err = error as NodeJS.ErrnoException
    if (err.code === 'ENOENT') return null
    throw error
  }
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd())
  const dashboardUrl = env.VITE_DASHBOARD_URL || 'http://localhost:3000'
  const devProxyConfig = command === 'serve' ? loadDevProxyConfig() : null

  return {
    plugins: [react()],
    base: './',
    define: {
      __DEV_PROXY_CONFIG__: JSON.stringify(devProxyConfig),
    },
    server: {
      host: true,
      proxy: {
        '/api/auth': {
          target: dashboardUrl,
          changeOrigin: true,
        },
        ...(devProxyConfig?.enabled
          ? {
              [devProxyConfig.prefix]: {
                target: devProxyConfig.target,
                changeOrigin: devProxyConfig.changeOrigin,
                secure: devProxyConfig.secure,
                rewrite: (path) => {
                  const relative = path.replace(
                    new RegExp(`^${devProxyConfig.prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
                    '',
                  )
                  return relative.startsWith('/media/') ? `..${relative}` : relative
                },
              },
            }
          : {}),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('react/') || id.includes('react-dom/') || id.includes('scheduler/')) {
                return 'react-vendor';
              }
              if (
                id.includes('react-markdown') ||
                id.includes('remark-gfm') ||
                id.includes('mdast-') ||
                id.includes('micromark') ||
                id.includes('unist-') ||
                id.includes('vfile') ||
                id.includes('decode-named-character-reference')
              ) {
                return 'markdown-vendor';
              }
              return 'vendor';
            }
          },
        },
      },
    },
  };
});
