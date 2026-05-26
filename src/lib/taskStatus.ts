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
    'submit_unknown',
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
            return '提交服务商时状态不确定，后台会继续确认。'
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