import type { TaskRecord, TaskStatus } from '../types'

export const RUNNING_TASK_STATUSES: TaskStatus[] = [
    'running',
    'created',
    'queued',
    'submitting',
    'submitted',
    'polling',
    'polling_retryable',
    'succeeded_raw',
    'storing_images',
    'transfer_pending',
]

export const FAILED_TASK_STATUSES: TaskStatus[] = [
    'error',
    'provider_failed',
]

export function isTaskRunning(status: TaskStatus) {
    return RUNNING_TASK_STATUSES.includes(status)
}

export function isTaskDone(status: TaskStatus) {
    return status === 'done'
}

export function isTaskFailed(status: TaskStatus) {
    return FAILED_TASK_STATUSES.includes(status)
}

export function isTaskTerminal(status: TaskStatus) {
    return isTaskDone(status) || isTaskFailed(status) || status === 'cancelled'
}

export function isWorkerTaskStatus(status: TaskStatus) {
    return status !== 'running' && status !== 'error'
}

export function isSavingImageStatus(status: TaskStatus) {
    return (
        status === 'succeeded_raw' ||
        status === 'storing_images' ||
        status === 'transfer_pending'
    )
}

export function canManualSyncTask(status: TaskStatus) {
    return [
        'created',
        'queued',
        'submitting',
        'submitted',
        'polling',
        'polling_retryable',
        'succeeded_raw',
        'storing_images',
        'transfer_pending',
        'submit_unknown',
    ].includes(status)
}

export function canRegenerateTask(status: TaskStatus) {
    return status === 'error' || status === 'provider_failed'
}

export function matchesTaskStatusFilter(
    status: TaskStatus,
    filterStatus: 'all' | 'running' | 'done' | 'error',
) {
    if (filterStatus === 'all') return true
    if (filterStatus === 'running') return isTaskRunning(status)
    if (filterStatus === 'done') return isTaskDone(status)
    return isTaskFailed(status)
}

export function getTaskStatusText(status: TaskStatus) {
    switch (status) {
        case 'created':
            return '已创建'
        case 'queued':
            return '排队中'
        case 'submitting':
            return '正在提交'
        case 'submitted':
            return '已提交'
        case 'polling':
            return '生成中'
        case 'polling_retryable':
            return '查询中断，自动恢复中'
        case 'succeeded_raw':
            return '生成完成，正在保存'
        case 'storing_images':
            return '正在保存图片'
        case 'transfer_pending':
            return '图片已生成，保存中'
        case 'provider_failed':
            return '生成失败'
        case 'submit_unknown':
            return '提交状态待确认'
        case 'cancelled':
            return '已取消'
        case 'running':
            return '生成中'
        case 'error':
            return '失败'
        case 'done':
            return '完成'
        default:
            return String(status)
    }
}

export function getTaskStatusDescription(status: TaskStatus) {
    switch (status) {
        case 'created':
            return '任务已保存，等待后台 Worker 接管。'
        case 'queued':
            return '任务正在后台队列中等待处理。'
        case 'submitting':
            return '后台正在向服务商提交生成请求。'
        case 'submitted':
            return '任务已提交给服务商，等待开始生成。'
        case 'polling':
            return '服务商正在生成图片。'
        case 'polling_retryable':
            return '查询服务商状态时发生网络或临时错误，后台会自动恢复。'
        case 'succeeded_raw':
            return '服务商已生成图片，后台正在准备保存到 COS。'
        case 'storing_images':
            return '图片正在转存到 COS。'
        case 'transfer_pending':
            return '图片已生成，但保存到 COS 时遇到临时问题，后台会自动重试。'
        case 'provider_failed':
            return '服务商明确返回失败。'
        case 'submit_unknown':
            return '提交服务商时状态不确定。为避免重复扣费，需人工确认或手动同步一次。'
        case 'cancelled':
            return '任务已取消。'
        case 'running':
            return '任务正在生成。'
        case 'error':
            return '任务失败。'
        case 'done':
            return '任务已完成。'
        default:
            return ''
    }
}

type TaskStatusDisplayInput = Pick<TaskRecord, 'status'> & Partial<Pick<
    TaskRecord,
    | 'error'
    | 'providerStatus'
    | 'submitStatus'
    | 'lastProviderError'
    | 'providerTaskId'
    | 'workerId'
>>

export type TaskStatusTone = 'neutral' | 'running' | 'saving' | 'success' | 'warning' | 'error'

export interface TaskStatusDisplay {
    text: string
    description: string
    tone: TaskStatusTone
    rawStatus: string
}

function normalizeBackendStatus(value: string | null | undefined) {
    return (value || '').trim().toLowerCase()
}

function getProviderStatusText(providerStatus: string | null | undefined) {
    const status = normalizeBackendStatus(providerStatus)

    if (!status) return ''

    if (['created', 'queued', 'pending', 'waiting'].includes(status)) {
        return '服务商排队中'
    }

    if (['submitting', 'submit'].includes(status)) {
        return '正在提交服务商'
    }

    if (['submitted', 'accepted', 'received'].includes(status)) {
        return '服务商已接收'
    }

    if (['processing', 'running', 'in_progress', 'generating'].includes(status)) {
        return '服务商生成中'
    }

    if (['completed', 'complete', 'success', 'succeeded'].includes(status)) {
        return '服务商已完成'
    }

    if (['failed', 'error'].includes(status)) {
        return '服务商失败'
    }

    if (['cancelled', 'canceled'].includes(status)) {
        return '服务商已取消'
    }

    if (status === 'polling_retryable') {
        return '查询中断，自动恢复中'
    }

    if (status === 'submit_unknown') {
        return '提交状态待确认'
    }

    return `服务商：${providerStatus}`
}

