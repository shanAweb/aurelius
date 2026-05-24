import { useEffect } from 'react'
import { useAppStore } from '../store/appStore'
import { createEventsWebSocket } from '../hooks/useApi'

/**
 * Silent listener for the main window. The visible prompts live in the
 * always-on-top bar (a separate window); this just keeps the main app's store
 * in sync when recordings are started/stopped or notes finish — so the sidebar
 * "Stop" button and meeting list reflect backend-driven changes. Renders nothing.
 */
export default function MeetingEventsSync() {
  useEffect(() => {
    let ws: WebSocket | null = null
    let closed = false
    let retry: ReturnType<typeof setTimeout>

    const connect = () => {
      ws = createEventsWebSocket((msg) => {
        const store = useAppStore.getState()
        switch (msg.type) {
          case 'recording_started':
            store.adoptActiveMeeting(msg.meeting_id)
            break
          case 'recording_stopped':
            store.handleRecordingStopped(msg.meeting_id)
            break
          case 'notes_ready':
            store.loadMeetings()
            break
        }
      })
      ws.onclose = () => { if (!closed) retry = setTimeout(connect, 2000) }
    }
    connect()
    return () => { closed = true; clearTimeout(retry); ws?.close() }
  }, [])

  return null
}
