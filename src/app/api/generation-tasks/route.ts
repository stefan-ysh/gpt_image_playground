import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { RowDataPacket } from 'mysql2'
import type {
    ApiProfile,
    CustomProviderDefinition,
    TaskParams,
    TaskRecord,
} from '@/types'
import { requireCurrentUser } from '@/lib/db/auth'
import { mysqlPool } from '@/lib/db/mysql'
import { ensurePlaygroundSchema } from '@/lib/db/schema'
import { handleApiError } from '@/lib/api-error'

export const runtime = 'nodejs'

const ID_PREFIX = 'task'

function createTaskId() {
    return `${ID_PREFIX}-${Date.now().toString(36)}-${crypto
        .randomBytes(8)
        .toString('hex')}`
}

function createIdempotencyKey(taskId: string, runAttempt = 1) {
    return `${taskId}:${runAttempt}`
}

function normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return []

    return value
        .filter((item): item is string => {
            return typeof item === 'string' && item.trim().length > 0
        })
        .map((item) => item.trim())
}

function normalizeTaskParams(value: unknown): TaskParams {
    const params = value && typeof value === 'object' ? value as Partial<TaskParams> : {}

    return {
        size: typeof params.size === 'string' && params.size.trim() ? params.size : 'auto',
        resolution: params.resolution || '1k',
        output_format:
            params.output_format === 'jpeg' ||
                params.output_format === 'webp' ||
                params.output_format === 'png'
                ? params.output_format
                : 'png',
        output_compression:
            typeof params.output_compression === 'number'
                ? params.output_compression
                : null,
        moderation:
            params.moderation === 'low' || params.moderation === 'auto'
                ? params.moderation
                : 'auto',
        n:
            typeof params.n === 'number' && Number.isFinite(params.n)
                ? params.n
                : 1,
    }
}

function normalizeApiProfile(value: unknown): ApiProfile {
    if (!value || typeof value !== 'object') {
        throw new Error('缺少 API 配置快照')
    }

    const profile = value as Partial<ApiProfile>

    if (!profile.id || typeof profile.id !== 'string') {
        throw new Error('API 配置缺少 id')
    }

    if (!profile.name || typeof profile.name !== 'string') {
        throw new Error('API 配置缺少名称')
    }

    if (!profile.provider || typeof profile.provider !== 'string') {
        throw new Error('API 配置缺少 provider')
    }

    if (!profile.baseUrl || typeof profile.baseUrl !== 'string') {
        throw new Error('API 配置缺少 baseUrl')
    }

    if (!profile.apiKey || typeof profile.apiKey !== 'string') {
        throw new Error('API 配置缺少 apiKey')
    }

    if (!profile.model || typeof profile.model !== 'string') {
        throw new Error('API 配置缺少 model')
    }

    return {
        id: profile.id,
        name: profile.name,
        provider: profile.provider,
        baseUrl: profile.baseUrl,
        apiKey: profile.apiKey,
        model: profile.model,
        timeout:
            typeof profile.timeout === 'number' && Number.isFinite(profile.timeout)
                ? profile.timeout
                : 120,
        apiMode: profile.apiMode === 'responses' ? 'responses' : 'images',
        apiProxy: profile.apiProxy === true,
        streamImages: profile.streamImages === true,
        streamPartialImages:
            typeof profile.streamPartialImages === 'number'
                ? profile.streamPartialImages
                : 1,
        providerDrafts: profile.providerDrafts,
    }
}

function normalizeCustomProviderSnapshot(value: unknown): CustomProviderDefinition | null {
    if (!value || typeof value !== 'object') return null

    const provider = value as Partial<CustomProviderDefinition>

    if (!provider.id || !provider.name || !provider.submit) {
        return null
    }

    return provider as CustomProviderDefinition
}

async function assertImagesBelongToUser(userId: string, imageIds: string[]) {
    if (imageIds.length === 0) return

    const pool = await mysqlPool()
    const placeholders = imageIds.map(() => '?').join(',')

    const [rows] = await pool.query<RowDataPacket[]>(
        `
    SELECT image_id
    FROM playground_image_owners
    WHERE user_id = ?
      AND image_id IN (${placeholders})
    `,
        [userId, ...imageIds],
    )

    const owned = new Set(rows.map((row) => String(row.image_id)))
    const missing = imageIds.filter((id) => !owned.has(id))

    if (missing.length > 0) {
        throw new Error('部分参考图不存在或无权使用')
    }
}

