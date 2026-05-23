const BASE_URL = 'http://localhost:8765'

export const api = {
  async get(path: string) {
    const res = await fetch(`${BASE_URL}${path}`)
    if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`)
    return res.json()
  },
  async post(path: string, body: unknown) {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`)
    return res.json()
  },
  async delete(path: string) {
    const res = await fetch(`${BASE_URL}${path}`, { method: 'DELETE' })
    if (!res.ok) throw new Error(`DELETE ${path} failed: ${res.status}`)
    return res.json()
  },
}

export function createWebSocket(meetingId: string, onMessage: (data: any) => void): WebSocket {
  const ws = new WebSocket(`ws://localhost:8765/recording/ws/${meetingId}`)
  ws.onmessage = (e) => onMessage(JSON.parse(e.data))
  ws.onerror = (e) => console.error('WS error:', e)
  return ws
}
