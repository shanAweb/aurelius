import { useEffect, useRef, useState } from 'react'
import { Mic, Square, X } from 'lucide-react'
import { format } from 'date-fns'
import { api, createEventsWebSocket } from '../hooks/useApi'

type BarState =
  | { kind: 'instant' }
  | { kind: 'recording'; meetingId: string; title: string }
  | { kind: 'stopped' }
  | null

const bar = (window as any).aurelius?.bar
const OFFER_TIMEOUT_MS = 20000

/**
 * The always-on-top floating bar (separate Electron window). Listens on the
 * events socket and surfaces meeting prompts at the top of the screen — the
 * user can start/stop notes without ever opening the main app.
 */
export default function MeetingBar() {
  const [state, setState] = useState<BarState>(null)
  const [busy, setBusy] = useState(false)
  const stateRef = useRef<BarState>(null)
  stateRef.current = state

  // Transparent window background so the pill's rounded corners show through.
  useEffect(() => {
    document.body.style.background = 'transparent'
    document.documentElement.style.background = 'transparent'
  }, [])

  // Show/hide the native window as content appears/clears.
  useEffect(() => {
    if (state) bar?.show()
    else bar?.hide()
  }, [state])

  // Auto-dismiss the instant-meeting offer after the countdown (20s).
  useEffect(() => {
    if (state?.kind !== 'instant') return
    const t = setTimeout(() => setState(p => (p?.kind === 'instant' ? null : p)), OFFER_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [state?.kind])

  useEffect(() => {
    let ws: WebSocket | null = null
    let closed = false
    let retry: ReturnType<typeof setTimeout>

    const connect = () => {
      ws = createEventsWebSocket((msg) => {
        switch (msg.type) {
          case 'instant_meeting_detected':
            // Don't override an active recording bar.
            if (stateRef.current?.kind !== 'recording') setState({ kind: 'instant' })
            break
          case 'recording_started':
            setState({ kind: 'recording', meetingId: msg.meeting_id, title: msg.title })
            break
          case 'recording_stopped':
            setState({ kind: 'stopped' })
            setTimeout(() => setState(p => (p?.kind === 'stopped' ? null : p)), 4000)
            break
        }
      })
      ws.onclose = () => { if (!closed) retry = setTimeout(connect, 2000) }
    }
    connect()
    return () => { closed = true; clearTimeout(retry); ws?.close() }
  }, [])

  const startNotes = async () => {
    if (busy) return
    setBusy(true)
    try {
      const title = `Meeting — ${format(new Date(), 'MMM d, h:mm a')}`
      const res = await api.post('/recording/start', { title, use_blackhole: true })
      setState({ kind: 'recording', meetingId: res.meeting_id, title })
    } catch {
      setState(null)
    } finally {
      setBusy(false)
    }
  }

  const stopNotes = async (meetingId: string) => {
    if (busy) return
    setBusy(true)
    try {
      await api.post(`/recording/stop/${meetingId}`, {})
      setState({ kind: 'stopped' })
      setTimeout(() => setState(p => (p?.kind === 'stopped' ? null : p)), 4000)
    } catch {
      setState(null)
    } finally {
      setBusy(false)
    }
  }

  if (!state) return null

  return (
    <div style={wrap}>
      <div style={pill}>
        {state.kind === 'instant' && (
          <>
            <span style={dot('var(--accent)')} />
            <span style={label}>Meeting detected</span>
            <div style={{ flex: 1 }} />
            <button style={primaryBtn} onClick={startNotes} disabled={busy}>
              <Mic size={13} /> {busy ? 'Starting…' : 'Start taking notes'}
            </button>
            <button style={iconBtn} title="Dismiss" onClick={() => setState(null)}>
              <X size={14} />
            </button>
            {/* Depleting green countdown — when it empties, the bar dismisses. */}
            <div style={countdownTrack}>
              <div style={countdownFill} />
            </div>
          </>
        )}

        {state.kind === 'recording' && (
          <>
            <span style={{ ...dot('var(--recording-red)'), animation: 'pulse-recording 1.5s infinite' }} />
            <span style={label}>Taking notes</span>
            <span style={titleText}>{state.title}</span>
            <div style={{ flex: 1 }} />
            <button style={ghostBtn} onClick={() => bar?.openMain()}>Open</button>
            <button style={stopBtn} onClick={() => stopNotes(state.meetingId)} disabled={busy}>
              <Square size={11} fill="currentColor" /> Stop
            </button>
          </>
        )}

        {state.kind === 'stopped' && (
          <>
            <span style={dot('var(--success)')} />
            <span style={label}>Meeting ended — generating notes…</span>
          </>
        )}
      </div>
    </div>
  )
}

const wrap: React.CSSProperties = {
  height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: '0 6px',
}
const pill: React.CSSProperties = {
  position: 'relative', overflow: 'hidden',
  width: '100%', height: 46,
  display: 'flex', alignItems: 'center', gap: 10,
  padding: '0 10px 0 16px',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-mid)',
  borderRadius: 23,
  boxShadow: 'var(--shadow-lg)',
}
const countdownTrack: React.CSSProperties = {
  position: 'absolute', left: 12, right: 12, bottom: 4, height: 3,
  borderRadius: 2, overflow: 'hidden', pointerEvents: 'none',
}
const countdownFill: React.CSSProperties = {
  width: '100%', height: '100%', background: 'var(--success)',
  borderRadius: 2, transformOrigin: 'left',
  animation: `bar-countdown ${OFFER_TIMEOUT_MS}ms linear forwards`,
}
const label: React.CSSProperties = {
  fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap',
}
const titleText: React.CSSProperties = {
  fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap',
  overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160,
}
const dot = (color: string): React.CSSProperties => ({
  width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0,
})
// Interactive controls must opt out of the drag region.
const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties
const primaryBtn: React.CSSProperties = {
  ...noDrag, display: 'flex', alignItems: 'center', gap: 6,
  padding: '7px 14px', background: 'var(--accent)', color: 'var(--text-inverse)',
  border: 'none', borderRadius: 16, font: '600 12.5px var(--font-sans)', cursor: 'pointer',
}
const stopBtn: React.CSSProperties = {
  ...noDrag, display: 'flex', alignItems: 'center', gap: 6,
  padding: '7px 14px', background: 'var(--recording-red-dim)', color: 'var(--recording-red)',
  border: '1px solid var(--recording-red)', borderRadius: 16, font: '600 12.5px var(--font-sans)', cursor: 'pointer',
}
const ghostBtn: React.CSSProperties = {
  ...noDrag, padding: '7px 12px', background: 'transparent', color: 'var(--text-secondary)',
  border: '1px solid var(--border-mid)', borderRadius: 16, font: '500 12.5px var(--font-sans)', cursor: 'pointer',
}
const iconBtn: React.CSSProperties = {
  ...noDrag, display: 'flex', padding: 6, background: 'transparent',
  border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer',
}
