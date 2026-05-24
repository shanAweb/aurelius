import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { Mic, Calendar, Clock, Settings, Plus, Circle, LogOut } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { format, isToday, isYesterday } from 'date-fns'
import MeetingPrompt from './MeetingPrompt'
import styles from './Layout.module.css'

export default function Layout() {
  const { user, logout, meetings, activeMeetingId, loadMeetings, startRecording, stopRecording, upcomingEvents, loadUpcomingEvents, calendarConnected } = useAppStore()
  const navigate = useNavigate()
  const location = useLocation()
  const [showNewMeeting, setShowNewMeeting] = useState(false)
  const [newTitle, setNewTitle] = useState('')

  useEffect(() => {
    loadMeetings()
    loadUpcomingEvents()
    const interval = setInterval(loadMeetings, 10000)
    return () => clearInterval(interval)
  }, [])

  const handleStartRecording = async () => {
    const title = newTitle.trim() || `Meeting — ${format(new Date(), 'MMM d, h:mm a')}`
    const id = await startRecording(title)
    setShowNewMeeting(false)
    setNewTitle('')
    navigate(`/recording/${id}`)
  }

  const groupedMeetings = meetings.reduce((acc, m) => {
    const date = m.started_at ? new Date(m.started_at) : new Date(m.created_at)
    const key = isToday(date) ? 'Today' : isYesterday(date) ? 'Yesterday' : format(date, 'MMM d')
    if (!acc[key]) acc[key] = []
    acc[key].push(m)
    return acc
  }, {} as Record<string, typeof meetings>)

  return (
    <div className={styles.root}>
      {/* macOS titlebar drag region */}
      <div className={styles.titlebar} />

      <aside className={styles.sidebar}>
        <div className={styles.sidebarTop}>
          <div className={styles.logo}>
            <span className={styles.logoIcon}>◈</span>
            <span className={styles.logoText}>Aurelius</span>
          </div>

          {/* Record button */}
          {activeMeetingId ? (
            <button
              className={`${styles.recordBtn} ${styles.recordBtnActive}`}
              onClick={() => { stopRecording(activeMeetingId); navigate('/') }}
            >
              <span className={styles.recordDot} />
              Stop Recording
            </button>
          ) : showNewMeeting ? (
            <div className={styles.newMeetingInput}>
              <input
                autoFocus
                placeholder="Meeting name..."
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleStartRecording(); if (e.key === 'Escape') setShowNewMeeting(false) }}
                className={styles.titleInput}
              />
              <div className={styles.newMeetingActions}>
                <button className={styles.startBtn} onClick={handleStartRecording}><Mic size={12} /> Start</button>
                <button className={styles.cancelBtn} onClick={() => setShowNewMeeting(false)}>✕</button>
              </div>
            </div>
          ) : (
            <button className={styles.recordBtn} onClick={() => setShowNewMeeting(true)}>
              <Plus size={13} /> New Recording
            </button>
          )}

          {/* Upcoming meetings */}
          {calendarConnected && upcomingEvents.length > 0 && (
            <div className={styles.upcomingSection}>
              <div className={styles.sectionLabel}>UPCOMING</div>
              {upcomingEvents.slice(0, 3).map(event => (
                <div key={event.id} className={styles.upcomingEvent}>
                  <div className={styles.upcomingDot} style={{
                    background: event.starts_in_minutes <= 5 ? 'var(--recording-red)' : 'var(--accent)'
                  }} />
                  <div className={styles.upcomingInfo}>
                    <div className={styles.upcomingTitle}>{event.title}</div>
                    <div className={styles.upcomingTime}>
                      {event.starts_in_minutes <= 0 ? 'Now' :
                       event.starts_in_minutes <= 60 ? `in ${Math.round(event.starts_in_minutes)}m` :
                       format(new Date(event.start), 'h:mm a')}
                    </div>
                  </div>
                  {event.starts_in_minutes <= 2 && (
                    <button
                      className={styles.joinRecord}
                      onClick={() => startRecording(event.title, event.id).then(id => navigate(`/recording/${id}`))}
                    >
                      <Mic size={10} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Meeting history */}
        <div className={styles.meetingList}>
          {Object.entries(groupedMeetings).map(([date, items]) => (
            <div key={date}>
              <div className={styles.sectionLabel}>{date}</div>
              {items.map(meeting => (
                <button
                  key={meeting.id}
                  className={`${styles.meetingItem} ${location.pathname.includes(meeting.id) ? styles.active : ''}`}
                  onClick={() => navigate(`/meeting/${meeting.id}`)}
                >
                  <div className={styles.meetingItemLeft}>
                    <StatusDot status={meeting.status} />
                    <span className={styles.meetingItemTitle}>{meeting.title}</span>
                  </div>
                  {meeting.duration_seconds && (
                    <span className={styles.meetingItemDuration}>
                      {formatDuration(meeting.duration_seconds)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ))}

          {meetings.length === 0 && (
            <div className={styles.emptyState}>
              <Mic size={20} className={styles.emptyIcon} />
              <div>No recordings yet</div>
              <div className={styles.emptyHint}>Click "New Recording" to start</div>
            </div>
          )}
        </div>

        {/* Bottom nav */}
        <div className={styles.sidebarBottom}>
          <button className={`${styles.navItem} ${location.pathname === '/' ? styles.navActive : ''}`} onClick={() => navigate('/')}>
            <Clock size={14} /> Recent
          </button>
          <button className={`${styles.navItem} ${calendarConnected ? styles.navActive : ''}`} onClick={() => navigate('/?tab=calendar')}>
            <Calendar size={14} />
            {calendarConnected ? 'Calendar' : 'Connect Calendar'}
          </button>

          {/* Signed-in user + logout */}
          {user && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, paddingTop: 8,
              borderTop: '1px solid var(--border-subtle)',
            }}>
              {user.picture ? (
                <img src={user.picture} alt="" style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0 }} />
              ) : (
                <div style={{
                  width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                  background: 'var(--accent-dim)', color: 'var(--accent)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
                }}>
                  {(user.name || user.email || '?').trim().charAt(0)}
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 12, color: 'var(--text-primary)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {user.name || user.email}
                </div>
              </div>
              <button
                onClick={() => logout()}
                title="Sign out"
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text-tertiary)', display: 'flex', padding: 4,
                }}
              >
                <LogOut size={14} />
              </button>
            </div>
          )}
        </div>
      </aside>

      <main className={styles.main}>
        <Outlet />
      </main>

      {/* Meeting detection popups (instant / auto-started / stopped) */}
      <MeetingPrompt />
    </div>
  )
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    recording: 'var(--recording-red)',
    processing: 'var(--accent)',
    done: 'var(--success)',
    error: 'var(--recording-red)',
    scheduled: 'var(--text-tertiary)',
  }
  return (
    <span style={{
      display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
      background: colors[status] || 'var(--text-tertiary)',
      flexShrink: 0,
      animation: status === 'recording' ? 'pulse-recording 1.5s infinite' : undefined,
    }} />
  )
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const h = Math.floor(m / 60)
  if (h > 0) return `${h}h ${m % 60}m`
  return `${m}m`
}
