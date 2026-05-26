import { WebSocketServer } from 'ws'
import { config } from '../config.js'

const wss = new WebSocketServer({
  port: config.wsPort,
})

console.log(`WebSocket server listening on :${config.wsPort}`)

export function broadcastTaskUpdated(payload: unknown) {
  const message = JSON.stringify(payload)

  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(message)
    }
  }
}