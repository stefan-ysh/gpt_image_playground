import type {
  ApiMode,
  ApiProfile,
  ApiProvider,
  AppSettings,
  CustomProviderContentType,
  CustomProviderDefinition,
  CustomProviderFileMapping,
  CustomProviderPollMapping,
  CustomProviderRequestMethod,
  CustomProviderResultMapping,
  CustomProviderSubmitMapping,
  CustomProviderTemplate,
  ReferenceImageEditAction,
} from '../types'
import { DEFAULT_STREAM_PARTIAL_IMAGES } from '../types'
import { readRuntimeEnv } from './runtimeEnv'
import { isApiProxyAvailable } from './devProxy'
import { getActiveBaseUrl } from './env'

const DEFAULT_BASE_URL = readRuntimeEnv(
  process.env.NEXT_PUBLIC_DEFAULT_BASE_URL || 'https://api.openai.com/v1'
);

const DEFAULT_OPENAI_API_PROXY =
  readRuntimeEnv(
    process.env.NEXT_PUBLIC_API_PROXY_AVAILABLE || process.env.VITE_API_PROXY_AVAILABLE
  ) === 'true'
export const DEFAULT_IMAGES_MODEL = 'gpt-image-2'
export const DEFAULT_RESPONSES_MODEL = 'gpt-5.5'
export const DEFAULT_FAL_BASE_URL = 'https://fal.run'
export const DEFAULT_FAL_MODEL = 'openai/gpt-image-2'
export const DEFAULT_OPENAI_PROFILE_ID = 'default-openai'
export const DEFAULT_API_TIMEOUT = 600

export const APIMART_PROVIDER_ID = 'custom-dragoncode-gpt-image-2'

export function getDefaultApiKey(): string {
  return readRuntimeEnv(process.env.NEXT_PUBLIC_DEFAULT_API_KEY || '')
}

export const APIMART_PROVIDER_DEFINITION: CustomProviderDefinition = {
  id: APIMART_PROVIDER_ID,
  name: 'GPT-Image-2',
  template: 'http-image',
  submit: {
    path: 'images/generations',
    method: 'POST',
    contentType: 'json',
    body: {
      model: '$profile.model',
      prompt: '$prompt',
      size: '$params.sizeRatio',
      resolution: '$params.resolution',
      image_urls: '$inputImages.dataUrls',
      n: '$params.n',
      official_fallback: '$params.official_fallback',
    },
    taskIdPath: 'data.0.task_id',
    result: { imageUrlPaths: [], b64JsonPaths: [] },
  },
  poll: {
    path: 'tasks/{task_id}',
    method: 'GET',
    intervalSeconds: 5,
    statusPath: 'data.status',
    successValues: ['completed'],
    failureValues: ['failed', 'cancelled'],
    errorPath: 'data.error.message',
    result: {
      imageUrlPaths: [
        'data.result.images.*.url.*',
        'data.result.images.*.url',
      ],
      b64JsonPaths: [],
    },
  },
}

const BUILT_IN_PROVIDER_IDS = new Set<ApiProvider>([APIMART_PROVIDER_ID])
const DEFAULT_CUSTOM_PROVIDER_PATHS = {
  generationPath: 'images/generations',
  editPath: 'images/edits',
  taskPath: 'images/tasks/{task_id}',
}
const DEFAULT_GENERATE_BODY = {
  model: '$profile.model',
  prompt: '$prompt',
  size: '$params.size',
  resolution: '$params.resolution',
  output_format: '$params.output_format',
  moderation: '$params.moderation',
  output_compression: '$params.output_compression',
  n: '$params.n',
}
const DEFAULT_EDIT_BODY = DEFAULT_GENERATE_BODY
const DEFAULT_OPENAI_RESULT: CustomProviderResultMapping = {
  imageUrlPaths: ['data.*.url'],
  b64JsonPaths: ['data.*.b64_json'],
}
const DEFAULT_EDIT_FILES: CustomProviderFileMapping[] = [
  { field: 'image[]', source: 'inputImages', array: true },
  { field: 'mask', source: 'mask' },
]

type ApiProfileProviderDraft = NonNullable<ApiProfile['providerDrafts']>[ApiProvider]

