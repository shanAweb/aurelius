import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Mic, Calendar, Clock } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { format, isToday } from 'date-fns'

export default function Dashboard() {
  const { meetings, loadMeetings, upcomingEvents, calendarConnected, connectCalendar, loadUpcomingEvents } = useAppStore()
  const navigate = useNavigate()

  useEffect(() => {
    loadMeetings()
    loadUpcomingEvents()
  }, [])

  const recentMeetings = meetings.filter(m => m.status === 'done').slice(0, 6)

  const handleConnectCalendar = async () => {
    const url = await connectCalendar()
    if ((window as any).aurelius?.shell) {
      (window as any).aurelius.shell.open(url)
    } else {
      window.open(url, '_blank')
    }
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '32px' }}>
      <div style={{ maxWidth: 800 }}>
        {/* Greeting */}
        <div style={{ marginBottom: 32 }}>
          <h1 style={{ marginBottom: 6 }}>
            {getGreeting()}
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
            {format(new Date(), 'EEEE, MMMM d')} · {meetings.length} meeting{meetings.length !== 1 ? 's' : ''} recorded
          </p>
        </div>

        {/* Calendar CTA */}
        {!calendarConnected && (
          <div style={{
            padding: '20px 24px', background: 'var(--bg-elevated)',
            border: '1px solid var(--border-mid)', borderRadius: 'var(--radius-lg)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 28, gap: 16,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{
                width: 40, height: 40, background: 'var(--accent-dim)',
                border: '1px solid var(--accent)', borderRadius: 'var(--radius-md)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--accent)',
              }}>
                <Calendar size={18} />
              </div>
              <div>
                <div style={{ fontWeight: 500, marginBottom: 2 }}>Connect Google Calendar</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  Auto-detect and record meetings from your calendar
                </div>
              </div>
            </div>
            <button
              onClick={handleConnectCalendar}
              style={{
                padding: '8px 16px', background: 'var(--accent)', color: 'var(--text-inverse)',
                border: 'none', borderRadius: 'var(--radius-md)', font: '500 13px var(--font-sans)',
                cursor: 'pointer', flexShrink: 0,
              }}
            >
              Connect
            </button>
          </div>
        )}

        {/* Upcoming events */}
        {calendarConnected && upcomingEvents.length > 0 && (
          <div style={{ marginBottom: 28 }}>
            <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)', letterSpacing: '0.1em', marginBottom: 12 }}>
              TODAY'S MEETINGS
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {upcomingEvents.filter(e => isToday(new Date(e.start))).map(event => (
                <div key={event.id} style={{
                  padding: '12px 16px', background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{event.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                      {format(new Date(event.start), 'h:mm a')} – {format(new Date(event.end), 'h:mm a')}
                    </div>
                  </div>
                  {event.starts_in_minutes <= 2 && event.starts_in_minutes >= -60 && (
                    <span style={{
                      padding: '3px 10px', background: 'var(--recording-red-dim)',
                      color: 'var(--recording-red)', border: '1px solid var(--recording-red)',
                      borderRadius: 20, fontSize: 10, fontWeight: 600, fontFamily: 'var(--font-mono)',
                    }}>
                      STARTING NOW
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent meetings */}
        {recentMeetings.length > 0 && (
          <div>
            <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)', letterSpacing: '0.1em', marginBottom: 12 }}>
              RECENT MEETINGS
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
              {recentMeetings.map(meeting => (
                <MeetingCard key={meeting.id} meeting={meeting} onClick={() => navigate(`/meeting/${meeting.id}`)} />
              ))}
            </div>
          </div>
        )}

        {meetings.length === 0 && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            padding: '60px 20px', gap: 12, color: 'var(--text-tertiary)', textAlign: 'center',
          }}>
            <Mic size={32} style={{ opacity: 0.2 }} />
            <div style={{ fontWeight: 500, color: 'var(--text-secondary)' }}>No meetings yet</div>
            <div style={{ fontSize: 13 }}>Click "New Recording" in the sidebar to get started</div>
          </div>
        )}
      </div>
    </div>
  )
}

function MeetingCard({ meeting, onClick }: { meeting: any, onClick: () => void }) {
  const duration = meeting.duration_seconds
    ? `${Math.floor(meeting.duration_seconds / 60)}m`
    : null

  return (
    <button
      onClick={onClick}
      style={{
        padding: '16px', background: 'var(--bg-elevated)',
        border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
        textAlign: 'left', cursor: 'pointer', font: 'inherit',
        color: 'var(--text-primary)', transition: 'all 0.15s',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-strong)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-subtle)' }}
    >
      <div style={{ fontWeight: 500, marginBottom: 6, fontSize: 13 }}>{meeting.title}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
        {meeting.started_at && <span>{format(new Date(meeting.started_at), 'MMM d')}</span>}
        {duration && (
          <>
            <span>·</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <Clock size={10} /> {duration}
            </span>
          </>
        )}
      </div>
    </button>
  )
}

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}
