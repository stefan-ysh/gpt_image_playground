import { broadcastTaskUpdated } from '../websocket/ws-server.js'

export async function notifyTaskUpdated(taskId: string, status: string) {
  broadcastTaskUpdated({
    type: 'task_updated',
    taskId,
    status,
    timestamp: Date.now(),
  })
}