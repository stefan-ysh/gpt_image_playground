import { describe, expect, it } from 'vitest'
import { isSupported4KRatio, toDragonSizeRatio } from './size'

describe('toDragonSizeRatio', () => {
  it('passes auto through', () => {
    expect(toDragonSizeRatio('auto')).toBe('auto')
    expect(toDragonSizeRatio('AUTO')).toBe('auto')
  })

  it('converts pixel sizes to supported ratio strings', () => {
    expect(toDragonSizeRatio('1024x1024')).toBe('1:1')
    expect(toDragonSizeRatio('1024x1536')).toBe('2:3')
    expect(toDragonSizeRatio('1536x1024')).toBe('3:2')
    expect(toDragonSizeRatio('2048x1152')).toBe('16:9')
    expect(toDragonSizeRatio('1152x2048')).toBe('9:16')
    expect(toDragonSizeRatio('2048x1024')).toBe('2:1')
  })

  it('accepts ratio strings directly', () => {
    expect(toDragonSizeRatio('1:1')).toBe('1:1')
    expect(toDragonSizeRatio('21:9')).toBe('21:9')
    expect(toDragonSizeRatio('9:21')).toBe('9:21')
  })

  it('snaps unsupported ratios to the nearest supported one', () => {
    // 3:1 不在支持列表，最近的是 21:9（delta 0.222 < 2:1 的 0.333）
    expect(toDragonSizeRatio('3072x1024')).toBe('21:9')
    // 5:3（1.667）不在支持列表，最近的是 16:9（1.778，delta 0.067 < 3:2 的 0.1）
    expect(toDragonSizeRatio('5:3')).toBe('16:9')
  })

  it('returns null for garbage input', () => {
    expect(toDragonSizeRatio('')).toBeNull()
    expect(toDragonSizeRatio(null)).toBeNull()
    expect(toDragonSizeRatio('not-a-size')).toBeNull()
  })
})

describe('isSupported4KRatio (DragonCode 文档白名单)', () => {
  it('accepts only the 6 documented 4k ratios', () => {
    expect(isSupported4KRatio('2048x1152')).toBe(true) // 16:9
    expect(isSupported4KRatio('1152x2048')).toBe(true) // 9:16
    expect(isSupported4KRatio('2048x1024')).toBe(true) // 2:1
    expect(isSupported4KRatio('1024x2048')).toBe(true) // 1:2
    expect(isSupported4KRatio('3584x1536')).toBe(true) // 21:9
    expect(isSupported4KRatio('1536x3584')).toBe(true) // 9:21
  })

  it('rejects ratios outside the documented 4k whitelist', () => {
    expect(isSupported4KRatio('1024x1024')).toBe(false) // 1:1 不支持 4k
    expect(isSupported4KRatio('1536x1024')).toBe(false) // 3:2
    expect(isSupported4KRatio('auto')).toBe(false)
  })
})