export function normalizeStreamPartialImages(value: unknown, fallback: number | undefined = DEFAULT_STREAM_PARTIAL_IMAGES): number {
  const fallbackValue = fallback ?? DEFAULT_STREAM_PARTIAL_IMAGES
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return fallbackValue
  return Math.min(3, Math.max(0, Math.trunc(numeric)))
}

function normalizeReferenceImageEditAction(value: unknown): ReferenceImageEditAction {
  return value === 'replace-reference' || value === 'add-mask' ? value : 'ask'
}

function isCustomProviderTemplate(value: unknown): value is CustomProviderTemplate {
  return value === 'http-image'
}

function normalizeProviderPath(value: unknown, fallback: string): string {
  return (typeof value === 'string' && value.trim() ? value : fallback).trim().replace(/^\/+/, '').replace(/^v1\//, '')
}

function normalizeStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object') return undefined

  const entries = Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, string | number | boolean] =>
      typeof entry[0] === 'string' && ['string', 'number', 'boolean'].includes(typeof entry[1]),
    )
    .map(([key, item]) => [key, String(item)] as const)

  return entries.length ? Object.fromEntries(entries) : undefined
}

function normalizeStringArray(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim())
    : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeRequestMethod(value: unknown, fallback: CustomProviderRequestMethod = 'POST'): CustomProviderRequestMethod {
  return value === 'GET' || value === 'POST' ? value : fallback
}

function normalizeContentType(value: unknown, fallback: CustomProviderContentType = 'json'): CustomProviderContentType {
  return value === 'multipart' ? 'multipart' : fallback
}

function normalizeBodyTemplate(value: unknown, fallback: Record<string, unknown>): Record<string, unknown> {
  return isRecord(value) ? value : fallback
}

function normalizeFileMappings(value: unknown, fallback: CustomProviderFileMapping[] = []): CustomProviderFileMapping[] {
  if (!Array.isArray(value)) return fallback
  const files = value
    .map((item): CustomProviderFileMapping | null => {
      if (!isRecord(item) || typeof item.field !== 'string' || !item.field.trim()) return null
      if (item.source !== 'inputImages' && item.source !== 'mask') return null
      return {
        field: item.field.trim(),
        source: item.source,
        array: Boolean(item.array),
      }
    })
    .filter((item): item is CustomProviderFileMapping => Boolean(item))
  return files.length ? files : fallback
}

function normalizeResultMapping(value: unknown, fallback: CustomProviderResultMapping = DEFAULT_OPENAI_RESULT): CustomProviderResultMapping {
  const record = isRecord(value) ? value : {}
  const imageUrlPaths = normalizeStringArray(record.imageUrlPaths, fallback.imageUrlPaths ?? [])
  const b64JsonPaths = normalizeStringArray(record.b64JsonPaths, fallback.b64JsonPaths ?? [])
  return {
    imageUrlPaths,
    b64JsonPaths,
  }
}

function normalizeSubmitMapping(value: unknown, fallback: CustomProviderSubmitMapping): CustomProviderSubmitMapping {
  const record = isRecord(value) ? value : {}
  const contentType = normalizeContentType(record.contentType, fallback.contentType ?? 'json')
  return {
    path: normalizeProviderPath(record.path, fallback.path),
    method: normalizeRequestMethod(record.method, fallback.method ?? 'POST'),
    contentType,
    query: normalizeStringRecord(record.query) ?? fallback.query,
    body: normalizeBodyTemplate(record.body, fallback.body ?? (contentType === 'multipart' ? DEFAULT_EDIT_BODY : DEFAULT_GENERATE_BODY)),
    files: contentType === 'multipart' ? normalizeFileMappings(record.files, fallback.files) : undefined,
    taskIdPath: typeof record.taskIdPath === 'string' && record.taskIdPath.trim() ? record.taskIdPath.trim() : fallback.taskIdPath,
    result: normalizeResultMapping(record.result, fallback.result ?? DEFAULT_OPENAI_RESULT),
  }
}

