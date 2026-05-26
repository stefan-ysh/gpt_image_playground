import type { ImageResolution } from './lib/resolution'

// ===== 设置 =====

export type ApiMode = 'images' | 'responses'
export type ReferenceImageEditAction = 'ask' | 'replace-reference' | 'add-mask'
export type BuiltInApiProvider = 'openai' | 'fal'
export type ApiProvider = BuiltInApiProvider | string
export type CustomProviderTemplate = 'http-image'
export const DEFAULT_STREAM_PARTIAL_IMAGES = 1

export type CustomProviderRequestMethod = 'GET' | 'POST'
export type CustomProviderContentType = 'json' | 'multipart'
export type CustomProviderFileSource = 'inputImages' | 'mask'

export interface CustomProviderFileMapping {
  field: string
  source: CustomProviderFileSource
  array?: boolean
}

export interface CustomProviderResultMapping {
  imageUrlPaths?: string[]
  b64JsonPaths?: string[]
}

export interface CustomProviderSubmitMapping {
  path: string
  method?: CustomProviderRequestMethod
  contentType?: CustomProviderContentType
  query?: Record<string, string>
  body?: Record<string, unknown>
  files?: CustomProviderFileMapping[]
  taskIdPath?: string
  result?: CustomProviderResultMapping
}

export interface CustomProviderPollMapping {
  path: string
  method?: CustomProviderRequestMethod
  query?: Record<string, string>
  intervalSeconds?: number
  statusPath: string
  successValues: string[]
  failureValues: string[]
  errorPath?: string
  result: CustomProviderResultMapping
}

export interface CustomProviderDefinition {
  id: string
  name: string
  template?: CustomProviderTemplate
  submit: CustomProviderSubmitMapping
  editSubmit?: CustomProviderSubmitMapping
  poll?: CustomProviderPollMapping
}

export interface ApiProfile {
  id: string
  name: string
  provider: ApiProvider
  baseUrl: string
  apiKey: string
  model: string
  timeout: number
  apiMode: ApiMode
  apiProxy: boolean
  streamImages: boolean
  streamPartialImages: number
  providerDrafts?: Partial<Record<ApiProvider, Partial<ApiProfile>>>
}

export interface TaskGroup {
  id: string
  name: string
  createdAt: number
}

export interface AppSettings {
  /** 旧版单配置字段：保留用于导入/查询参数兼容，实际请求以 active profile 为准 */
  baseUrl: string
  apiKey: string
  model: string
  timeout: number
  apiMode: ApiMode
  apiProxy: boolean
  streamImages: boolean
  streamPartialImages: number
  customProviders: CustomProviderDefinition[]
  providerOrder?: string[]
  clearInputAfterSubmit: boolean
  persistInputOnRestart: boolean
  alwaysShowRetryButton: boolean
  enterSubmit: boolean
  referenceImageEditAction: ReferenceImageEditAction
  profiles: ApiProfile[]
  activeProfileId: string
  groups?: TaskGroup[]
  theme: 'light' | 'dark' | 'system'
}

// ===== 任务参数 =====

export interface TaskParams {
  size: string
  resolution: ImageResolution
  output_format: 'png' | 'jpeg' | 'webp'
  output_compression: number | null
  moderation: 'auto' | 'low'
  n: number
}

export const DEFAULT_PARAMS: TaskParams = {
  size: 'auto',
  resolution: '1k',
  output_format: 'png',
  output_compression: null,
  moderation: 'auto',
  n: 1,
}

// ===== 输入图片（UI 层面） =====

export interface InputImage {
  /** IndexedDB image store 的 id（SHA-256 hash） */
  id: string
  /** data URL，用于预览 */
  dataUrl: string
  /** 参考图来源标记：由遮罩编辑器生成时视为局部重绘输入 */
  editSource?: 'mask'
}

// ===== 任务记录 =====

export type LegacyTaskStatus = 'running' | 'error'

export type WorkerTaskStatus =
  | 'created'
  | 'queued'
  | 'submitting'
  | 'submitted'
  | 'polling'
  | 'polling_retryable'
  | 'succeeded_raw'
  | 'storing_images'
  | 'transfer_pending'
  | 'done'
  | 'provider_failed'
  | 'submit_unknown'
  | 'cancelled'

export type TaskStatus = LegacyTaskStatus | WorkerTaskStatus

export interface TaskRecord {
  id: string
  prompt: string
  params: TaskParams

  /** 生成时使用的 Provider 类型 */
  apiProvider?: ApiProvider
  /** 生成时使用的 API 配置 ID */
  apiProfileId?: string
  /** 生成时使用的 Provider 名称 */
  apiProfileName?: string
  /** 生成时使用的 API 模式 */
  apiMode?: ApiMode
  /** 生成时使用的模型 ID */
  apiModel?: string
  /** 生成时使用的 API 配置快照，用于配置被改名/删除后继续查询异步结果 */
  apiProfileSnapshot?: ApiProfile
  /** 生成时使用的自定义服务商配置快照 */
  customProviderSnapshot?: CustomProviderDefinition

