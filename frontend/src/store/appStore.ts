import { create } from 'zustand'
import { api } from '../hooks/useApi'

interface Meeting {
  id: string
  title: string
  source: string
  status: string
  started_at: string | null
  ended_at: string | null
  duration_seconds: number | null
  created_at: string
}

interface AppState {
  setupComplete: boolean
  setupStatus: Record<string, any>
  meetings: Meeting[]
  activeMeetingId: string | null
  calendarConnected: boolean
  upcomingEvents: any[]

  checkSetup: () => Promise<void>
  loadMeetings: () => Promise<void>
  startRecording: (title: string, calendarEventId?: string) => Promise<string>
  stopRecording: (meetingId: string) => Promise<void>
  checkCalendar: () => Promise<void>
  connectCalendar: () => Promise<string>
  loadUpcomingEvents: () => Promise<void>
}

export const useAppStore = create<AppState>((set, get) => ({
  setupComplete: false,
  setupStatus: {},
  meetings: [],
  activeMeetingId: null,
  calendarConnected: false,
  upcomingEvents: [],

  checkSetup: async () => {
    try {
      const status = await api.get('/setup/status')
      set({ setupStatus: status, setupComplete: status.ready })
    } catch {
      set({ setupComplete: false })
    }
  },

  loadMeetings: async () => {
    try {
      const meetings = await api.get('/meetings/')
      set({ meetings })
    } catch (e) {
      console.error('Failed to load meetings:', e)
    }
  },

  startRecording: async (title: string, calendarEventId?: string) => {
    const res = await api.post('/recording/start', {
      title,
      calendar_event_id: calendarEventId,
      use_blackhole: true,
    })
    set({ activeMeetingId: res.meeting_id })
    return res.meeting_id
  },

  stopRecording: async (meetingId: string) => {
    await api.post(`/recording/stop/${meetingId}`, {})
    set({ activeMeetingId: null })
    await get().loadMeetings()
  },

  checkCalendar: async () => {
    try {
      const status = await api.get('/calendar/status')
      set({ calendarConnected: status.connected })
    } catch {
      set({ calendarConnected: false })
    }
  },

  connectCalendar: async () => {
    const res = await api.post('/calendar/connect', {})
    return res.auth_url
  },

  loadUpcomingEvents: async () => {
    try {
      const res = await api.get('/calendar/events')
      if (res.connected) {
        set({ upcomingEvents: res.events, calendarConnected: true })
      }
    } catch {
      set({ upcomingEvents: [] })
    }
  },
}))
