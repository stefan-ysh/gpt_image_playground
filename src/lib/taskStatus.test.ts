import { describe, expect, it } from 'vitest'

import { getTaskStatusDisplay } from './taskStatus'

describe('taskStatus display', () => {
  it('uses backend task status for early worker states', () => {
    expect(getTaskStatusDisplay({ status: 'created' }).text).toBe('等待后台接管')
    expect(getTaskStatusDisplay({ status: 'queued' }).text).toBe('后台队列中')
    expect(getTaskStatusDisplay({ status: 'submitting' }).text).toBe('正在提交服务商')
  })

  it('uses provider status to refine polling text', () => {
    expect(getTaskStatusDisplay({
      status: 'polling',
      providerStatus: 'submitted',
    }).text).toBe('服务商已接收')

    expect(getTaskStatusDisplay({
      status: 'polling',
      providerStatus: 'processing',
    }).text).toBe('服务商生成中')
  })

  it('keeps save and recovery states explicit', () => {
    expect(getTaskStatusDisplay({ status: 'succeeded_raw' }).text).toBe('已生成，准备保存')
    expect(getTaskStatusDisplay({ status: 'storing_images' }).text).toBe('正在保存图片')
    expect(getTaskStatusDisplay({ status: 'transfer_pending' }).text).toBe('保存失败，等待重试')
    expect(getTaskStatusDisplay({ status: 'submit_unknown' }).text).toBe('提交状态待确认')
  })

  it('surfaces failure text from backend errors', () => {
    const display = getTaskStatusDisplay({
      status: 'provider_failed',
      lastProviderError: 'provider quota exceeded',
    })

    expect(display.text).toBe('服务商生成失败')
    expect(display.description).toContain('provider quota exceeded')
  })
})
