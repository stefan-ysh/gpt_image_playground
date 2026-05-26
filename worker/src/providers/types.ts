export interface ProviderSubmitResult {
  providerTaskId: string
  raw: unknown
}

export interface ProviderPollingResult {
  status: 'pending' | 'success' | 'failed'
  images?: string[]
  cost?: number | null
  progress?: number | null
  error?: string
  raw: unknown
}

export interface ProviderTaskInput {
  id: string
  prompt: string
  params: Record<string, unknown>
  apiProvider: string
  apiModel?: string | null
  apiMode?: string | null
  apiBaseUrl: string
  apiKey: string
  providerTaskId?: string | null
  inputImageUrls?: string[]
}

export interface ProviderAdapter {
  submit(task: ProviderTaskInput): Promise<ProviderSubmitResult>
  poll(task: ProviderTaskInput): Promise<ProviderPollingResult>
}