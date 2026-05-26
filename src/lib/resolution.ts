export type ImageResolution = '1k' | '2k' | '4k'

export function normalizeResolution(value: unknown, fallback: ImageResolution = '1k'): ImageResolution {
  if (value === '1k' || value === '2k' || value === '4k') return value
  return fallback
}