function createClientTaskRecord(params: {
    taskId: string
    prompt: string
    taskParams: TaskParams
    inputImageIds: string[]
    maskTargetImageId: string | null
    maskImageId: string | null
    groupId: string | null
    apiProfile: ApiProfile
    customProviderSnapshot: CustomProviderDefinition | null
    now: number
    idempotencyKey: string
}): TaskRecord {
    return {
        id: params.taskId,
        prompt: params.prompt,
        params: params.taskParams,

        apiProvider: params.apiProfile.provider,
        apiProfileId: params.apiProfile.id,
        apiProfileName: params.apiProfile.name,
        apiMode: params.apiProfile.apiMode,
        apiModel: params.apiProfile.model,
        apiProfileSnapshot: params.apiProfile,
        customProviderSnapshot: params.customProviderSnapshot ?? undefined,

        providerTaskId: null,
        providerStatus: null,
        submitStatus: 'waiting',
        runAttempt: 1,
        pollAttempts: 0,
        manualSyncAttempts: 0,
        lastPollAt: null,
        nextPollAt: null,
        submittedAt: null,
        providerFinishedAt: null,
        externalTaskExpiresAt: null,
        workerId: null,
        lockedUntil: null,
        lastProviderPayload: null,
        lastProviderError: null,
        idempotencyKey: params.idempotencyKey,
        providerResultRaw: null,
        copiedFromTaskId: null,

        inputImageIds: params.inputImageIds,
        maskTargetImageId: params.maskTargetImageId,
        maskImageId: params.maskImageId,
        outputImages: [],
        outputImagesPending: undefined,
        streamPartialImageIds: undefined,
        rawImageUrls: undefined,
        rawResponsePayload: undefined,

        groupId: params.groupId ?? undefined,

        status: 'created',
        error: null,
        createdAt: params.now,
        finishedAt: null,
        elapsed: null,
        isFavorite: false,
        cost: undefined,
    }
}

export async function POST(request: Request) {
    try {
        const user = await requireCurrentUser()
        await ensurePlaygroundSchema()

        const body = await request.json()

        const prompt =
            typeof body.prompt === 'string' && body.prompt.trim()
                ? body.prompt.trim()
                : ''

        if (!prompt) {
            return NextResponse.json(
                { success: false, error: '请输入提示词' },
                { status: 400 },
            )
        }

        const taskParams = normalizeTaskParams(body.params)
        const inputImageIds = normalizeStringArray(body.inputImageIds)
        const maskTargetImageId =
            typeof body.maskTargetImageId === 'string' && body.maskTargetImageId.trim()
                ? body.maskTargetImageId.trim()
                : null
        const maskImageId =
            typeof body.maskImageId === 'string' && body.maskImageId.trim()
                ? body.maskImageId.trim()
                : null
        const groupId =
            typeof body.groupId === 'string' && body.groupId.trim()
                ? body.groupId.trim()
                : null

        const allImageIds = [
            ...inputImageIds,
            ...(maskTargetImageId ? [maskTargetImageId] : []),
            ...(maskImageId ? [maskImageId] : []),
        ]

        await assertImagesBelongToUser(user.id, allImageIds)

        const apiProfile = normalizeApiProfile(body.apiProfileSnapshot)
        const customProviderSnapshot = normalizeCustomProviderSnapshot(
            body.customProviderSnapshot,
        )

        const now = Date.now()
        const taskId =
            typeof body.taskId === 'string' && body.taskId.trim()
                ? body.taskId.trim()
                : createTaskId()
        const idempotencyKey = createIdempotencyKey(taskId, 1)

        const pool = await mysqlPool()

        await pool.query(
            `
      INSERT INTO playground_tasks (
        id,
        user_id,
        prompt,
        params,
        api_provider,
        api_profile_id,
        api_profile_name,
        api_mode,
        api_model,
        api_profile_snapshot,
        custom_provider_snapshot,
        input_image_ids,
        mask_target_image_id,
        mask_image_id,
        output_images,
        raw_image_urls,
        raw_response_payload,
        status,
        error,
        created_at,
        finished_at,
        elapsed,
        is_favorite,
        group_id,
        cost,
        provider_task_id,
        provider_status,
        submit_status,
        run_attempt,
        poll_attempts,
        manual_sync_attempts,
        last_poll_at,
        next_poll_at,
        submitted_at,
        provider_finished_at,
        external_task_expires_at,
        worker_id,
        locked_until,
        last_provider_payload,
        last_provider_error,
        idempotency_key,
        provider_result_raw,
        copied_from_task_id
      )
      VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
      `,
            [
                taskId,
                user.id,
                prompt,
                JSON.stringify(taskParams),
                apiProfile.provider,
                apiProfile.id,
                apiProfile.name,
                apiProfile.apiMode,
                apiProfile.model,
                JSON.stringify(apiProfile),
                customProviderSnapshot ? JSON.stringify(customProviderSnapshot) : null,
                JSON.stringify(inputImageIds),
                maskTargetImageId,
                maskImageId,
                JSON.stringify([]),
                null,
                null,
                'created',
                null,
                now,
                null,
                null,
                0,
                null,
                null,
                null,
                'waiting',
                1,
                0,
                0,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                idempotencyKey,
                null,
                null,
            ],
        )

        const task = createClientTaskRecord({
            taskId,
            prompt,
            taskParams,
            inputImageIds,
            maskTargetImageId,
            maskImageId,
            apiProfile,
            customProviderSnapshot,
            groupId,
            now,
            idempotencyKey,
        })

        return NextResponse.json({
            success: true,
            data: task,
        })
    } catch (error) {
        return handleApiError(error, '创建生成任务')
    }
}