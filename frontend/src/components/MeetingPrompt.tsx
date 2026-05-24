import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Mic, Square, X, CheckCircle } from 'lucide-react'
import { format } from 'date-fns'
import { useAppStore } from '../store/appStore'
import { createEventsWebSocket } from '../hooks/useApi'

type Prompt =
  | { kind: 'instant' }
  | { kind: 'autostarted'; meetingId: string; title: string }
  | { kind: 'stopped'; reason: string }
  | null

/**
 * Listens on the app-level events socket and surfaces meeting popups:
 *  - instant_meeting_detected → "Invite Aurelius?" (offer, click to start)
 *  - meeting_autostarted      → "Aurelius joined, taking notes" (Open / Stop)
 *  - recording_stopped        → transient "meeting ended" toast
 * Falls back to a native OS notification when the window is hidden.
 */
export default function MeetingPrompt() {
  const navigate = useNavigate()
  const navRef = useRef(navigate)
  navRef.current = navigate
  const [prompt, setPrompt] = useState<Prompt>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let ws: WebSocket | null = null
    let closed = false
    let retry: ReturnType<typeof setTimeout>

    const nativeNotify = (title: string, body: string) => {
      if (typeof document !== 'undefined' && document.hidden) {
        (window as any).aurelius?.notify?.show({ title, body })
      }
    }

    const connect = () => {
      ws = createEventsWebSocket((msg) => {
        const store = useAppStore.getState()
        switch (msg.type) {
          case 'instant_meeting_detected':
            setPrompt({ kind: 'instant' })
            nativeNotify('Meeting detected', 'Invite Aurelius to take notes?')
            break
          case 'meeting_autostarted':
            store.adoptActiveMeeting(msg.meeting_id)
            setPrompt({ kind: 'autostarted', meetingId: msg.meeting_id, title: msg.title })
            nativeNotify('Aurelius joined', `Taking notes for "${msg.title}"`)
            break
          case 'recording_stopped':
            store.handleRecordingStopped(msg.meeting_id)
            setPrompt({ kind: 'stopped', reason: msg.reason })
            setTimeout(() => setPrompt(p => (p && p.kind === 'stopped' ? null : p)), 6000)
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

  if (!prompt) return null

  const inviteInstant = async () => {
    if (busy) return
    setBusy(true)
    try {
      const title = `Meeting — ${format(new Date(), 'MMM d, h:mm a')}`
      const id = await useAppStore.getState().startRecording(title)
      setPrompt(null)
      navRef.current(`/recording/${id}`)
    } finally {
      setBusy(false)
    }
  }

  const stopAutostarted = async (meetingId: string) => {
    if (busy) return
    setBusy(true)
    try {
      await useAppStore.getState().stopRecording(meetingId)
      setPrompt(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', right: 20, bottom: 20, zIndex: 1000,
      width: 320, padding: '16px 18px',
      background: 'var(--bg-elevated)', border: '1px solid var(--border-mid)',
      borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)',
      animation: 'slide-in-right 0.25s ease forwards',
    }}>
      {prompt.kind === 'instant' && (
        <>
          <Header icon={<Mic size={16} />} title="Looks like you're in a meeting" onClose={() => setPrompt(null)} />
          <p style={bodyText}>Invite Aurelius to take notes? It records locally — nothing leaves your Mac.</p>
          <div style={actionRow}>
            <button style={ghostBtn} onClick={() => setPrompt(null)} disabled={busy}>Ignore</button>
            <button style={primaryBtn} onClick={inviteInstant} disabled={busy}>
              <Mic size={13} /> {busy ? 'Starting…' : 'Invite Aurelius'}
            </button>
          </div>
        </>
      )}

      {prompt.kind === 'autostarted' && (
        <>
          <Header
            icon={<span style={{ color: 'var(--accent)' }}>◈</span>}
            title="Aurelius joined"
            onClose={() => setPrompt(null)}
          />
          <p style={bodyText}>
            Taking notes for <strong style={{ color: 'var(--text-primary)' }}>{prompt.title}</strong>. It’ll stop on its own when the meeting goes quiet.
          </p>
          <div style={actionRow}>
            <button style={ghostBtn} onClick={() => stopAutostarted(prompt.meetingId)} disabled={busy}>
              <Square size={12} fill="currentColor" /> Stop
            </button>
            <button style={primaryBtn} onClick={() => { navRef.current(`/recording/${prompt.meetingId}`); setPrompt(null) }}>
              Open notes
            </button>
          </div>
        </>
      )}

      {prompt.kind === 'stopped' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <CheckCircle size={16} style={{ color: 'var(--success)', flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {prompt.reason === 'silence' ? 'Meeting ended (went quiet)' : 'Recording stopped'} — generating notes…
          </span>
        </div>
      )}
    </div>
  )
}

function Header({ icon, title, onClose }: { icon: React.ReactNode; title: string; onClose: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
      <span style={{ display: 'flex', color: 'var(--accent)' }}>{icon}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>{title}</span>
      <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', display: 'flex', padding: 2 }}>
        <X size={14} />
      </button>
    </div>
  )
}

const bodyText: React.CSSProperties = {
  fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 14,
}
const actionRow: React.CSSProperties = {
  display: 'flex', gap: 8, justifyContent: 'flex-end',
}
const primaryBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '7px 14px', background: 'var(--accent)', color: 'var(--text-inverse)',
  border: 'none', borderRadius: 'var(--radius-sm)', font: '600 12.5px var(--font-sans)', cursor: 'pointer',
}
const ghostBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '7px 14px', background: 'transparent', color: 'var(--text-secondary)',
  border: '1px solid var(--border-mid)', borderRadius: 'var(--radius-sm)', font: '500 12.5px var(--font-sans)', cursor: 'pointer',
}