function normalizePollMapping(value: unknown, fallback?: CustomProviderPollMapping): CustomProviderPollMapping | undefined {
  if (!isRecord(value) && !fallback) return undefined
  const record = isRecord(value) ? value : {}
  const path = normalizeProviderPath(record.path, fallback?.path ?? DEFAULT_CUSTOM_PROVIDER_PATHS.taskPath)
  const statusPath = typeof record.statusPath === 'string' && record.statusPath.trim() ? record.statusPath.trim() : fallback?.statusPath
  if (!statusPath) return undefined

  return {
    path,
    method: normalizeRequestMethod(record.method, fallback?.method ?? 'GET'),
    query: normalizeStringRecord(record.query) ?? fallback?.query,
    intervalSeconds: typeof record.intervalSeconds === 'number' && Number.isFinite(record.intervalSeconds)
      ? Math.max(1, record.intervalSeconds)
      : fallback?.intervalSeconds ?? 5,
    statusPath,
    successValues: normalizeStringArray(record.successValues, fallback?.successValues ?? ['SUCCESS', 'succeeded', 'completed', 'COMPLETED']),
    failureValues: normalizeStringArray(record.failureValues, fallback?.failureValues ?? ['FAILURE', 'failed', 'error', 'FAILED', 'cancelled']),
    errorPath: typeof record.errorPath === 'string' && record.errorPath.trim() ? record.errorPath.trim() : fallback?.errorPath,
    result: normalizeResultMapping(record.result, fallback?.result ?? DEFAULT_OPENAI_RESULT),
  }
}

function legacyCustomProviderToManifest(record: Record<string, unknown>): Record<string, unknown> | null {
  if (record.template !== 'openai-compatible' && record.template !== 'openai-compatible-async') return null
  const isAsync = record.template === 'openai-compatible-async'
  const taskResultPath = typeof record.taskResultPath === 'string' && record.taskResultPath.trim() ? record.taskResultPath.trim() : 'data.data'
  return {
    id: record.id,
    name: record.name,
    template: 'http-image',
    submit: {
      path: record.generationPath ?? DEFAULT_CUSTOM_PROVIDER_PATHS.generationPath,
      method: 'POST',
      contentType: 'json',
      query: isAsync ? normalizeStringRecord(record.submitQuery) ?? { async: 'true' } : undefined,
      body: DEFAULT_GENERATE_BODY,
      taskIdPath: isAsync ? (record.taskIdPath ?? 'data') : undefined,
      result: DEFAULT_OPENAI_RESULT,
    },
    editSubmit: {
      path: record.editPath ?? DEFAULT_CUSTOM_PROVIDER_PATHS.editPath,
      method: 'POST',
      contentType: 'multipart',
      query: isAsync ? normalizeStringRecord(record.submitQuery) ?? { async: 'true' } : undefined,
      body: DEFAULT_EDIT_BODY,
      files: DEFAULT_EDIT_FILES,
      taskIdPath: isAsync ? (record.taskIdPath ?? 'data') : undefined,
      result: DEFAULT_OPENAI_RESULT,
    },
    poll: isAsync ? {
      path: record.taskPath ?? DEFAULT_CUSTOM_PROVIDER_PATHS.taskPath,
      method: 'GET',
      statusPath: record.taskStatusPath ?? 'data.status',
      successValues: normalizeStringArray(record.taskSuccessValues, ['SUCCESS', 'succeeded', 'completed', 'COMPLETED']),
      failureValues: normalizeStringArray(record.taskFailureValues, ['FAILURE', 'failed', 'error', 'FAILED']),
      errorPath: 'data.fail_reason',
      intervalSeconds: typeof record.pollIntervalSeconds === 'number' ? record.pollIntervalSeconds : 5,
      result: {
        imageUrlPaths: [`${taskResultPath}.data.*.url`],
        b64JsonPaths: [`${taskResultPath}.data.*.b64_json`],
      },
    } : undefined,
  }
}

function createCustomProviderId(name: string, usedIds: Set<string>): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'custom'
  let id = `custom-${slug}`
  let index = 2
  while (usedIds.has(id) || BUILT_IN_PROVIDER_IDS.has(id)) {
    id = `custom-${slug}-${index}`
    index += 1
  }
  usedIds.add(id)
  return id
}

