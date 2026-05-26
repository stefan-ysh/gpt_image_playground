import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  createDefaultAPIMartProfile,
} from './apiProfiles'
import { buildSettingsFromUrlParams, clearUrlSettingParams, hasUrlSettingParams } from './urlSettings'

describe('URL settings params', () => {
  it('creates and activates a new profile for legacy URL params', () => {
    const current = normalizeSettings(DEFAULT_SETTINGS)
    const next = normalizeSettings({
      ...current,
      ...buildSettingsFromUrlParams(current, new URLSearchParams('apiUrl=https://api.example.com/v1&apiKey=test-key')),
    })

    // 默认自带 1 个 APIMart profile，加上 URL 解析的共 2 个
    expect(next.profiles).toHaveLength(2)
    expect(next.activeProfileId).not.toBe(current.activeProfileId)
    const active = next.profiles.find((profile) => profile.id === next.activeProfileId)
    expect(active).toMatchObject({
      name: 'URL 参数配置',
      provider: 'custom-dragoncode-gpt-image-2',
      baseUrl: 'https://api.example.com/v1',
      apiKey: '',
      model: 'gpt-image-2',
    })
  })

  it('uses model from URL params for profiles', () => {
    const current = normalizeSettings(DEFAULT_SETTINGS)
    const next = normalizeSettings({
      ...current,
      ...buildSettingsFromUrlParams(current, new URLSearchParams('apiUrl=https://api.example.com/v1&apiKey=test-key&model=gemini-3-pro-image-preview')),
    })

    const active = next.profiles.find((profile) => profile.id === next.activeProfileId)
    expect(active).toMatchObject({
      provider: 'custom-dragoncode-gpt-image-2',
      baseUrl: 'https://api.example.com/v1',
      apiKey: '',
      model: 'gemini-3-pro-image-preview',
    })
  })

  it('clears known URL setting params without touching unrelated params', () => {
    const params = new URLSearchParams('apiUrl=https://api.example.com/v1&apiKey=test-key&model=test-model&foo=bar')

    expect(hasUrlSettingParams(params)).toBe(true)
    clearUrlSettingParams(params)

    expect(params.toString()).toBe('foo=bar')
  })
})
