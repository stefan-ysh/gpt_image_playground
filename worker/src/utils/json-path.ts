export function getByPath(source: unknown, path?: string | null): unknown {
  if (!path) return source

  return path
    .split('.')
    .filter(Boolean)
    .reduce<unknown>((current, key) => {
      if (current == null) return undefined

      if (/^\d+$/.test(key) && Array.isArray(current)) {
        return current[Number(key)]
      }

      if (typeof current === 'object') {
        return (current as Record<string, unknown>)[key]
      }

      return undefined
    }, source)
}

export function getAllByPath(source: unknown, path?: string | null): unknown[] {
  if (!path) return [source]

  const parts = path.split('.').filter(Boolean)
  let current: unknown[] = [source]

  for (const part of parts) {
    const next: unknown[] = []

    for (const item of current) {
      if (item == null) continue

      if (part === '*') {
        if (Array.isArray(item)) {
          next.push(...item)
        } else if (typeof item === 'object') {
          next.push(...Object.values(item as Record<string, unknown>))
        }
        continue
      }

      if (/^\d+$/.test(part) && Array.isArray(item)) {
        next.push(item[Number(part)])
        continue
      }

      if (typeof item === 'object') {
        next.push((item as Record<string, unknown>)[part])
      }
    }

    current = next
  }

  return current
    .flatMap((item) => (Array.isArray(item) ? item : [item]))
    .filter((item) => item != null)
}