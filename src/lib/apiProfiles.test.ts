import { describe, expect, it } from 'vitest'
import type { ApiProfile } from '../types'
import { shouldUseApiProxy, getProxyImageUrl } from './devProxy'
import {
  DEFAULT_FAL_BASE_URL,
  DEFAULT_FAL_MODEL,
  DEFAULT_IMAGES_MODEL,
  DEFAULT_OPENAI_PROFILE_ID,
  DEFAULT_SETTINGS,
  createDefaultOpenAIProfile,
  createDefaultFalProfile,
  findEquivalentApiProfile,
  importCustomProviderDefinitionFromJson,
  importCustomProviderSettingsFromJson,
  mergeImportedSettings,
  normalizeSettings,
  switchApiProfileProvider,
  APIMART_PROVIDER_ID,
  APIMART_PROVIDER_DEFINITION,
  normalizeApiProfile,
} from './apiProfiles'

declare const process: {
  env: Record<string, string | undefined>
}

describe('mergeImportedSettings', () => {
  it('replaces the default OpenAI profile with legacy imported settings when current settings are untouched', () => {
    const merged = mergeImportedSettings(DEFAULT_SETTINGS, {
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'imported-key',
      model: 'imported-model',
      timeout: 120,
      apiMode: 'responses',
      codexCli: true,
      apiProxy: true,
    })

    expect(merged.profiles).toHaveLength(2)
    expect(merged.activeProfileId).toBe(DEFAULT_OPENAI_PROFILE_ID)
    expect(merged.profiles.find((p) => p.provider === 'openai')).toMatchObject({
      id: DEFAULT_OPENAI_PROFILE_ID,
      provider: 'openai',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'imported-key',
      model: 'imported-model',
      timeout: 120,
      apiMode: 'responses',
      codexCli: true,
      apiProxy: true,
    })
    expect(merged.profiles.find((p) => p.provider === APIMART_PROVIDER_ID)).toBeDefined()
  })

  it('replaces the default provider list with imported profiles when current settings are untouched', () => {
    const merged = mergeImportedSettings(DEFAULT_SETTINGS, {
      profiles: [
        {
          id: 'imported-openai',
          name: 'Imported OpenAI',
          provider: 'openai',
          baseUrl: 'https://api.example.com/v1',
          apiKey: 'openai-key',
          model: DEFAULT_IMAGES_MODEL,
          timeout: 300,
          apiMode: 'images',
          codexCli: false,
          apiProxy: false,
        },
        {
          id: 'imported-fal',
          name: 'Imported fal',
          provider: 'fal',
          baseUrl: DEFAULT_FAL_BASE_URL,
          apiKey: 'fal-key',
          model: DEFAULT_FAL_MODEL,
          timeout: 300,
          apiMode: 'images',
          codexCli: false,
          apiProxy: false,
        },
      ],
      activeProfileId: 'imported-fal',
    })

    expect(merged.profiles).toHaveLength(3)
    expect(merged.profiles.map((profile) => profile.id)).toContain('imported-openai')
    expect(merged.profiles.map((profile) => profile.id)).toContain('imported-fal')
    expect(merged.activeProfileId).toBe('imported-fal')
  })

  it('deduplicates imported profiles when replacing untouched default settings', () => {
    const merged = mergeImportedSettings(DEFAULT_SETTINGS, {
      profiles: [
        {
          id: 'imported-openai-a',
          name: 'Imported OpenAI A',
          provider: 'openai',
          baseUrl: 'https://api.example.com/v1',
          apiKey: 'openai-key',
          model: DEFAULT_IMAGES_MODEL,
          timeout: 300,
          apiMode: 'images',
          codexCli: false,
          apiProxy: false,
        },
        {
          id: 'imported-openai-b',
          name: 'Imported OpenAI B',
          provider: 'openai',
          baseUrl: 'https://api.example.com/v1/',
          apiKey: 'openai-key',
          model: DEFAULT_IMAGES_MODEL,
          timeout: 600,
          apiMode: 'images',
          codexCli: true,
          apiProxy: true,
        },
      ],
      activeProfileId: 'imported-openai-b',
    })

    expect(merged.profiles).toHaveLength(2)
    expect(merged.profiles.find((p) => p.id === 'imported-openai-a')).toBeDefined()
    expect(merged.activeProfileId).toBe('imported-openai-a')
  })

  it('appends imported legacy settings as a new profile when current settings are customized', () => {
    const current = mergeImportedSettings(DEFAULT_SETTINGS, {
      baseUrl: 'https://current.example.com/v1',
      apiKey: 'current-key',
      model: 'current-model',
    })
    const merged = mergeImportedSettings(current, {
      baseUrl: 'https://imported.example.com/v1',
      apiKey: 'imported-key',
      model: 'imported-model',
    })

    expect(merged.profiles).toHaveLength(3)
    expect(merged.activeProfileId).toBe(DEFAULT_OPENAI_PROFILE_ID)
    expect(merged.profiles[0]).toMatchObject({ apiKey: 'current-key', model: 'current-model' })
    expect(merged.profiles.find((p) => p.baseUrl === 'https://imported.example.com/v1')).toMatchObject({
      provider: 'openai',
      baseUrl: 'https://imported.example.com/v1',
      apiKey: 'imported-key',
      model: 'imported-model',
    })
  })

  it('appends imported profiles as new profiles when current settings are customized', () => {
    const current = mergeImportedSettings(DEFAULT_SETTINGS, {
      baseUrl: 'https://current.example.com/v1',
      apiKey: 'current-key',
      model: 'current-model',
    })
    const merged = mergeImportedSettings(current, {
      profiles: [
        {
          id: 'imported-openai',
          name: 'Imported OpenAI',
          provider: 'openai',
          baseUrl: 'https://imported.example.com/v1',
          apiKey: 'imported-key',
          model: DEFAULT_IMAGES_MODEL,
          timeout: 300,
          apiMode: 'images',
          codexCli: false,
          apiProxy: false,
        },
        {
          id: 'imported-fal',
          name: 'Imported fal',
          provider: 'fal',
          baseUrl: DEFAULT_FAL_BASE_URL,
          apiKey: 'fal-key',
          model: DEFAULT_FAL_MODEL,
          timeout: 300,
          apiMode: 'images',
          codexCli: false,
          apiProxy: false,
        },
      ],
      activeProfileId: 'imported-fal',
    })

    expect(merged.profiles).toHaveLength(4)
    expect(merged.activeProfileId).toBe(DEFAULT_OPENAI_PROFILE_ID)
    expect(merged.profiles[0]).toMatchObject({ apiKey: 'current-key', model: 'current-model' })
    expect(merged.profiles.find((p) => p.name === 'Imported OpenAI')).toMatchObject({ name: 'Imported OpenAI', provider: 'openai', apiKey: 'imported-key' })
    expect(merged.profiles.find((p) => p.name === 'Imported fal')).toMatchObject({ name: 'Imported fal', provider: 'fal', apiKey: 'fal-key' })
    expect(new Set(merged.profiles.map((profile) => profile.id)).size).toBe(4)
  })

  it('skips imported profiles that already exist in current customized settings', () => {
    const current = mergeImportedSettings(DEFAULT_SETTINGS, {
      baseUrl: 'https://current.example.com/v1',
      apiKey: 'current-key',
      model: 'current-model',
    })
    const merged = mergeImportedSettings(current, {
      profiles: [
        {
          id: 'duplicate-openai',
          name: 'Duplicate OpenAI',
          provider: 'openai',
          baseUrl: 'https://current.example.com/v1/',
          apiKey: 'current-key',
          model: 'current-model',
          timeout: 600,
          apiMode: 'images',
          codexCli: true,
          apiProxy: true,
        },
        {
          id: 'new-fal',
          name: 'New fal',
          provider: 'fal',
          baseUrl: DEFAULT_FAL_BASE_URL,
          apiKey: 'fal-key',
          model: DEFAULT_FAL_MODEL,
          timeout: 300,
          apiMode: 'images',
          codexCli: false,
          apiProxy: false,
        },
      ],
    })

    expect(merged.profiles).toHaveLength(3)
    expect(merged.profiles[0]).toMatchObject({ apiKey: 'current-key', model: 'current-model' })
    expect(merged.profiles.find((p) => p.name === 'New fal')).toMatchObject({ provider: 'fal', apiKey: 'fal-key', model: DEFAULT_FAL_MODEL })
  })

  it('reuses an existing keyed profile when importing the same custom profile without an API key', () => {
    const current = mergeImportedSettings(DEFAULT_SETTINGS, {
      customProviders: [{
        id: 'custom-json',
        name: 'Custom JSON',
        submit: {
          path: 'images/generations',
          method: 'POST',
          contentType: 'json',
          body: { model: '$profile.model', prompt: '$prompt' },
          result: { imageUrlPaths: ['data.*.url'], b64JsonPaths: [] },
        },
      }],
      profiles: [{
        id: 'existing-custom',
        name: 'Existing Custom',
        provider: 'custom-json',
        baseUrl: 'https://custom.example.com/v1',
        apiKey: 'existing-key',
        model: 'custom-model',
        timeout: 300,
        apiMode: 'images',
        codexCli: false,
        apiProxy: false,
      }],
      activeProfileId: 'existing-custom',
    })
    const imported = normalizeSettings({
      customProviders: [{
        id: 'custom-json',
        name: 'Custom JSON',
        submit: {
          path: 'images/generations',
          method: 'POST',
          contentType: 'json',
          body: { model: '$profile.model', prompt: '$prompt' },
          result: { imageUrlPaths: ['data.*.url'], b64JsonPaths: [] },
        },
      }],
      profiles: [{
        id: 'imported-custom',
        name: 'Imported Custom',
        provider: 'custom-json',
        baseUrl: 'https://custom.example.com/v1',
        apiKey: '',
        model: 'custom-model',
        timeout: 300,
        apiMode: 'images',
        codexCli: false,
        apiProxy: false,
      }],
    })
    const merged = mergeImportedSettings(current, imported)
    const match = findEquivalentApiProfile(merged, imported.profiles[0], imported.customProviders)

    expect(merged.profiles).toHaveLength(2)
    expect(match?.id).toBe('existing-custom')
  })

  it('does not replace existing custom providers when only the default profile remains', () => {
    const current = normalizeSettings({
      ...DEFAULT_SETTINGS,
      customProviders: [{
        id: 'custom-existing',
        name: 'Existing Provider',
        submit: { path: 'images/generations' },
      }],
    })
    const merged = mergeImportedSettings(current, {
      customProviders: [{
        id: 'custom-imported',
        name: 'Imported Provider',
        submit: { path: 'images/generations' },
      }],
      profiles: [{
        id: 'imported-custom',
        name: 'Imported Custom',
        provider: 'custom-imported',
        baseUrl: 'https://custom.example.com/v1',
        apiKey: '',
        model: 'custom-model',
        timeout: 300,
        apiMode: 'images',
        codexCli: false,
        apiProxy: false,
      }],
    })

    expect(merged.customProviders.map((provider) => provider.id)).toEqual(['custom-existing', APIMART_PROVIDER_ID, 'custom-imported'])
    expect(merged.profiles).toHaveLength(3)
  })

  it('appends imported custom providers and keeps imported custom profile references', () => {
    const current = mergeImportedSettings(DEFAULT_SETTINGS, {
      baseUrl: 'https://current.example.com/v1',
      apiKey: 'current-key',
      model: 'current-model',
    })
    const merged = mergeImportedSettings(current, {
      customProviders: [{
        id: 'custom-json',
        name: 'Custom JSON',
        submit: {
          path: 'images/generations',
          method: 'POST',
          contentType: 'json',
          body: { model: '$profile.model', prompt: '$prompt' },
          result: { imageUrlPaths: ['data.*.url'], b64JsonPaths: [] },
        },
      }],
      profiles: [{
        id: 'imported-custom',
        name: 'Imported Custom',
        provider: 'custom-json',
        baseUrl: 'https://custom.example.com/v1',
        apiKey: 'custom-key',
        model: 'custom-model',
        timeout: 300,
        apiMode: 'images',
        codexCli: false,
        apiProxy: false,
      }],
    })

    expect(merged.customProviders).toHaveLength(2)
    expect(merged.customProviders.find((p) => p.id === 'custom-json')).toMatchObject({ id: 'custom-json', name: 'Custom JSON' })
    expect(merged.profiles).toHaveLength(3)
    expect(merged.profiles.find((p) => p.id.startsWith('custom-json-imported'))).toMatchObject({
      name: 'Imported Custom',
      provider: 'custom-json',
      apiKey: 'custom-key',
      model: 'custom-model',
    })
  })
})