function getSubmitStatusText(submitStatus: string | null | undefined) {
    const status = normalizeBackendStatus(submitStatus)

    if (!status) return ''
    if (['waiting', 'created', 'queued'].includes(status)) return '等待后台提交'
    if (['running', 'submitting'].includes(status)) return '正在提交'
    if (['success', 'succeeded', 'submitted'].includes(status)) return '提交成功'
    if (['failed', 'error'].includes(status)) return '提交失败'

    return `提交：${submitStatus}`
}

function appendBackendStatus(description: string, task: TaskStatusDisplayInput) {
    const parts = [
        `任务状态 ${task.status}`,
        task.providerStatus ? `服务商状态 ${task.providerStatus}` : '',
        task.submitStatus ? `提交状态 ${task.submitStatus}` : '',
    ].filter(Boolean)

    return parts.length ? `${description}（${parts.join(' / ')}）` : description
}

export function getTaskStatusDisplay(task: TaskStatusDisplayInput): TaskStatusDisplay {
    const providerText = getProviderStatusText(task.providerStatus)
    const submitText = getSubmitStatusText(task.submitStatus)
    const fallbackText = getTaskStatusText(task.status)
    const fallbackDescription = getTaskStatusDescription(task.status)

    let text = fallbackText
    let description = fallbackDescription
    let tone: TaskStatusTone = 'neutral'

    switch (task.status) {
        case 'created':
            text = task.workerId ? '等待后台继续处理' : '等待后台接管'
            description = '任务已写入数据库，等待 Worker 读取并锁定执行。'
            tone = 'neutral'
            break
        case 'queued':
            text = '后台队列中'
            description = 'Worker 已识别任务，正在等待可执行窗口。'
            tone = 'neutral'
            break
        case 'submitting':
            text = providerText || submitText || '正在提交服务商'
            description = 'Worker 正在向当前模型服务提交生成请求。'
            tone = 'running'
            break
        case 'submitted':
            text = providerText || '服务商已接收'
            description = task.providerTaskId
                ? '服务商已返回任务 ID，后台将继续查询生成状态。'
                : '请求已提交，等待服务商返回任务 ID。'
            tone = 'running'
            break
        case 'polling':
            text = providerText || '服务商生成中'
            description = '后台正在按服务商任务状态查询生成结果。'
            tone = 'running'
            break
        case 'polling_retryable':
            text = providerText || '查询中断，自动恢复中'
            description = '查询服务商状态时遇到临时错误，后台会按退避策略继续重试。'
            tone = 'warning'
            break
        case 'succeeded_raw':
            text = '已生成，准备保存'
            description = '服务商已返回图片，后台正在准备转存和写入结果。'
            tone = 'saving'
            break
        case 'storing_images':
            text = '正在保存图片'
            description = '图片正在转存到 COS，并同步任务图片引用。'
            tone = 'saving'
            break
        case 'transfer_pending':
            text = '保存失败，等待重试'
            description = '图片已生成，但转存到 COS 时遇到临时问题，后台会继续重试。'
            tone = 'warning'
            break
        case 'submit_unknown':
            text = '提交状态待确认'
            description = '提交服务商时状态不确定。为避免重复扣费，需要手动确认或同步一次。'
            tone = 'warning'
            break
        case 'provider_failed':
            text = '服务商生成失败'
            description = task.lastProviderError || task.error || '服务商明确返回失败。'
            tone = 'error'
            break
        case 'error':
            text = task.error === '已停止生成。' ? '已停止' : '任务失败'
            description = task.error || '任务失败。'
            tone = 'error'
            break
        case 'done':
            text = '完成'
            description = '任务已完成，结果图片已写入本地记录。'
            tone = 'success'
            break
        case 'cancelled':
            text = '已取消'
            description = '任务已取消。'
            tone = 'neutral'
            break
        case 'running':
            text = providerText || '生成中'
            description = '前端直连生成任务正在运行。'
            tone = 'running'
            break
        default:
            text = providerText || fallbackText
            description = fallbackDescription
            tone = isTaskFailed(task.status) ? 'error' : isTaskRunning(task.status) ? 'running' : 'neutral'
    }

    return {
        text,
        description: appendBackendStatus(description, task),
        tone,
        rawStatus: task.providerStatus ? `${task.status}/${task.providerStatus}` : task.status,
    }
}

/**
 * 根据生图任务已耗费的时长（秒），动态流转富有沉浸感与艺术气息的中文创作步骤。
 * 将英文步骤 Creating image, Sketching it out, Making the first draft, Setting the scene, Polishing details, Finishing up, Adding final touches 等
 * 翻译成极具美感且与已流逝时间线完美配合的中文笔触。
 */
export function getCreativeGeneratingText(status: TaskStatus, elapsedSeconds: number): string {
    // 只有在真正的“AI生图处理期”（running 或 polling）才启动动态创作步骤
    if (status !== 'polling' && status !== 'running') {
        return getTaskStatusText(status)
    }

    if (elapsedSeconds < 10) {
        return '正在准备创作' // Creating image (0-9s)
    } else if (elapsedSeconds < 20) {
        return '正在构图起稿' // Sketching it out (10-19s)
    } else if (elapsedSeconds < 35) {
        return '正在铺设初色' // Making the first draft (20-34s)
    } else if (elapsedSeconds < 50) {
        return '正在布景塑造' // Setting the scene (35-49s)
    } else if (elapsedSeconds < 70) {
        return '正在精细润色' // Polishing details (50-69s)
    } else if (elapsedSeconds < 85) {
        return '正在画龙点睛' // Finishing up (70-84s)
    } else {
        return '最终润色中...' // Adding final touches (85s+)
    }
}
