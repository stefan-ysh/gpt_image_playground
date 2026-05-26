import type { ApiProfile } from '../types'
import { readRuntimeEnv } from './runtimeEnv'

export interface DevProxyConfig {
  enabled: boolean
  prefix: string
  target: string
  changeOrigin: boolean
  secure: boolean
}

const DEFAULT_PROXY_PREFIX = '/api-proxy'

declare const __DEV_PROXY_CONFIG__: unknown

export function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim()
  if (!trimmed) return ''

  const input = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed)
    ? trimmed
    : `https://${trimmed}`

  try {
    const url = new URL(input)
    const pathSegments = url.pathname.split('/').filter(Boolean)
    const v1Index = pathSegments.indexOf('v1')
    const normalizedSegments = v1Index >= 0
      ? pathSegments.slice(0, v1Index + 1)
      : pathSegments.length
        ? [...pathSegments, 'v1']
        : []
    const pathname = normalizedSegments.length ? `/${normalizedSegments.join('/')}` : ''
    return `${url.origin}${pathname}`
  } catch {
    return trimmed.replace(/\/+$/, '')
  }
}

export function normalizeDevProxyConfig(input: unknown): DevProxyConfig | null {
  if (!input || typeof input !== 'object') return null

  const record = input as Record<string, unknown>
  const target = normalizeBaseUrl(typeof record.target === 'string' ? record.target : '')
  if (!target) return null

  const rawPrefix = typeof record.prefix === 'string' ? record.prefix : DEFAULT_PROXY_PREFIX
  const trimmedPrefix = rawPrefix.trim().replace(/^\/+/, '').replace(/\/+$/, '')
  const prefix = trimmedPrefix ? `/${trimmedPrefix}` : DEFAULT_PROXY_PREFIX

  return {
    enabled: Boolean(record.enabled),
    prefix,
    target,
    changeOrigin: record.changeOrigin !== false,
    secure: Boolean(record.secure),
  }
}

export function buildApiUrl(
  baseUrl: string,
  path: string,
  proxyConfig?: DevProxyConfig | null,
  useApiProxy = false,
): string {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
  const endpointPath = path.replace(/^\/+/, '')
  // 针对 uploads 专属文件上传路径特判：决不强加 v1 前缀！因为上传接口属于资源管理，不受 v1 AI API 控制！
  const isUploadPath = endpointPath.startsWith('uploads/')
  const apiPath = isUploadPath
    ? endpointPath
    : normalizedBaseUrl.endsWith('/v1')
      ? endpointPath
      : ['v1', endpointPath].join('/')

  if (useApiProxy) {
    // 采用超稳定、零 rewrites 依赖的同源 API 代理查询路径，从根本上消灭 Next.js 开发环境下重写 404 隐患
    return `/api/proxy?target=${encodeURIComponent(normalizedBaseUrl)}&path=${encodeURIComponent(apiPath)}`
  }

  return normalizedBaseUrl ? `${normalizedBaseUrl}/${apiPath}` : `/${apiPath}`
}

export function resolveDevProxyConfig(input: unknown, isDev: boolean): DevProxyConfig | null {
  if (!isDev) return null
  return normalizeDevProxyConfig(input)
}

export function readClientDevProxyConfig(): DevProxyConfig | null {
  return resolveDevProxyConfig(
    typeof __DEV_PROXY_CONFIG__ === 'undefined' ? null : __DEV_PROXY_CONFIG__,
    process.env.NODE_ENV !== 'production',
  )
}

export function isApiProxyAvailable(proxyConfig: DevProxyConfig | null = readClientDevProxyConfig()): boolean {
  const envAvailable = readRuntimeEnv(process.env.NEXT_PUBLIC_API_PROXY_AVAILABLE || process.env.VITE_API_PROXY_AVAILABLE) === 'true'
  const hasLocalConfig = Boolean(proxyConfig?.enabled)

  // 释放网络直连掌控权：不再在本地开发模式下强行锁死并启用中转代理，由用户配置与环境变量显式决定是否开启
  return envAvailable || hasLocalConfig
}

export function isApiProxyLocked(proxyConfig: DevProxyConfig | null = readClientDevProxyConfig()): boolean {
  return readRuntimeEnv(process.env.NEXT_PUBLIC_API_PROXY_LOCKED || process.env.VITE_API_PROXY_LOCKED) === 'true' && isApiProxyAvailable(proxyConfig)
}

export function shouldUseApiProxy(
  apiProxy: boolean,
  proxyConfig: DevProxyConfig | null = readClientDevProxyConfig(),
  provider?: string,
  baseUrl?: string,
): boolean {
  // 从根本上释放网络直连掌控权：无论是 APIMart、DragonCode 还是其他任何服务商，只要代理可用，都严格尊崇用户在界面上控制的 apiProxy 开关，或者系统级强制锁定配置
  return isApiProxyAvailable(proxyConfig) && (apiProxy || isApiProxyLocked(proxyConfig))
}

export function getProxyImageUrl(url: string, profile: ApiProfile): string {
  const proxyConfig = readClientDevProxyConfig()
  const isHttp = url.startsWith('http://') || url.startsWith('https://')
  if (!shouldUseApiProxy(profile.apiProxy, proxyConfig, profile.provider, profile.baseUrl) || !isHttp) {
    return url
  }

  const buildImageProxyUrl = (targetBase: string, imageUrl: URL) => {
    const normalizedTarget = targetBase.replace(/\/+$/, '')
    const targetUrl = new URL(normalizedTarget)
    const targetPath = targetUrl.pathname.replace(/\/+$/, '')
    const imagePath = imageUrl.pathname.startsWith(targetPath)
      ? imageUrl.pathname.slice(targetPath.length).replace(/^\/+/, '')
      : imageUrl.pathname.replace(/^\/+/, '')
    const path = `${imagePath}${imageUrl.search}`
    return `/api/proxy?target=${encodeURIComponent(normalizedTarget)}&path=${encodeURIComponent(path)}`
  }

  try {
    const imageUrl = new URL(url)

    // 针对龙码域名做特判保护，防止因 baseUrl 配置差异导致图片地址未能正确重写而跨域
    if (imageUrl.hostname.toLowerCase().includes('dragoncode.codes')) {
      const dragonCodeBase = 'https://dragoncode.codes/gpt-image'
      if (url.toLowerCase().startsWith(dragonCodeBase)) {
        return buildImageProxyUrl(dragonCodeBase, imageUrl)
      }
    }

    const baseUrl = new URL(normalizeBaseUrl(profile.baseUrl))

    if (imageUrl.hostname.toLowerCase() === baseUrl.hostname.toLowerCase()) {
      const normalizedBase = normalizeBaseUrl(profile.baseUrl)
      const basePrefix = normalizedBase.endsWith('/v1')
        ? normalizedBase.slice(0, -3)
        : normalizedBase

      if (url.startsWith(basePrefix)) {
        return buildImageProxyUrl(basePrefix, imageUrl)
      }
    }
  } catch {
    // ignore URL parsing error
  }
  return url
}
