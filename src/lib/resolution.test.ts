import { describe, expect, it } from 'vitest'

import { normalizeResolution } from './resolution'

describe('resolution mapping', () => {
  it('uses 1k as the default UI resolution', () => {
    expect(normalizeResolution(undefined)).toBe('1k')
    expect(normalizeResolution('unknown')).toBe('1k')
  })

  it('only accepts documented APIMart resolution values', () => {
    expect(normalizeResolution('1k')).toBe('1k')
    expect(normalizeResolution('2k')).toBe('2k')
    expect(normalizeResolution('4k')).toBe('4k')
    expect(normalizeResolution('bad-value')).toBe('1k')
    expect(normalizeResolution('bad-value', '2k')).toBe('2k')
  })
})
