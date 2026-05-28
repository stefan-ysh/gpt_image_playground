import type { TaskStatus } from '../types'

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

    if (elapsedSeconds < 5) {
        return '正在准备创作' // Creating image (0-4s)
    } else if (elapsedSeconds < 10) {
        return '正在构图起稿' // Sketching it out (5-9s)
    } else if (elapsedSeconds < 16) {
        return '正在铺设初色' // Making the first draft (10-15s)
    } else if (elapsedSeconds < 23) {
        return '正在布景塑造' // Setting the scene (16-22s)
    } else if (elapsedSeconds < 30) {
        return '正在精细润色' // Polishing details (23-29s)
    } else if (elapsedSeconds < 37) {
        return '正在画龙点睛' // Finishing up (30-36s)
    } else {
        return '最终润色中...' // Adding final touches (37s+)
    }
}