export function normalizeCustomProviderDefinition(input: unknown, usedIds = new Set<string>()): CustomProviderDefinition | null {
  if (!input || typeof input !== 'object') return null
  const rawRecord = input as Record<string, unknown>
  const record = legacyCustomProviderToManifest(rawRecord) ?? rawRecord
  const template = record.template == null ? 'http-image' : isCustomProviderTemplate(record.template) ? record.template : null
  if (!template || !isRecord(record.submit)) return null

  const rawName = typeof record.name === 'string' && record.name.trim() ? record.name.trim() : '自定义服务商'
  const id = typeof record.id === 'string' && record.id.trim() && !BUILT_IN_PROVIDER_IDS.has(record.id.trim()) && !usedIds.has(record.id.trim())
    ? record.id.trim()
    : createCustomProviderId(rawName, usedIds)
  usedIds.add(id)

  return {
    id,
    name: rawName,
    template,
    submit: normalizeSubmitMapping(record.submit, {
      path: DEFAULT_CUSTOM_PROVIDER_PATHS.generationPath,
      method: 'POST',
      contentType: 'json',
      body: DEFAULT_GENERATE_BODY,
      result: DEFAULT_OPENAI_RESULT,
    }),
    editSubmit: isRecord(record.editSubmit) ? normalizeSubmitMapping(record.editSubmit, {
      path: DEFAULT_CUSTOM_PROVIDER_PATHS.editPath,
      method: 'POST',
      contentType: 'multipart',
      body: DEFAULT_EDIT_BODY,
      files: DEFAULT_EDIT_FILES,
      result: DEFAULT_OPENAI_RESULT,
    }) : undefined,
    poll: normalizePollMapping(record.poll),
  }
}

export function normalizeCustomProviderDefinitions(input: unknown): CustomProviderDefinition[] {
  const usedIds = new Set<string>()
  const list = Array.isArray(input) ? input : []
  return list
    .map((item) => normalizeCustomProviderDefinition(item, usedIds))
    .filter((item): item is CustomProviderDefinition => Boolean(item))
}

