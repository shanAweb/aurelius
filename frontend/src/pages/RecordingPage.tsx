import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { MicOff, Square, Clock } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { createWebSocket } from '../hooks/useApi'
import { format } from 'date-fns'

interface TranscriptSegment {
  start: number
  end: number
  text: string
  speaker: string
}

export default function RecordingPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { stopRecording } = useAppStore()
  const [segments, setSegments] = useState<TranscriptSegment[]>([])
  const [elapsed, setElapsed] = useState(0)
  const [isStopping, setIsStopping] = useState(false)
  const startTime = useRef(Date.now())
  const transcriptRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WebSocket | null>(null)

  // Timer
  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime.current) / 1000))
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  // WebSocket for live transcript
  useEffect(() => {
    if (!id) return
    wsRef.current = createWebSocket(id, (msg) => {
      if (msg.type === 'transcript_chunk') {
        setSegments(prev => {
          const existingStarts = new Set(prev.map(s => s.start))
          const newSegs = msg.segments.filter((s: TranscriptSegment) => !existingStarts.has(s.start))
          return [...prev, ...newSegs]
        })
      }
    })

    // Tray indicator
    ;(window as any).aurelius?.tray.setRecording(true)

    return () => {
      wsRef.current?.close()
      ;(window as any).aurelius?.tray.setRecording(false)
    }
  }, [id])

  // Auto-scroll transcript
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight
    }
  }, [segments])

  const handleStop = async () => {
    if (!id || isStopping) return
    setIsStopping(true)
    wsRef.current?.close()
    await stopRecording(id)
    navigate(`/meeting/${id}`)
  }

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60)
    const h = Math.floor(m / 60)
    if (h > 0) return `${h}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
    return `${m}:${String(s % 60).padStart(2, '0')}`
  }

  const formatSegTime = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${String(s).padStart(2, '0')}`
  }

  const speakerColors: Record<string, string> = {
    'Speaker A': 'var(--accent)',
    'Speaker B': '#7eb8f7',
    'Speaker C': '#a78bfa',
    'Speaker D': '#fb923c',
    'Speaker E': '#34d399',
  }

  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      background: 'var(--bg-base)',
    }}>
      {/* Recording header */}
      <div style={{
        padding: '20px 32px 16px',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'var(--bg-surface)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 12px',
            background: 'var(--recording-red-dim)',
            border: '1px solid var(--recording-red)',
            borderRadius: 'var(--radius-md)',
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: 'var(--recording-red)',
              animation: 'pulse-recording 1.5s infinite',
              display: 'inline-block',
            }} />
            <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--recording-red)', fontWeight: 500 }}>
              RECORDING
            </span>
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 300, color: 'var(--text-primary)', letterSpacing: '0.05em' }}>
            {formatTime(elapsed)}
          </div>
        </div>

        <button
          onClick={handleStop}
          disabled={isStopping}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 18px',
            background: isStopping ? 'var(--bg-elevated)' : 'var(--bg-overlay)',
            border: '1px solid var(--border-mid)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--text-primary)',
            font: '500 13px var(--font-sans)',
            cursor: isStopping ? 'not-allowed' : 'pointer',
            transition: 'all 0.15s',
          }}
        >
          <Square size={13} fill="currentColor" />
          {isStopping ? 'Processing...' : 'Stop & Process'}
        </button>
      </div>

      {/* Waveform visualizer placeholder */}
      <div style={{
        padding: '12px 32px',
        borderBottom: '1px solid var(--border-subtle)',
        background: 'var(--bg-surface)',
        display: 'flex', alignItems: 'center', gap: 3,
        height: 48,
      }}>
        {Array.from({ length: 60 }, (_, i) => (
          <div
            key={i}
            style={{
              width: 3, borderRadius: 2,
              background: 'var(--accent)',
              opacity: 0.4 + Math.random() * 0.6,
              height: `${20 + Math.random() * 60}%`,
              animation: `pulse-recording ${0.5 + Math.random()}s infinite`,
              animationDelay: `${Math.random() * 0.5}s`,
            }}
          />
        ))}
      </div>

      {/* Live transcript */}
      <div ref={transcriptRef} style={{
        flex: 1, overflowY: 'auto',
        padding: '24px 32px',
      }} className="selectable">
        {segments.length === 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            height: '100%', color: 'var(--text-tertiary)', gap: 12,
          }}>
            <MicOff size={32} style={{ opacity: 0.3 }} />
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
              Listening... transcript will appear here
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {segments.map((seg, i) => (
              <div
                key={i}
                className="animate-fade-in"
                style={{ display: 'flex', gap: 16 }}
              >
                <div style={{ width: 80, flexShrink: 0 }}>
                  <div style={{
                    fontFamily: 'var(--font-mono)', fontSize: 10,
                    color: 'var(--text-tertiary)', paddingTop: 2,
                  }}>
                    {formatSegTime(seg.start)}
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{
                    fontSize: 11, fontWeight: 600, marginBottom: 3,
                    color: speakerColors[seg.speaker] || 'var(--text-secondary)',
                    fontFamily: 'var(--font-mono)',
                    letterSpacing: '0.05em',
                  }}>
                    {seg.speaker?.toUpperCase() || 'SPEAKER A'}
                  </div>
                  <div style={{ fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.7 }}>
                    {seg.text}
                  </div>
                </div>
              </div>
            ))}
            {/* Live cursor */}
            <div style={{ display: 'flex', gap: 16 }}>
              <div style={{ width: 80 }} />
              <div style={{ display: 'flex', gap: 3, paddingTop: 6 }}>
                {[0, 1, 2].map(i => (
                  <div key={i} style={{
                    width: 4, height: 4, borderRadius: '50%',
                    background: 'var(--text-tertiary)',
                    animation: `pulse-recording 1s infinite`,
                    animationDelay: `${i * 0.2}s`,
                  }} />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
