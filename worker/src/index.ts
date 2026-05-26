import { logger } from './logger.js'
import { startWorkerLoop } from './services/worker-loop.js'

async function bootstrap() {
  logger.info('starting cosmorigin image worker')

  await startWorkerLoop()
}

bootstrap().catch((error) => {
  console.error(error)
  process.exit(1)
})