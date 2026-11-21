import { describe, expect, it } from 'vitest'
import { shouldUseApiProxy, getProxyImageUrl } from './devProxy'
import { getActiveBaseUrl } from './env'
import {
  DEFAULT_SETTINGS,
  createDefaultDragonCodeProfile,
  findEquivalentApiProfile,
  mergeImportedSettings,
  normalizeSettings,
  switchApiProfileProvider,
  DRAGONCODE_PROVIDER_ID,
  DRAGONCODE_PROVIDER_DEFINITION,
  FREEGEN_BASE_URL,
  FREEGEN_INTERNAL_API_KEY,
  FREEGEN_MODEL,
  FREEGEN_PROVIDER_ID,
  normalizeApiProfile,
  validateApiProfile,
} from './apiProfiles'

declare const process: {
  env: Record<string, string | undefined>
}

describe('apiProfiles', () => {
  it('automatically registers DragonCode provider and default profile', () => {
    const settings = normalizeSettings({})
    expect(settings.customProviders.some((p) => p.id === DRAGONCODE_PROVIDER_ID)).toBe(true)
    expect(settings.profiles.some((p) => p.provider === DRAGONCODE_PROVIDER_ID)).toBe(true)

    const dragoncodeProfile = settings.profiles.find((p) => p.provider === DRAGONCODE_PROVIDER_ID)
    expect(dragoncodeProfile?.baseUrl).toBe(getActiveBaseUrl())
    expect(dragoncodeProfile?.model).toBe('gpt-image-2')
  })

  it('sets correct baseUrl and model when switching provider to DragonCode', () => {
    const initial = createDefaultDragonCodeProfile()
    const provider = DRAGONCODE_PROVIDER_DEFINITION
    const profile = switchApiProfileProvider(initial, provider.id, provider)

    expect(profile.provider).toBe(provider.id)
    expect(profile.baseUrl).toBe(getActiveBaseUrl())
    expect(profile.model).toBe('gpt-image-2')
  })

  it('automatically updates an existing cached DragonCode provider definition to the latest', () => {
    const outdatedProvider = {
      id: DRAGONCODE_PROVIDER_ID,
      name: 'Old DragonCode',
      submit: {
        path: 'old/generations',
        result: { imageUrlPaths: [] },
      },
    }
    const settings = normalizeSettings({
      customProviders: [outdatedProvider],
    })
    const resolved = settings.customProviders.find((p) => p.id === DRAGONCODE_PROVIDER_ID)
    expect(resolved).toBeDefined()
    expect(resolved?.name).toBe('GPT-Image-2')
    expect(resolved?.submit.path).toBe('images/generations')
    expect(resolved?.poll).toBeDefined()
  })

  it('automatically corrects provider to DragonCode when the profile baseUrl belongs to DragonCode', () => {
    const customProviderIds = new Set<string>([DRAGONCODE_PROVIDER_ID])
    const normalized = normalizeApiProfile({
      id: 'test-profile',
      name: 'My DragonCode',
      provider: 'openai',
      baseUrl: 'https://dragoncode.codes/gpt-image/v1',
      apiKey: 'sk-dragoncode',
      model: 'gpt-image-2',
    }, undefined, customProviderIds)

    expect(normalized.provider).toBe(DRAGONCODE_PROVIDER_ID)
    expect(normalized.baseUrl).toBe('https://dragoncode.codes/gpt-image/v1')
    expect(normalized.model).toBe('gpt-image-2')
  })

  it('normalizes z-image to the internal Freegen provider without env API settings', () => {
    const normalized = normalizeApiProfile({
      id: 'freegen-profile',
      name: 'z-image',
      provider: 'openai',
      baseUrl: 'https://example.invalid/v1',
      apiKey: '',
      model: FREEGEN_MODEL,
    })

    expect(normalized.provider).toBe(FREEGEN_PROVIDER_ID)
    expect(normalized.baseUrl).toBe(FREEGEN_BASE_URL)
    expect(normalized.apiKey).toBe(FREEGEN_INTERNAL_API_KEY)
    expect(validateApiProfile(normalized)).toBeNull()
  })

  it('sets apiProxy based on proxy availability when switching provider to DragonCode', () => {
    const originalEnv = process.env.VITE_API_PROXY_AVAILABLE
    process.env.VITE_API_PROXY_AVAILABLE = 'true'
    try {
      const initial = createDefaultDragonCodeProfile()
      const provider = DRAGONCODE_PROVIDER_DEFINITION
      const profile = switchApiProfileProvider(initial, provider.id, provider)
      expect(profile.apiProxy).toBe(true)
    } finally {
      process.env.VITE_API_PROXY_AVAILABLE = originalEnv
    }
  })

  it('respects user apiProxy choice even when provider or baseUrl is DragonCode', () => {
    const originalEnv = process.env.VITE_API_PROXY_AVAILABLE
    process.env.VITE_API_PROXY_AVAILABLE = 'true'
    try {
      expect(shouldUseApiProxy(false, null, DRAGONCODE_PROVIDER_ID)).toBe(false)
      expect(shouldUseApiProxy(true, null, DRAGONCODE_PROVIDER_ID)).toBe(true)
      expect(shouldUseApiProxy(false, null, 'some-other-provider', 'https://dragoncode.codes/gpt-image/v1')).toBe(false)
      expect(shouldUseApiProxy(true, null, 'some-other-provider', 'https://dragoncode.codes/gpt-image/v1')).toBe(true)
      expect(shouldUseApiProxy(false, null, 'some-other-provider', 'https://api.openai.com/v1')).toBe(false)
      expect(shouldUseApiProxy(true, null, 'some-other-provider', 'https://api.openai.com/v1')).toBe(true)
    } finally {
      process.env.VITE_API_PROXY_AVAILABLE = originalEnv
    }
  })

  it('rewrites DragonCode image URL correctly via getProxyImageUrl under proxy', () => {
    const originalEnv = process.env.VITE_API_PROXY_AVAILABLE
    process.env.VITE_API_PROXY_AVAILABLE = 'true'
    try {
      const profile = {
        ...createDefaultDragonCodeProfile(),
        provider: 'some-custom-provider',
        baseUrl: 'https://dragoncode.codes/v1',
        apiProxy: true,
      }

      const imageUrl = 'https://dragoncode.codes/gpt-image/media/task_01KS7ZSKETT22WW3FYF5MTB486/0?token=abc'
      const proxied = getProxyImageUrl(imageUrl, profile)
      expect(proxied).toBe('/api/proxy?target=https%3A%2F%2Fdragoncode.codes%2Fgpt-image&path=media%2Ftask_01KS7ZSKETT22WW3FYF5MTB486%2F0%3Ftoken%3Dabc')
    } finally {
      process.env.VITE_API_PROXY_AVAILABLE = originalEnv
    }
  })
})
