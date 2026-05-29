import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { createDefaultFreegenProfile, DEFAULT_SETTINGS } from './apiProfiles'
import { callFreegenImageApi, getFreegenGenerateErrorMessage, getFreegenRatioId } from './freegenImageApi'

describe('freegen image API', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('maps common app sizes to Freegen-supported ratios', () => {
    expect(getFreegenRatioId('auto')).toBe('1:1')
    expect(getFreegenRatioId('1024x1024')).toBe('1:1')
    expect(getFreegenRatioId('1920x1080')).toBe('16:9')
    expect(getFreegenRatioId('1080x1920')).toBe('9:16')
    expect(getFreegenRatioId('1200x900')).toBe('4:3')
  })

  it('normalizes successful image data into CallApiResult', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      job_id: 'job-1',
      image_data: 'aW1hZ2U=',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await expect(callFreegenImageApi({
      settings: DEFAULT_SETTINGS,
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS, size: '16:9' },
      inputImageDataUrls: [],
    }, createDefaultFreegenProfile())).resolves.toEqual({
      images: ['data:image/png;base64,aW1hZ2U='],
      actualParams: { size: '16:9', n: 1 },
      actualParamsList: [{ size: '16:9', n: 1 }],
    })
  })

  it('rejects more than one reference image before sending a request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    await expect(callFreegenImageApi({
      settings: DEFAULT_SETTINGS,
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: ['data:image/png;base64,aaa', 'data:image/png;base64,bbb'],
    }, createDefaultFreegenProfile())).rejects.toThrow('最多只支持 1 张参考图')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns a friendly message when the local Freegen route is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'))

    await expect(callFreegenImageApi({
      settings: DEFAULT_SETTINGS,
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    }, createDefaultFreegenProfile())).rejects.toThrow('z-image 请求失败，请检查网络或稍后重试。')
  })

  it('returns a friendly message for malformed route responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('not-json', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    }))

    await expect(callFreegenImageApi({
      settings: DEFAULT_SETTINGS,
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    }, createDefaultFreegenProfile())).rejects.toThrow('z-image 返回格式异常，请稍后重试。')
  })

  it('extracts clear messages from Freegen failure response variants', () => {
    expect(getFreegenGenerateErrorMessage({ ok: false, error: 'bad prompt' })).toBe('bad prompt')
    expect(getFreegenGenerateErrorMessage({ ok: false, step: 'signer', status: 502 })).toBe('z-image 签名失败：HTTP 502')
    expect(getFreegenGenerateErrorMessage({ ok: false, step: 'create_job', response: { error: { message: 'quota exceeded' } } })).toBe('quota exceeded')
    expect(getFreegenGenerateErrorMessage({ ok: false, step: 'websocket', logs: [{ message: 'connection closed' }] })).toBe('connection closed')
  })
})
