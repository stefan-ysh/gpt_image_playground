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
  const apiPath = normalizedBaseUrl.endsWith('/v1')
    ? endpointPath
    : ['v1', endpointPath].join('/')

  if (useApiProxy) {
    return `${proxyConfig?.prefix ?? DEFAULT_PROXY_PREFIX}/${apiPath}`
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
    import.meta.env.DEV,
  )
}

export function isApiProxyAvailable(proxyConfig: DevProxyConfig | null = readClientDevProxyConfig()): boolean {
  return readRuntimeEnv(import.meta.env.VITE_API_PROXY_AVAILABLE) === 'true' || Boolean(proxyConfig?.enabled)
}

export function isApiProxyLocked(proxyConfig: DevProxyConfig | null = readClientDevProxyConfig()): boolean {
  return readRuntimeEnv(import.meta.env.VITE_API_PROXY_LOCKED) === 'true' && isApiProxyAvailable(proxyConfig)
}

export function shouldUseApiProxy(
  apiProxy: boolean,
  proxyConfig: DevProxyConfig | null = readClientDevProxyConfig(),
  provider?: string,
  baseUrl?: string,
): boolean {
  const isAPIMartOrDragonCode = provider === 'custom-dragoncode-gpt-image-2' ||
    (typeof baseUrl === 'string' && (baseUrl.toLowerCase().includes('dragoncode.codes') || baseUrl.toLowerCase().includes('api.apimart.ai')))

  if (isAPIMartOrDragonCode) {
    return isApiProxyAvailable(proxyConfig)
  }
  return isApiProxyAvailable(proxyConfig) && (apiProxy || isApiProxyLocked(proxyConfig))
}

export function getProxyImageUrl(url: string, profile: ApiProfile): string {
  const proxyConfig = readClientDevProxyConfig()
  const isHttp = url.startsWith('http://') || url.startsWith('https://')
  if (!shouldUseApiProxy(profile.apiProxy, proxyConfig, profile.provider, profile.baseUrl) || !isHttp) {
    return url
  }

  try {
    const imageUrl = new URL(url)
    const prefix = proxyConfig?.prefix ?? DEFAULT_PROXY_PREFIX

    // 针对龙码域名做特判保护，防止因 baseUrl 配置差异导致图片地址未能正确重写而跨域
    if (imageUrl.hostname.toLowerCase().includes('dragoncode.codes')) {
      const dragonCodeBase = 'https://dragoncode.codes/gpt-image'
      if (url.toLowerCase().startsWith(dragonCodeBase)) {
        return url.replace(new RegExp(dragonCodeBase, 'i'), prefix)
      }
    }

    const baseUrl = new URL(normalizeBaseUrl(profile.baseUrl))

    if (imageUrl.hostname.toLowerCase() === baseUrl.hostname.toLowerCase()) {
      const normalizedBase = normalizeBaseUrl(profile.baseUrl)
      const basePrefix = normalizedBase.endsWith('/v1')
        ? normalizedBase.slice(0, -3)
        : normalizedBase

      if (url.startsWith(basePrefix)) {
        return url.replace(basePrefix, prefix)
      }
    }
  } catch {
    // ignore URL parsing error
  }
  return url
}

