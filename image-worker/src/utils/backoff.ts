export function getNextBackoffMs(attempts: number) {
  const steps = [
    5000,
    10000,
    30000,
    60000,
    120000,
    300000,
    600000,
  ]

  return steps[Math.min(attempts, steps.length - 1)]
}