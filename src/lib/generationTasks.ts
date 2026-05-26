import type {
    ApiProfile,
    CustomProviderDefinition,
    TaskParams,
    TaskRecord,
} from '../types'

export interface CreateGenerationTaskInput {
    prompt: string
    params: TaskParams
    inputImageIds: string[]
    maskTargetImageId?: string | null
    maskImageId?: string | null
    apiProfileSnapshot: ApiProfile
    customProviderSnapshot?: CustomProviderDefinition | null
    taskId?: string
}

async function readJsonResponse(response: Response) {
    const json = await response.json().catch(() => null)

    if (!response.ok) {
        const message =
            json && typeof json === 'object' && typeof json.error === 'string'
                ? json.error
                : `请求失败：HTTP ${response.status}`

        throw new Error(message)
    }

    if (!json?.success) {
        throw new Error(json?.error || '请求失败')
    }

    return json
}

export async function createGenerationTask(
    input: CreateGenerationTaskInput,
): Promise<TaskRecord> {
    const response = await fetch('/api/generation-tasks', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(input),
    })

    const json = await readJsonResponse(response)

    return json.data as TaskRecord
}

export async function getGenerationTask(taskId: string): Promise<TaskRecord> {
    const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
        credentials: 'include',
    })

    const json = await readJsonResponse(response)

    return json.data as TaskRecord
}

export async function syncGenerationTask(taskId: string): Promise<{
    id: string
    status: string
    synced: boolean
    message?: string
}> {
    const response = await fetch(
        `/api/tasks/${encodeURIComponent(taskId)}/sync`,
        {
            method: 'POST',
            credentials: 'include',
        },
    )

    const json = await readJsonResponse(response)

    return json.data
}