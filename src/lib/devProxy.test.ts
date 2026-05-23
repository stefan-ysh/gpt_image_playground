import { describe, expect, it, vi, afterEach } from 'vitest'
import { buildApiUrl, getProxyImageUrl } from './devProxy'

describe('buildApiUrl', () => {
  it('uses the same-origin proxy prefix when API proxy is enabled', () => {
    expect(buildApiUrl('http://api.example.com/v1', 'images/edits', null, true)).toBe(
      '/api-proxy/images/edits',
    )
  })

  it('keeps the v1 segment when the configured API URL does not include it', () => {
    expect(buildApiUrl('http://api.example.com', 'images/generations', null, true)).toBe(
      '/api-proxy/v1/images/generations',
    )
  })

  it('uses a configured proxy prefix when one is available', () => {
    expect(
      buildApiUrl(
        'http://api.example.com/v1',
        'responses',
        {
          enabled: true,
          prefix: '/openai-proxy',
          target: 'http://api.example.com/v1',
          changeOrigin: true,
          secure: false,
        },
        true,
      ),
    ).toBe('/openai-proxy/responses')
  })

  it('uses the configured API URL directly when API proxy is disabled', () => {
    expect(buildApiUrl('http://api.example.com/v1', 'responses', null, false)).toBe(
      'http://api.example.com/v1/responses',
    )
  })
})

describe('getProxyImageUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('returns the original URL when API proxy is disabled', () => {
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'false')
    vi.stubGlobal('__DEV_PROXY_CONFIG__', null)

    const url = 'https://dragoncode.codes/gpt-image/media/task_01KS7ZSKETT22WW3FYF5MTB486/0'
    const profile = {
      apiProxy: false,
      baseUrl: 'https://api.apimart.ai/v1',
    } as any

    expect(getProxyImageUrl(url, profile)).toBe(url)
  })

  it('proxies image URL matching baseUrl domain when proxy is enabled', () => {
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'true')
    vi.stubGlobal('__DEV_PROXY_CONFIG__', {
      enabled: true,
      prefix: '/api-proxy',
      target: 'https://api.apimart.ai/v1',
      changeOrigin: true,
      secure: false,
    })

    const url = 'https://dragoncode.codes/gpt-image/media/task_01KS7ZSKETT22WW3FYF5MTB486/0'
    const profile = {
      apiProxy: true,
      baseUrl: 'https://api.apimart.ai/v1',
    } as any

    expect(getProxyImageUrl(url, profile)).toBe(
      '/api-proxy/media/task_01KS7ZSKETT22WW3FYF5MTB486/0',
    )
  })

  it('does not proxy image URL if domains do not match', () => {
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'true')
    vi.stubGlobal('__DEV_PROXY_CONFIG__', {
      enabled: true,
      prefix: '/api-proxy',
      target: 'https://api.apimart.ai/v1',
      changeOrigin: true,
      secure: false,
    })

    const url = 'https://otherdomain.com/gpt-image/media/task_01KS7ZSKETT22WW3FYF5MTB486/0'
    const profile = {
      apiProxy: true,
      baseUrl: 'https://api.apimart.ai/v1',
    } as any

    expect(getProxyImageUrl(url, profile)).toBe(url)
  })

  it('handles non-HTTP URLs safely', () => {
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'true')
    vi.stubGlobal('__DEV_PROXY_CONFIG__', {
      enabled: true,
      prefix: '/api-proxy',
      target: 'https://api.apimart.ai/v1',
    })

    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    const profile = {
      apiProxy: true,
      baseUrl: 'https://api.apimart.ai/v1',
    } as any

    expect(getProxyImageUrl(dataUrl, profile)).toBe(dataUrl)
  })
})
