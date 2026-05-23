import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { createDefaultFalProfile, createDefaultOpenAIProfile, DEFAULT_SETTINGS, normalizeSettings } from './apiProfiles'
import { normalizeParamsForSettings } from './paramCompatibility'

describe('parameter compatibility', () => {
  it('forces output image count n to 1', () => {
    const openAIProfile = createDefaultOpenAIProfile({ apiKey: 'test-key', streamImages: false })
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: [openAIProfile],
      activeProfileId: openAIProfile.id,
    })

    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, n: 12 }, settings).n).toBe(1)
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, n: 4 }, settings).n).toBe(1)
  })

  it('only replaces fal.ai auto size in text-to-image mode', () => {
    const falProfile = createDefaultFalProfile({ apiKey: 'fal-key' })
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: [falProfile],
      activeProfileId: falProfile.id,
    })

    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, size: 'auto' }, settings).size).toBe('1360x1024')
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, size: 'auto' }, settings, { hasInputImages: true }).size).toBe('auto')
  })

  it('downgrades APIMart 4k quality to medium if ratio is unsupported', () => {
    const apiMartProfile = {
      id: 'apimart-profile',
      name: 'APIMart Test',
      provider: 'custom-dragoncode-gpt-image-2',
      baseUrl: 'https://api.apimart.ai/v1',
      apiKey: 'sk-apimart',
      model: 'gpt-image-2',
    } as any
    const settings = {
      ...DEFAULT_SETTINGS,
      profiles: [apiMartProfile],
      activeProfileId: apiMartProfile.id,
    }

    // 16:9 支持 4k
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, size: '1920x1080', quality: 'high' }, settings).quality).toBe('high')
    // 5:3 不支持 4k
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, size: '1280x768', quality: 'high' }, settings).quality).toBe('medium')
    // 数量参数 n 恒锁定为 1
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, n: 3 }, settings).n).toBe(1)
  })
})
