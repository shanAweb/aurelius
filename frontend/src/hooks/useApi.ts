const BASE_URL = 'http://localhost:8765'

// Pull a human-readable message out of a failed response. FastAPI puts the
// message in `detail`; fall back to a generic status string.
async function errorFrom(res: Response, method: string, path: string): Promise<Error> {
  try {
    const data = await res.json()
    if (data && typeof data.detail === 'string') return new Error(data.detail)
  } catch {
    /* response had no JSON body */
  }
  return new Error(`${method} ${path} failed: ${res.status}`)
}

export const api = {
  async get(path: string) {
    const res = await fetch(`${BASE_URL}${path}`)
    if (!res.ok) throw await errorFrom(res, 'GET', path)
    return res.json()
  },
  async post(path: string, body: unknown) {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw await errorFrom(res, 'POST', path)
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

// App-level events channel (meeting auto-started, instant meeting detected,
// recording stopped, notes ready). Connect once while the app is running.
export function createEventsWebSocket(onMessage: (data: any) => void): WebSocket {
  const ws = new WebSocket('ws://localhost:8765/events/ws')
  ws.onmessage = (e) => onMessage(JSON.parse(e.data))
  ws.onerror = () => { /* reconnect handled by caller */ }
  return ws
}