export function createDefaultAPIMartProfile(overrides: Partial<ApiProfile> = {}): ApiProfile {
  const defaultBaseUrl = getActiveBaseUrl()
  return {
    id: `apimart-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: 'GPT-Image-2',
    provider: APIMART_PROVIDER_ID,
    baseUrl: defaultBaseUrl,
    model: 'gpt-image-2',
    timeout: DEFAULT_API_TIMEOUT,
    apiMode: 'images',
    apiProxy: isApiProxyAvailable(),
    streamImages: false,
    streamPartialImages: DEFAULT_STREAM_PARTIAL_IMAGES,
    ...overrides,
    apiKey: getDefaultApiKey(),
  }
}

export function switchApiProfileProvider(profile: ApiProfile, provider: ApiProvider, customProvider?: CustomProviderDefinition): ApiProfile {
  if (customProvider) {
    const isAPIMart = customProvider.id === APIMART_PROVIDER_ID
    const defaultBaseUrl = getActiveBaseUrl()
    const defaultModel = 'gpt-image-2'
    return {
      ...profile,
      provider: customProvider.id,
      baseUrl: isAPIMart ? defaultBaseUrl : profile.baseUrl || defaultBaseUrl,
      model: isAPIMart ? defaultModel : profile.model || defaultModel,
      apiMode: 'images',
      apiProxy: isApiProxyAvailable(),
    }
  }

  return {
    ...profile,
    provider: APIMART_PROVIDER_ID,
    baseUrl: getActiveBaseUrl(),
    model: 'gpt-image-2',
    apiMode: 'images',
    apiProxy: isApiProxyAvailable(),
  }
}

export function normalizeApiProfile(input: unknown, fallback?: Partial<ApiProfile>, customProviderIds = new Set<string>()): ApiProfile {
  const record = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  const rawProvider = typeof record.provider === 'string' ? record.provider : ''
  const inputBaseUrl = typeof record.baseUrl === 'string' ? record.baseUrl : (fallback?.baseUrl ?? '')
  const isAPIMart = inputBaseUrl.toLowerCase().includes('dragoncode.codes/gpt-image') || inputBaseUrl.toLowerCase().includes('api.apimart.ai') || rawProvider === APIMART_PROVIDER_ID

  const provider: ApiProvider = isAPIMart ? APIMART_PROVIDER_ID : (rawProvider || APIMART_PROVIDER_ID)
  const defaults = createDefaultAPIMartProfile(fallback)
  const resolvedBaseUrl = typeof record.baseUrl === 'string' ? record.baseUrl : defaults.baseUrl

  return {
    ...defaults,
    id: typeof record.id === 'string' && record.id.trim() ? record.id : defaults.id,
    name: typeof record.name === 'string' && record.name.trim() ? record.name : defaults.name,
    provider,
    baseUrl: resolvedBaseUrl,
    apiKey: defaults.apiKey,
    model: typeof record.model === 'string' && record.model.trim() ? record.model : defaults.model,
    timeout: typeof record.timeout === 'number' && Number.isFinite(record.timeout) ? record.timeout : defaults.timeout,
    apiMode: 'images',
    apiProxy: isApiProxyAvailable(),
    streamImages: typeof record.streamImages === 'boolean' ? record.streamImages : defaults.streamImages,
    streamPartialImages: normalizeStreamPartialImages(record.streamPartialImages, defaults.streamPartialImages),
    providerDrafts: isRecord(record.providerDrafts) ? record.providerDrafts as ApiProfile['providerDrafts'] : defaults.providerDrafts,
  }
}

function validateImportedProfileRecord(input: unknown) {
  if (!isRecord(input)) return

  const baseUrl = typeof input.baseUrl === 'string' ? input.baseUrl.trim() : ''
  if (baseUrl && (baseUrl.startsWith('[') || baseUrl.includes(']('))) {
    throw new Error('JSON 包含 Markdown 链接，请粘贴纯文本')
  }

  if (typeof input.apiMode === 'string' && input.apiMode !== 'images' && input.apiMode !== 'responses') {
    throw new Error('apiMode 格式无效，应为 images 或 responses')
  }
}

export function normalizeSettings(input: Partial<AppSettings> | unknown): AppSettings {
  const record = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  const customProviders = normalizeCustomProviderDefinitions(record.customProviders)

  // 自动注册或更新内置的 APIMart 服务商为最新定义
  const dragonCodeIndex = customProviders.findIndex((p) => p.id === APIMART_PROVIDER_ID)
  if (dragonCodeIndex >= 0) {
    customProviders[dragonCodeIndex] = APIMART_PROVIDER_DEFINITION
  } else {
    customProviders.push(APIMART_PROVIDER_DEFINITION)
  }

  const customProviderIds = new Set(customProviders.map((provider) => provider.id))
  const legacyProfile = createDefaultAPIMartProfile({
    baseUrl: typeof record.baseUrl === 'string' ? record.baseUrl : getActiveBaseUrl(),
    apiKey: getDefaultApiKey(),
    model: typeof record.model === 'string' && record.model.trim() ? record.model : 'gpt-image-2',
    timeout: typeof record.timeout === 'number' && Number.isFinite(record.timeout) ? record.timeout : DEFAULT_API_TIMEOUT,
    apiProxy: isApiProxyAvailable(),
  })
  const profiles = Array.isArray(record.profiles) && record.profiles.length
    ? record.profiles.map((profile) => normalizeApiProfile(profile, undefined, customProviderIds))
    : [legacyProfile]

  // 强力同步内置的 APIMart Profile 的 baseUrl 为当前最新环境变量地址，彻底解决浏览器 LocalStorage 缓存滞后导致模式切换不生效问题
  const currentActiveBaseUrl = getActiveBaseUrl()
  const syncedProfiles = profiles.map((p) => {
    if (p.provider === APIMART_PROVIDER_ID) {
      // 只有内置默认的 APIMart 或者是属于内置域名的 baseUrl，才进行强制热纠正
      const isDefaultId = (p.id.startsWith('apimart-') && !p.id.includes('-url-')) || p.id.startsWith('dragoncode-') || p.id === 'default-apimart'
      const isDefaultUrl = (p.baseUrl || '').toLowerCase().includes('dragoncode.codes') || (p.baseUrl || '').toLowerCase().includes('api.apimart.ai')
      if (isDefaultId || isDefaultUrl) {
        return { ...p, baseUrl: currentActiveBaseUrl }
      }
    }
    return p
  })

  // 自动将内置的 APIMart Profile 追加 to profiles 列表中（如果不存在）
  if (!syncedProfiles.some((p) => p.provider === APIMART_PROVIDER_ID)) {
    syncedProfiles.push(createDefaultAPIMartProfile())
  }

  const activeProfileId = typeof record.activeProfileId === 'string' && syncedProfiles.some((p) => p.id === record.activeProfileId)
    ? record.activeProfileId
    : syncedProfiles[0].id
  const active = syncedProfiles.find((p) => p.id === activeProfileId) ?? syncedProfiles[0]

  return {
    baseUrl: active.baseUrl,
    apiKey: active.apiKey,
    model: active.model,
    timeout: active.timeout,
    apiMode: 'images',
    apiProxy: active.apiProxy,
    streamImages: active.streamImages,
    streamPartialImages: active.streamPartialImages,
    customProviders,
    providerOrder: Array.isArray(record.providerOrder) ? record.providerOrder.map(String) : undefined,
    clearInputAfterSubmit: typeof record.clearInputAfterSubmit === 'boolean' ? record.clearInputAfterSubmit : true,
    persistInputOnRestart: typeof record.persistInputOnRestart === 'boolean' ? record.persistInputOnRestart : true,
    alwaysShowRetryButton: typeof record.alwaysShowRetryButton === 'boolean' ? record.alwaysShowRetryButton : false,
    enterSubmit: typeof record.enterSubmit === 'boolean' ? record.enterSubmit : false,
    referenceImageEditAction: normalizeReferenceImageEditAction(record.referenceImageEditAction),
    profiles: syncedProfiles,
    activeProfileId,
    groups: Array.isArray(record.groups) ? record.groups : [],
    theme: record.theme === 'light' || record.theme === 'dark' || record.theme === 'system' ? record.theme : 'system',
  }
}

export function getCustomProviderDefinition(settings: Partial<AppSettings> | unknown, provider: ApiProvider): CustomProviderDefinition | null {
  const normalized = normalizeSettings(settings)
  return normalized.customProviders.find((item) => item.id === provider) ?? null
}

export function getApiProviderLabel(settings: Partial<AppSettings> | unknown, provider: ApiProvider): string {
  if (provider === 'fal') return 'fal.ai'
  if (provider === 'openai') return 'OpenAI'
  return getCustomProviderDefinition(settings, provider)?.name ?? provider
}

export function isOpenAICompatibleProvider(settings: Partial<AppSettings> | unknown, provider: ApiProvider): boolean {
  return provider === 'openai' || Boolean(getCustomProviderDefinition(settings, provider))
}

export interface ImportedProviderSettings {
  customProviders: CustomProviderDefinition[]
  profiles: ApiProfile[]
}

function stripMarkdownCodeFence(text: string): string {
  const trimmed = text.trim()
  const match = trimmed.match(/^```[^\r\n]*\r?\n([\s\S]*?)\r?\n```$/)
  return match ? match[1].trim() : trimmed
}

export function importCustomProviderSettingsFromJson(
  jsonText: string,
  existingProviders: CustomProviderDefinition[] = [],
): ImportedProviderSettings {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripMarkdownCodeFence(jsonText))
  } catch {
    throw new Error('JSON 格式无效')
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('JSON 根节点必须是对象')
  }

  const record = parsed as Record<string, unknown>

  // 包裹结构：{customProviders: [...], profiles: [...]}
  if (Array.isArray(record.customProviders)) {
    const customProviders = normalizeCustomProviderDefinitions(record.customProviders)
    if (customProviders.length === 0) {
      throw new Error('customProviders 数组中没有有效的服务商配置')
    }
    const customProviderIds = new Set(customProviders.map((provider) => provider.id))
    const profiles = Array.isArray(record.profiles)
      ? record.profiles
        .map((item) => {
          validateImportedProfileRecord(item)
          return item
        })
        .map((item) => normalizeApiProfile(item, undefined, customProviderIds))
        .filter((profile) => customProviderIds.has(profile.provider))
      : []
    return { customProviders, profiles }
  }

  // 单个 Manifest 对象：{name, submit, ...}
  const usedIds = new Set(existingProviders.map((provider) => provider.id))
  const direct = normalizeCustomProviderDefinition(parsed, usedIds)
  if (direct) return { customProviders: [direct], profiles: [] }

  throw new Error('无法识别该 JSON。请粘贴自定义服务商配置。')
}

export function importCustomProviderDefinitionFromJson(jsonText: string, existingProviders: CustomProviderDefinition[] = []): CustomProviderDefinition {
  const result = importCustomProviderSettingsFromJson(jsonText, existingProviders)
  return result.customProviders[0]
}

export function getActiveApiProfile(settings: Partial<AppSettings> | unknown): ApiProfile {
  const record = settings && typeof settings === 'object' ? settings as Record<string, unknown> : {}
  const normalized = normalizeSettings(settings)
  const profile = normalized.profiles.find((p) => p.id === normalized.activeProfileId) ?? normalized.profiles[0] ?? createDefaultAPIMartProfile()

  return {
    ...profile,
    baseUrl: typeof record.baseUrl === 'string' ? record.baseUrl : profile.baseUrl,
    apiKey: profile.apiKey,
    model: typeof record.model === 'string' && record.model.trim() ? record.model : profile.model,
    timeout: typeof record.timeout === 'number' && Number.isFinite(record.timeout) ? record.timeout : profile.timeout,
    apiMode: 'images',
    apiProxy: typeof record.apiProxy === 'boolean' ? record.apiProxy : profile.apiProxy,
    streamImages: typeof record.streamImages === 'boolean' ? record.streamImages : profile.streamImages,
    streamPartialImages: normalizeStreamPartialImages(record.streamPartialImages, profile.streamPartialImages),
  }
}

export function validateApiProfile(profile: ApiProfile): string | null {
  if (!profile.name.trim()) return '缺少名称'
  if (!profile.baseUrl.trim()) return '缺少 API URL'
  if (!profile.apiKey.trim()) return '缺少环境变量 NEXT_PUBLIC_DEFAULT_API_KEY'
  if (!profile.model.trim()) return '缺少模型 ID'
  return null
}

function isDefaultAPIMartProfile(profile: ApiProfile): boolean {
  const isCorrectBaseUrl = profile.baseUrl === getActiveBaseUrl()
  const isCorrectName = profile.name === 'GPT-Image-2'
  return (profile.id.startsWith('apimart-') || profile.id.startsWith('dragoncode-')) &&
    isCorrectName &&
    profile.provider === APIMART_PROVIDER_ID &&
    isCorrectBaseUrl &&
    profile.apiKey === getDefaultApiKey() &&
    profile.model === 'gpt-image-2' &&
    profile.timeout === DEFAULT_API_TIMEOUT &&
    profile.apiMode === 'images' &&
    profile.apiProxy === isApiProxyAvailable()
}

function hasOnlyDefaultProfiles(settings: AppSettings): boolean {
  const hasOnlyDragonCodeProvider = settings.customProviders.length === 1 &&
    settings.customProviders[0].id === APIMART_PROVIDER_ID

  if (settings.profiles.length === 1) {
    return hasOnlyDragonCodeProvider && isDefaultAPIMartProfile(settings.profiles[0])
  }
  return false
}

function createImportedProfileId(provider: ApiProvider, usedIds: Set<string>): string {
  let id = `${provider}-imported-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  while (usedIds.has(id)) {
    id = `${provider}-imported-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  }
  usedIds.add(id)
  return id
}

function getApiProfileDedupKey(profile: ApiProfile): string {
  return JSON.stringify([
    profile.provider,
    profile.baseUrl.trim().replace(/\/+$/, '').toLowerCase(),
    profile.model.trim(),
    profile.apiMode,
  ])
}

function getApiProfileConnectionKey(profile: ApiProfile): string {
  return JSON.stringify([
    profile.provider,
    profile.baseUrl.trim().replace(/\/+$/, '').toLowerCase(),
    profile.model.trim(),
    profile.apiMode,
  ])
}

function hasEquivalentApiProfile(existingProfiles: ApiProfile[], importedProfile: ApiProfile): boolean {
  const dedupKey = getApiProfileDedupKey(importedProfile)
  if (existingProfiles.some((profile) => getApiProfileDedupKey(profile) === dedupKey)) return true

  const connectionKey = getApiProfileConnectionKey(importedProfile)
  return existingProfiles.some((profile) => getApiProfileConnectionKey(profile) === connectionKey)
}

function dedupeApiProfiles(profiles: ApiProfile[]): ApiProfile[] {
  const seen = new Set<string>()
  return profiles.filter((profile) => {
    const key = getApiProfileDedupKey(profile)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function getCustomProviderDedupKey(provider: CustomProviderDefinition): string {
  return JSON.stringify([
    provider.name,
    provider.template ?? 'http-image',
    provider.submit,
    provider.editSubmit ?? null,
    provider.poll ?? null,
  ])
}

function mergeImportedCustomProviders(currentProviders: CustomProviderDefinition[], importedProviders: CustomProviderDefinition[]) {
  const providers = [...currentProviders]
  const providerIdMap = new Map<string, string>()
  const usedIds = new Set(providers.map((provider) => provider.id))
  const existingKeys = new Map(providers.map((provider) => [getCustomProviderDedupKey(provider), provider.id] as const))

  for (const provider of importedProviders) {
    const existingId = existingKeys.get(getCustomProviderDedupKey(provider))
    if (existingId) {
      providerIdMap.set(provider.id, existingId)
      continue
    }

    const normalized = normalizeCustomProviderDefinition(provider, usedIds)
    if (!normalized) continue
    providerIdMap.set(provider.id, normalized.id)
    providers.push(normalized)
    existingKeys.set(getCustomProviderDedupKey(normalized), normalized.id)
  }

  return { providers, providerIdMap }
}

export function findEquivalentApiProfile(
  settings: Partial<AppSettings> | unknown,
  importedProfile: ApiProfile,
  importedProviders: CustomProviderDefinition[] = [],
): ApiProfile | null {
  const normalized = normalizeSettings(settings)
  const importedProvider = importedProviders.find((provider) => provider.id === importedProfile.provider)
  const provider = importedProvider
    ? normalized.customProviders.find((provider) => getCustomProviderDedupKey(provider) === getCustomProviderDedupKey(importedProvider))?.id ?? importedProfile.provider
    : importedProfile.provider
  const profile = { ...importedProfile, provider }
  const dedupKey = getApiProfileDedupKey(profile)
  const exact = normalized.profiles.find((item) => getApiProfileDedupKey(item) === dedupKey)
  if (exact) return exact

  const connectionKey = getApiProfileConnectionKey(profile)
  return normalized.profiles.find((item) => getApiProfileConnectionKey(item) === connectionKey) ?? null
}

export function mergeImportedSettings(currentSettings: Partial<AppSettings> | unknown, importedSettings: Partial<AppSettings> | unknown): AppSettings {
  const current = normalizeSettings(currentSettings)
  const normalizedImported = normalizeSettings(importedSettings)
  const imported = normalizeSettings({
    ...normalizedImported,
    profiles: dedupeApiProfiles(normalizedImported.profiles),
  })

  if (hasOnlyDefaultProfiles(current)) {
    return imported
  }

  const usedIds = new Set(current.profiles.map((profile) => profile.id))
  const existingKeys = new Set(current.profiles.map(getApiProfileDedupKey))
  const { providers: customProviders, providerIdMap } = mergeImportedCustomProviders(current.customProviders, imported.customProviders)
  const importedProfiles = imported.profiles
    .map((profile) => providerIdMap.has(profile.provider)
      ? { ...profile, provider: providerIdMap.get(profile.provider) ?? profile.provider }
      : profile,
    )
    .filter((profile) => !existingKeys.has(getApiProfileDedupKey(profile)) && !hasEquivalentApiProfile(current.profiles, profile))
    .map((profile) => ({
      ...profile,
      id: createImportedProfileId(profile.provider, usedIds),
    }))
  const profiles = [...current.profiles, ...importedProfiles]

  return normalizeSettings({
    ...current,
    customProviders,
    profiles,
    activeProfileId: current.activeProfileId,
  })
}

export const DEFAULT_SETTINGS: AppSettings = normalizeSettings({
  baseUrl: getActiveBaseUrl(),
  apiKey: '',
  model: 'gpt-image-2',
  timeout: DEFAULT_API_TIMEOUT,
  apiMode: 'images',
  apiProxy: isApiProxyAvailable(),
  streamImages: false,
  streamPartialImages: DEFAULT_STREAM_PARTIAL_IMAGES,
  customProviders: [],
  clearInputAfterSubmit: true,
  persistInputOnRestart: true,
  alwaysShowRetryButton: false,
  enterSubmit: false,
  referenceImageEditAction: 'ask',
  groups: [],
  theme: 'system',
})
