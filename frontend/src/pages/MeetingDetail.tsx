import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CheckSquare, MessageSquare, AlertCircle, ChevronRight, Users, Lightbulb, Clock } from 'lucide-react'
import { api } from '../hooks/useApi'
import { format } from 'date-fns'

type Tab = 'notes' | 'transcript' | 'actions'

export default function MeetingDetail() {
  const { id } = useParams<{ id: string }>()
  const [meeting, setMeeting] = useState<any>(null)
  const [notes, setNotes] = useState<any>(null)
  const [transcript, setTranscript] = useState<any[]>([])
  const [tab, setTab] = useState<Tab>('notes')
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)

  useEffect(() => {
    if (!id) return
    loadAll()
    let poll: ReturnType<typeof setInterval> | null = null

    const checkProcessing = async () => {
      const m = await api.get(`/meetings/${id}`)
      if (m.status === 'processing') {
        setProcessing(true)
        poll = setInterval(async () => {
          const updated = await api.get(`/meetings/${id}`)
          if (updated.status === 'done') {
            setProcessing(false)
            clearInterval(poll!)
            loadAll()
          }
        }, 3000)
      }
    }

    checkProcessing()
    return () => { if (poll) clearInterval(poll) }
  }, [id])

  const loadAll = async () => {
    if (!id) return
    setLoading(true)
    try {
      const [m, t] = await Promise.all([
        api.get(`/meetings/${id}`),
        api.get(`/meetings/${id}/transcript`),
      ])
      setMeeting(m)
      setTranscript(t.segments || [])

      try {
        const n = await api.get(`/meetings/${id}/notes`)
        setNotes(n)
      } catch {
        setNotes(null)
      }
    } finally {
      setLoading(false)
    }
  }

  if (loading) return <LoadingSkeleton />

  const duration = meeting?.duration_seconds
    ? `${Math.floor(meeting.duration_seconds / 60)}m ${meeting.duration_seconds % 60}s`
    : null

  const speakerColors: Record<string, string> = {}
  const colors = ['var(--accent)', '#7eb8f7', '#a78bfa', '#fb923c', '#34d399']
  let colorIdx = 0
  transcript.forEach(seg => {
    if (seg.speaker && !speakerColors[seg.speaker]) {
      speakerColors[seg.speaker] = colors[colorIdx++ % colors.length]
    }
  })

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '24px 32px 0', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-surface)' }}>
        <div style={{ marginBottom: 8 }}>
          <h1 style={{ fontSize: 22, marginBottom: 6 }}>{meeting?.title || 'Untitled Meeting'}</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--text-tertiary)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
            {meeting?.started_at && (
              <span>{format(new Date(meeting.started_at), 'MMM d, yyyy · h:mm a')}</span>
            )}
            {duration && <span>· {duration}</span>}
            {notes?.sentiment && (
              <span style={{
                padding: '2px 8px', background: 'var(--bg-overlay)', borderRadius: 20,
                color: 'var(--text-secondary)', fontFamily: 'var(--font-sans)', fontSize: 11,
              }}>
                {notes.sentiment}
              </span>
            )}
          </div>
        </div>

        {processing && (
          <div style={{
            padding: '10px 16px', background: 'var(--accent-dim)',
            border: '1px solid var(--accent)', borderRadius: 'var(--radius-md)',
            color: 'var(--accent)', fontSize: 12, marginBottom: 12,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', animation: 'pulse-recording 1s infinite' }} />
            Generating notes and processing transcript...
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0 }}>
          {(['notes', 'transcript', 'actions'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: '10px 18px',
                background: 'none', border: 'none',
                color: tab === t ? 'var(--text-primary)' : 'var(--text-tertiary)',
                font: `${tab === t ? '500' : '400'} 13px var(--font-sans)`,
                cursor: 'pointer',
                borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
                transition: 'all 0.15s',
                textTransform: 'capitalize',
              }}
            >
              {t}
              {t === 'actions' && notes?.action_items?.length > 0 && (
                <span style={{
                  marginLeft: 6, padding: '1px 6px', background: 'var(--accent-dim)',
                  color: 'var(--accent)', borderRadius: 10, fontSize: 10, fontWeight: 600,
                }}>
                  {notes.action_items.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }} className="selectable">
        {tab === 'notes' && notes && <NotesView notes={notes} />}
        {tab === 'notes' && !notes && !processing && (
          <EmptyState icon={<Lightbulb size={24} />} title="No notes yet" description="Notes will appear here once the meeting is processed." />
        )}

        {tab === 'transcript' && (
          <TranscriptView segments={transcript} speakerColors={speakerColors} />
        )}

        {tab === 'actions' && notes && <ActionsView notes={notes} />}
        {tab === 'actions' && !notes && (
          <EmptyState icon={<CheckSquare size={24} />} title="No action items yet" description="Action items will appear after the meeting is processed." />
        )}
      </div>
    </div>
  )
}

function NotesView({ notes }: { notes: any }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28, maxWidth: 740 }}>
      {/* Summary */}
      <Section icon={<MessageSquare size={15} />} title="Summary">
        <p style={{ fontSize: 15, lineHeight: 1.8, color: 'var(--text-primary)' }}>{notes.meeting_summary}</p>
      </Section>

      {/* Key Decisions */}
      {notes.key_decisions?.length > 0 && (
        <Section icon={<CheckSquare size={15} />} title="Key Decisions">
          {notes.key_decisions.map((d: any, i: number) => (
            <DecisionCard key={i} decision={d} />
          ))}
        </Section>
      )}

      {/* Topics */}
      {notes.topics_discussed?.length > 0 && (
        <Section icon={<ChevronRight size={15} />} title="Topics Discussed">
          {notes.topics_discussed.map((t: any, i: number) => (
            <TopicCard key={i} topic={t} />
          ))}
        </Section>
      )}

      {/* Open Questions */}
      {notes.open_questions?.length > 0 && (
        <Section icon={<AlertCircle size={15} />} title="Open Questions">
          {notes.open_questions.map((q: any, i: number) => (
            <div key={i} style={{
              padding: '10px 14px', background: 'var(--bg-elevated)',
              borderLeft: '3px solid var(--accent)',
              borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
              marginBottom: 8,
            }}>
              <div style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 2 }}>{q.question}</div>
              {q.raised_by && <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Raised by {q.raised_by}</div>}
            </div>
          ))}
        </Section>
      )}

      {/* Concerns */}
      {notes.concerns_raised?.length > 0 && (
        <Section icon={<AlertCircle size={15} />} title="Concerns & Risks">
          {notes.concerns_raised.map((c: any, i: number) => (
            <div key={i} style={{
              padding: '10px 14px', background: 'var(--recording-red-dim)',
              borderLeft: `3px solid ${c.severity === 'high' ? 'var(--recording-red)' : 'var(--accent)'}`,
              borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
              marginBottom: 8,
            }}>
              <div style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 2 }}>{c.concern}</div>
              {c.raised_by && <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>— {c.raised_by} · {c.severity} severity</div>}
            </div>
          ))}
        </Section>
      )}

      {/* Participants */}
      {notes.participants?.length > 0 && (
        <Section icon={<Users size={15} />} title="Participants">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {notes.participants.map((p: any, i: number) => (
              <div key={i} style={{
                padding: '8px 14px', background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
                fontSize: 12,
              }}>
                <div style={{ fontWeight: 500 }}>{p.name}</div>
                {p.role && <div style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>{p.role}</div>}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Next Steps */}
      {notes.next_steps && (
        <Section icon={<Clock size={15} />} title="Next Steps">
          <p style={{ fontSize: 14, lineHeight: 1.8, color: 'var(--text-secondary)' }}>{notes.next_steps}</p>
        </Section>
      )}

      {/* Keywords */}
      {notes.keywords?.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingTop: 8 }}>
          {notes.keywords.map((kw: string, i: number) => (
            <span key={i} style={{
              padding: '3px 10px', background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)', borderRadius: 20,
              fontSize: 11, color: 'var(--text-tertiary)',
            }}>
              {kw}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function ActionsView({ notes }: { notes: any }) {
  const priorityColors: Record<string, string> = {
    high: 'var(--recording-red)', medium: 'var(--accent)', low: 'var(--text-tertiary)'
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {notes.action_items?.map((item: any, i: number) => (
          <div key={i} style={{
            padding: '14px 16px', background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>{item.task}</div>
                {item.context && <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{item.context}</div>}
              </div>
              <span style={{
                padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600,
                background: `color-mix(in srgb, ${priorityColors[item.priority]} 15%, transparent)`,
                color: priorityColors[item.priority] || 'var(--text-tertiary)',
                flexShrink: 0,
              }}>
                {item.priority?.toUpperCase()}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
              {item.owner && (
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                  👤 {item.owner}
                </span>
              )}
              {item.deadline && (
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                  📅 {item.deadline}
                </span>
              )}
            </div>
          </div>
        ))}
        {(!notes.action_items || notes.action_items.length === 0) && (
          <EmptyState icon={<CheckSquare size={24} />} title="No action items" description="No action items were identified in this meeting." />
        )}
      </div>
    </div>
  )
}

function TranscriptView({ segments, speakerColors }: { segments: any[], speakerColors: Record<string, string> }) {
  const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

  if (segments.length === 0) {
    return <EmptyState icon={<MessageSquare size={24} />} title="No transcript" description="The transcript will appear here after processing." />
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 740 }}>
      {segments.map((seg, i) => (
        <div key={i} style={{ display: 'flex', gap: 16 }}>
          <div style={{ width: 72, flexShrink: 0 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-tertiary)' }}>
              {formatTime(seg.start_seconds ?? seg.start)}
            </span>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{
              fontSize: 10, fontWeight: 600, marginBottom: 3, fontFamily: 'var(--font-mono)',
              color: speakerColors[seg.speaker] || 'var(--accent)', letterSpacing: '0.08em',
            }}>
              {(seg.speaker || 'SPEAKER A').toUpperCase()}
            </div>
            <div style={{ fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.75 }}>{seg.text}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

function Section({ icon, title, children }: { icon: React.ReactNode, title: string, children: React.ReactNode }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12, color: 'var(--text-tertiary)' }}>
        {icon}
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{title}</span>
      </div>
      {children}
    </div>
  )
}

function DecisionCard({ decision }: { decision: any }) {
  return (
    <div style={{
      padding: '12px 14px', background: 'var(--bg-elevated)',
      border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', marginBottom: 8,
    }}>
      <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>{decision.decision}</div>
      {decision.context && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>{decision.context}</div>}
      <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-tertiary)' }}>
        {decision.made_by && <span>— {decision.made_by}</span>}
        {decision.timestamp && <span>at {decision.timestamp}</span>}
      </div>
    </div>
  )
}

function TopicCard({ topic }: { topic: any }) {
  return (
    <div style={{
      padding: '12px 14px', background: 'var(--bg-elevated)',
      border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', marginBottom: 8,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{topic.topic}</div>
        {topic.timestamp_start && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-tertiary)' }}>{topic.timestamp_start}</span>
        )}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7 }}>{topic.summary}</div>
      {topic.outcome && (
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-tertiary)' }}>
          Outcome: <span style={{ color: 'var(--text-secondary)' }}>{topic.outcome}</span>
        </div>
      )}
    </div>
  )
}

function EmptyState({ icon, title, description }: { icon: React.ReactNode, title: string, description: string }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '60px 20px', gap: 10, color: 'var(--text-tertiary)', textAlign: 'center',
    }}>
      <div style={{ opacity: 0.3 }}>{icon}</div>
      <div style={{ fontWeight: 500, color: 'var(--text-secondary)' }}>{title}</div>
      <div style={{ fontSize: 12 }}>{description}</div>
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div style={{ padding: '32px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {[280, 200, 240].map((w, i) => (
        <div key={i} style={{
          height: 16, width: w, borderRadius: 4,
          background: 'linear-gradient(90deg, var(--bg-elevated) 25%, var(--bg-overlay) 50%, var(--bg-elevated) 75%)',
          backgroundSize: '200% 100%',
          animation: 'shimmer 1.5s infinite',
        }} />
      ))}
    </div>
  )
}
