import { config } from '../config.js'
import { logger } from '../logger.js'
import { lockTask, pickRunnableTasks, releaseTask } from '../db/tasks.js'
import { runTask } from './task-runner.js'

let running = false

async function processOne(task: any) {
  const locked = await lockTask(
    task.id,
    config.workerId,
    Date.now() + config.lockTtlMs,
  )

  if (!locked) return

  try {
    await runTask(task)
  } catch (error) {
    logger.error('run task failed', task.id, error)
  } finally {
    await releaseTask(task.id, config.workerId).catch((error) => {
      logger.warn('release task lock failed', task.id, error)
    })
  }
}

export async function startWorkerLoop() {
  if (running) return
  running = true

  logger.info('worker loop started', {
    workerId: config.workerId,
    concurrency: config.concurrency,
  })

  while (true) {
    try {
      const tasks = await pickRunnableTasks(config.concurrency)

      await Promise.all(tasks.map((task) => processOne(task)))
    } catch (error) {
      logger.error('worker loop error', error)
    }

    await new Promise((resolve) => {
      setTimeout(resolve, config.pollIntervalMs)
    })
  }
}