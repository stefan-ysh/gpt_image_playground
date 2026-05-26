import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, DEFAULT_STREAM_PARTIAL_IMAGES } from '../types'
import type { ApiProfile } from '../types'
import { DEFAULT_SETTINGS } from './apiProfiles'
import { getActiveBaseUrl } from './env'
import { normalizeParamsForSettings } from './paramCompatibility'

describe('parameter compatibility', () => {
  it('downgrades APIMart 4k resolution to 2k if ratio is unsupported', () => {
    const apiMartProfile: ApiProfile = {
      id: 'apimart-profile',
      name: 'APIMart Test',
      provider: 'custom-dragoncode-gpt-image-2',
      baseUrl: getActiveBaseUrl(),
      apiKey: 'sk-apimart',
      model: 'gpt-image-2',
      timeout: 600,
      apiMode: 'images',
      apiProxy: false,
      streamImages: false,
      streamPartialImages: DEFAULT_STREAM_PARTIAL_IMAGES,
    }
    const settings = {
      ...DEFAULT_SETTINGS,
      profiles: [apiMartProfile],
      activeProfileId: apiMartProfile.id,
    }

    // 16:9 支持 4k
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, size: '1920x1080', resolution: '4k' }, settings).resolution).toBe('4k')
    // 5:3 不支持 4k
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, size: '1280x768', resolution: '4k' }, settings).resolution).toBe('2k')
    // 数量参数 n 恒锁定为 1
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, n: 3 }, settings).n).toBe(1)
  })
})