describe('custom providers', () => {
  it('normalizes custom provider definitions and keeps custom profiles', () => {
    const settings = normalizeSettings({
      customProviders: [{
        id: 'custom-async',
        name: 'Custom Async',
        template: 'openai-compatible-async',
        generationPath: '/v1/images/generations',
        editPath: '/v1/images/edits',
        taskPath: '/v1/images/tasks/{task_id}',
      }],
      profiles: [{
        id: 'profile-custom',
        name: 'Custom Profile',
        provider: 'custom-async',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'key',
        model: 'model',
        timeout: 60,
        apiMode: 'images',
        codexCli: false,
        apiProxy: false,
      }],
      activeProfileId: 'profile-custom',
    })

    expect(settings.customProviders[0]).toMatchObject({
      id: 'custom-async',
      template: 'http-image',
      submit: {
        path: 'images/generations',
        query: { async: 'true' },
        taskIdPath: 'data',
      },
      editSubmit: {
        path: 'images/edits',
        query: { async: 'true' },
        taskIdPath: 'data',
      },
      poll: {
        path: 'images/tasks/{task_id}',
      },
    })
    expect(settings.profiles[0].provider).toBe('custom-async')
  })

  it('normalizes an Apimart-style task manifest', () => {
    const provider = importCustomProviderDefinitionFromJson(JSON.stringify({
      name: 'Apimart GPT-Image-2',
      template: 'http-image',
      submit: {
        path: '/v1/images/generations',
        method: 'POST',
        contentType: 'json',
        body: {
          model: '$profile.model',
          prompt: '$prompt',
          n: '$params.n',
          size: '$params.size',
          resolution: '2k',
          image_urls: '$inputImages.dataUrls',
        },
        taskIdPath: 'data.0.task_id',
      },
      poll: {
        path: '/v1/tasks/{task_id}',
        method: 'GET',
        query: { language: 'zh' },
        statusPath: 'data.status',
        successValues: ['completed'],
        failureValues: ['failed', 'cancelled'],
        result: {
          imageUrlPaths: ['data.result.images.*.url.*'],
        },
      },
    }))

    expect(provider).toMatchObject({
      template: 'http-image',
      submit: {
        path: 'images/generations',
        taskIdPath: 'data.0.task_id',
      },
      poll: {
        path: 'tasks/{task_id}',
        query: { language: 'zh' },
        successValues: ['completed'],
        result: {
          imageUrlPaths: ['data.result.images.*.url.*'],
        },
      },
    })
  })

  it('imports wrapped custom provider settings with profiles', () => {
    const imported = importCustomProviderSettingsFromJson(JSON.stringify({
      customProviders: [{
        id: 'custom-json',
        name: 'Custom JSON',
        submit: {
          path: 'images/generations',
          method: 'POST',
          contentType: 'json',
          body: { model: '$profile.model', prompt: '$prompt' },
          result: { imageUrlPaths: ['data.*.url'], b64JsonPaths: [] },
        },
      }],
      profiles: [{
        name: 'Custom JSON',
        provider: 'custom-json',
        baseUrl: 'https://custom.example.com/v1',
        model: 'custom-model',
        apiMode: 'images',
      }],
    }))

    expect(imported.customProviders[0]).toMatchObject({ id: 'custom-json', name: 'Custom JSON' })
    expect(imported.profiles[0]).toMatchObject({
      name: 'Custom JSON',
      provider: 'custom-json',
      baseUrl: 'https://custom.example.com/v1',
      apiKey: '',
      model: 'custom-model',
      apiMode: 'images',
    })
  })

  it('imports wrapped custom provider settings from a json code block', () => {
    const imported = importCustomProviderSettingsFromJson(`\`\`\`json
{"customProviders":[{"id":"custom-json","name":"Custom JSON","submit":{"path":"images/generations","method":"POST","contentType":"json","body":{"model":"$profile.model","prompt":"$prompt"},"result":{"imageUrlPaths":["data.result.images.*.url.*"],"b64JsonPaths":[]}}}],"profiles":[{"name":"Custom JSON","provider":"custom-json","baseUrl":"https://custom.example.com/v1","model":"custom-model","apiMode":"images"}]}
\`\`\``)

    expect(imported.customProviders[0]).toMatchObject({ id: 'custom-json' })
    expect(imported.customProviders[0].submit.result).toMatchObject({
      imageUrlPaths: ['data.result.images.*.url.*'],
    })
    expect(imported.profiles[0]).toMatchObject({
      provider: 'custom-json',
      baseUrl: 'https://custom.example.com/v1',
    })
  })

  it('rejects markdown-corrupted profile fields when importing wrapped settings', () => {
    expect(() => importCustomProviderSettingsFromJson(JSON.stringify({
      customProviders: [{
        id: 'custom-apimart',
        name: 'APIMart',
        submit: { path: 'images/generations' },
      }],
      profiles: [{
        name: 'APIMart',
        provider: 'custom-apimart',
        baseUrl: '[https://api.apimart.ai/v1',
        model: 'gpt-image-2-official',
        apiMode: 'images](https://api.apimart.ai/v1%22,%22model%22:%22gpt-image-2-official%22,%22apiMode%22:%22images)',
      }],
    }))).toThrow('JSON 包含 Markdown 链接')
  })

  it('does not inherit fal URL and model when switching to a custom provider', () => {
    const provider = importCustomProviderDefinitionFromJson(JSON.stringify({
      name: 'Custom Provider',
      template: 'http-image',
      submit: { path: 'images/generations' },
    }))
    const profile = switchApiProfileProvider(createDefaultFalProfile(), provider.id, provider)

    expect(profile.provider).toBe(provider.id)
    expect(profile.baseUrl).toBe(DEFAULT_SETTINGS.baseUrl)
    expect(profile.model).toBe(DEFAULT_IMAGES_MODEL)
  })

  it('enables streaming by default and preserves partial image count', () => {
    expect(createDefaultOpenAIProfile().streamImages).toBe(true)
    expect(createDefaultOpenAIProfile().streamPartialImages).toBe(1)
    expect(DEFAULT_SETTINGS.streamImages).toBe(true)
    expect(DEFAULT_SETTINGS.streamPartialImages).toBe(1)
    expect(DEFAULT_SETTINGS.profiles[0].streamImages).toBe(true)
    expect(DEFAULT_SETTINGS.profiles[0].streamPartialImages).toBe(1)

    const normalized = normalizeSettings({
      profiles: [
        createDefaultOpenAIProfile({ streamImages: false, streamPartialImages: 3 }),
      ],
    })

    expect(normalized.streamImages).toBe(false)
    expect(normalized.streamPartialImages).toBe(3)
    expect(normalized.profiles[0].streamImages).toBe(false)
    expect(normalized.profiles[0].streamPartialImages).toBe(3)

    const clamped = normalizeSettings({
      profiles: [
        createDefaultOpenAIProfile({ streamPartialImages: 8 }),
      ],
    })

    expect(clamped.profiles[0].streamPartialImages).toBe(3)
  })

  it('restores OpenAI-compatible URL after switching through fal.ai', () => {
    const openaiProfile = createDefaultOpenAIProfile({
      baseUrl: 'https://api.compat.example.com/v1',
      model: 'custom-openai-model',
      apiProxy: false,
    })

    const falProfile = switchApiProfileProvider(openaiProfile, 'fal')
    const restoredProfile = switchApiProfileProvider(falProfile, 'openai')

    expect(falProfile.baseUrl).toBe(DEFAULT_FAL_BASE_URL)
    expect(restoredProfile.baseUrl).toBe('https://api.compat.example.com/v1')
    expect(restoredProfile.model).toBe('custom-openai-model')
    expect(restoredProfile.apiProxy).toBe(false)
  })

  describe('built-in APIMart provider', () => {
    it('automatically registers APIMart provider and default profile', () => {
      const settings = normalizeSettings({})
      expect(settings.customProviders.some((p) => p.id === APIMART_PROVIDER_ID)).toBe(true)
      expect(settings.profiles.some((p) => p.provider === APIMART_PROVIDER_ID)).toBe(true)

      const dragoncodeProfile = settings.profiles.find((p) => p.provider === APIMART_PROVIDER_ID)
      expect(dragoncodeProfile?.baseUrl).toBe('https://api.apimart.ai/v1')
      expect(dragoncodeProfile?.model).toBe('gpt-image-2')
    })

    it('sets correct baseUrl and model when switching provider to APIMart', () => {
      const initial = createDefaultOpenAIProfile()
      const provider = APIMART_PROVIDER_DEFINITION
      const profile = switchApiProfileProvider(initial, provider.id, provider)

      expect(profile.provider).toBe(provider.id)
      expect(profile.baseUrl).toBe('https://api.apimart.ai/v1')
      expect(profile.model).toBe('gpt-image-2')
    })

    it('automatically updates an existing cached APIMart provider definition to the latest', () => {
      const outdatedProvider = {
        id: APIMART_PROVIDER_ID,
        name: 'Old APIMart',
        submit: {
          path: 'old/generations',
          result: { imageUrlPaths: [] },
        },
      }
      const settings = normalizeSettings({
        customProviders: [outdatedProvider],
      })
      const resolved = settings.customProviders.find((p) => p.id === APIMART_PROVIDER_ID)
      expect(resolved).toBeDefined()
      expect(resolved?.name).toBe('APIMart GPT-Image-2')
      expect(resolved?.submit.path).toBe('images/generations')
      expect(resolved?.poll).toBeDefined()
    })

    it('automatically corrects provider to APIMart when the profile baseUrl belongs to APIMart', () => {
      const customProviderIds = new Set<string>([APIMART_PROVIDER_ID])
      const normalized = normalizeApiProfile({
        id: 'test-profile',
        name: 'My APIMart',
        provider: 'openai',
        baseUrl: 'https://api.apimart.ai/v1',
        apiKey: 'sk-apimart',
        model: 'gpt-image-2',
      }, undefined, customProviderIds)

      expect(normalized.provider).toBe(APIMART_PROVIDER_ID)
      expect(normalized.baseUrl).toBe('https://api.apimart.ai/v1')
      expect(normalized.model).toBe('gpt-image-2')
      expect(normalized.streamImages).toBe(false)
    })

    it('sets apiProxy based on proxy availability when switching provider to APIMart', () => {
      const originalEnv = process.env.VITE_API_PROXY_AVAILABLE
      process.env.VITE_API_PROXY_AVAILABLE = 'true'
      try {
        const initial = createDefaultOpenAIProfile()
        const provider = APIMART_PROVIDER_DEFINITION
        const profile = switchApiProfileProvider(initial, provider.id, provider)
        expect(profile.apiProxy).toBe(true)
      } finally {
        process.env.VITE_API_PROXY_AVAILABLE = originalEnv
      }
    })

    it('sets apiProxy to true when normalizing APIMart profile if system proxy is available and record lacks apiProxy', () => {
      const originalEnv = process.env.VITE_API_PROXY_AVAILABLE
      process.env.VITE_API_PROXY_AVAILABLE = 'true'
      try {
        const customProviderIds = new Set<string>([APIMART_PROVIDER_ID])
        const normalized = normalizeApiProfile({
          id: 'test-profile',
          name: 'My APIMart',
          provider: APIMART_PROVIDER_ID,
          baseUrl: 'https://api.apimart.ai/v1',
          apiKey: 'sk-apimart',
          model: 'gpt-image-2',
        }, undefined, customProviderIds)
        expect(normalized.apiProxy).toBe(true)
      } finally {
        process.env.VITE_API_PROXY_AVAILABLE = originalEnv
      }
    })

    it('forces apiProxy to true when normalizing APIMart profile if system proxy is available even if record explicitly sets apiProxy to false', () => {
      const originalEnv = process.env.VITE_API_PROXY_AVAILABLE
      process.env.VITE_API_PROXY_AVAILABLE = 'true'
      try {
        const customProviderIds = new Set<string>([APIMART_PROVIDER_ID])
        const normalized = normalizeApiProfile({
          id: 'test-profile',
          name: 'My APIMart',
          provider: APIMART_PROVIDER_ID,
          baseUrl: 'https://api.apimart.ai/v1',
          apiKey: 'sk-apimart',
          model: 'gpt-image-2',
          apiProxy: false,
        }, undefined, customProviderIds)
        expect(normalized.apiProxy).toBe(true)
      } finally {
        process.env.VITE_API_PROXY_AVAILABLE = originalEnv
      }
    })

    it('forces apiProxy to true when switching provider to APIMart even if draft explicitly sets apiProxy to false', () => {
      const originalEnv = process.env.VITE_API_PROXY_AVAILABLE
      process.env.VITE_API_PROXY_AVAILABLE = 'true'
      try {
        const initial = createDefaultOpenAIProfile()
        const provider = APIMART_PROVIDER_DEFINITION
        const profileWithDraft: ApiProfile = {
          ...initial,
          providerDrafts: {
            [provider.id]: {
              baseUrl: 'https://api.apimart.ai/v1',
              model: 'gpt-image-2',
              apiMode: 'images',
              apiProxy: false,
            }
          }
        }
        const profile = switchApiProfileProvider(profileWithDraft, provider.id, provider)
        expect(profile.apiProxy).toBe(true)
      } finally {
        process.env.VITE_API_PROXY_AVAILABLE = originalEnv
      }
    })

    it('forces shouldUseApiProxy to true when provider or baseUrl is APIMart/APIMart if system proxy is available', () => {
      const originalEnv = process.env.VITE_API_PROXY_AVAILABLE
      process.env.VITE_API_PROXY_AVAILABLE = 'true'
      try {
        expect(shouldUseApiProxy(false, null, APIMART_PROVIDER_ID)).toBe(true)
        expect(shouldUseApiProxy(false, null, 'some-other-provider', 'https://api.apimart.ai/v1')).toBe(true)
        expect(shouldUseApiProxy(false, null, 'some-other-provider', 'https://api.apimart.ai/v1')).toBe(true)
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
          ...createDefaultOpenAIProfile(),
          provider: 'some-custom-provider',
          baseUrl: 'https://dragoncode.codes/v1',
          apiProxy: false,
        }
        
        const imageUrl = 'https://dragoncode.codes/gpt-image/media/task_01KS7ZSKETT22WW3FYF5MTB486/0?token=abc'
        const proxied = getProxyImageUrl(imageUrl, profile)
        expect(proxied).toBe('/api-proxy/media/task_01KS7ZSKETT22WW3FYF5MTB486/0?token=abc')
      } finally {
        process.env.VITE_API_PROXY_AVAILABLE = originalEnv
      }
    })
  })
})