  /** fal.ai 队列请求 ID，用于连接断开后的结果恢复 */
  falRequestId?: string
  /** fal.ai 队列 endpoint，用于连接断开后的状态和结果查询 */
  falEndpoint?: string
  /** fal.ai 任务连接断开后是否等待自动恢复 */
  falRecoverable?: boolean
  /** 自定义异步服务商任务 ID，用于重启后继续查询结果 */
  customTaskId?: string
  /** 自定义异步任务是否等待自动恢复 */
  customRecoverable?: boolean

  /** Worker / Provider 状态字段 */
  providerTaskId?: string | null
  providerStatus?: string | null
  submitStatus?: string | null
  runAttempt?: number
  pollAttempts?: number
  manualSyncAttempts?: number
  lastPollAt?: number | null
  nextPollAt?: number | null
  submittedAt?: number | null
  providerFinishedAt?: number | null
  externalTaskExpiresAt?: number | null
  workerId?: string | null
  lockedUntil?: number | null
  lastProviderPayload?: string | null
  lastProviderError?: string | null
  idempotencyKey?: string | null
  providerResultRaw?: string | null
  copiedFromTaskId?: string | null

  /** API 返回的实际生效参数，用于标记与请求值不一致的情况 */
  actualParams?: Partial<TaskParams> & Record<string, unknown>
  /** 输出图片对应的实际生效参数，key 为 outputImages 中的图片 id */
  actualParamsByImage?: Record<string, Partial<TaskParams>>
  /** 输出图片对应的 API 改写提示词，key 为 outputImages 中的图片 id */
  revisedPromptByImage?: Record<string, string>

  /** 输入图片的 image store id 列表 */
  inputImageIds: string[]
  maskTargetImageId?: string | null
  maskImageId?: string | null

  /** 输出图片的 image store id 列表 */
  outputImages: string[]
  /** 已生成但尚未成功转存到自有存储的临时图片 URL */
  outputImagesPending?: string[]
  /** 流式生成的中间步骤图片 id 列表，仅失败时保留供排查/下载 */
  streamPartialImageIds?: string[]
  /** API 返回的原始图片 HTTP URL（非 base64 时记录） */
  rawImageUrls?: string[]
  /** 发生解析错误时的原始响应 JSON */
  rawResponsePayload?: string

  status: TaskStatus
  error: string | null
  createdAt: number
  finishedAt: number | null
  /** 总耗时毫秒 */
  elapsed: number | null
  /** 是否收藏 */
  isFavorite?: boolean
  /** 所属分组 ID */
  groupId?: string
  /** 多用户隔离指纹（API Key 的哈希） */
  ownerFingerprint?: string
  /** 任务实际花费计费（如果服务商返回 cost 字段） */
  cost?: number
}

// ===== IndexedDB 存储的图片 =====

export interface StoredImage {
  id: string
  dataUrl: string
  /** 图片首次存储时间（ms） */
  createdAt?: number
  /** 图片来源：用户上传 / API 生成 / 遮罩 / 参考图 */
  source?: 'upload' | 'generated' | 'mask' | 'reference'
  /** 原图宽度 */
  width?: number
  /** 原图高度 */
  height?: number
}

export interface StoredImageThumbnail {
  id: string
  /** 列表缩略图，用于避免卡片页解码完整 4K 原图 */
  thumbnailDataUrl: string
  /** 原图宽度 */
  width?: number
  /** 原图高度 */
  height?: number
  /** 缩略图生成参数版本 */
  thumbnailVersion?: number
}

// ===== API 请求体 =====

export interface ImageGenerationRequest {
  model: string
  prompt: string
  size: string
  resolution: string
  output_format: string
  moderation: string
  output_compression?: number
  n?: number
}

// ===== API 响应 =====

export interface ImageResponseItem {
  b64_json?: string
  url?: string
  revised_prompt?: string
  size?: string
  resolution?: string
  output_format?: string
  output_compression?: number
  moderation?: string
}

export interface ImageApiResponse {
  data: ImageResponseItem[]
  size?: string
  resolution?: string
  output_format?: string
  output_compression?: number
  moderation?: string
  n?: number
}

export interface ResponsesOutputItem {
  id?: string
  type?: string
  status?: string
  action?: string | Record<string, unknown>
  call_id?: string
  name?: string
  arguments?: string
  output?: string
  annotations?: Array<{
    type?: string
    start_index?: number
    end_index?: number
    url?: string
    title?: string
  }>
  content?: Array<{
    type?: string
    text?: string
    annotations?: Array<{
      type?: string
      start_index?: number
      end_index?: number
      url?: string
      title?: string
    }>
  }>
  result?:
    | string
    | {
        b64_json?: string
        image?: string
        data?: string
      }
  size?: string
  resolution?: string
  output_format?: string
  output_compression?: number
  moderation?: string
  revised_prompt?: string
}

export interface ResponsesApiResponse {
  id?: string
  output?: ResponsesOutputItem[]
  tools?: Array<{
    type?: string
    size?: string
    resolution?: string
    output_format?: string
    output_compression?: number
    moderation?: string
    n?: number
  }>
}

export interface FalImageFile {
  url?: string
  content_type?: string
  file_name?: string
  width?: number
  height?: number
  b64_json?: string
  base64?: string
  data?: string
}

export interface FalApiResponse {
  images?: FalImageFile[]
  image?: FalImageFile | string
  url?: string
  seed?: number
}

export interface UserInfo {
  id: string
  email: string
  displayName: string | null
  role: string
}