import type { DeviceConnection } from '@/domain/schema'

export function openSyncSocket(
  connection: DeviceConnection,
  onNewEvent: () => void,
): WebSocket {
  const url = new URL(`${connection.syncUrl}/shop/${connection.shopId}/ws`)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  const socket = new WebSocket(url, ['my-biller', connection.token])
  socket.addEventListener('message', onNewEvent)
  return socket
}
