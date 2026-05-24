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

export interface User {
  id: string
  email: string
  name: string | null
  provider: 'local' | 'google'
  picture: string | null
}

interface AppState {
  user: User | null
  authChecked: boolean
  setupComplete: boolean
  setupStatus: Record<string, any>
  meetings: Meeting[]
  activeMeetingId: string | null
  calendarConnected: boolean
  upcomingEvents: any[]

  checkAuth: () => Promise<void>
  login: (email: string, password: string) => Promise<void>
  signup: (name: string, email: string, password: string) => Promise<void>
  loginWithGoogle: () => Promise<void>
  logout: () => Promise<void>
  checkSetup: () => Promise<void>
  loadMeetings: () => Promise<void>
  startRecording: (title: string, calendarEventId?: string) => Promise<string>
  stopRecording: (meetingId: string) => Promise<void>
  checkCalendar: () => Promise<void>
  connectCalendar: () => Promise<string>
  loadUpcomingEvents: () => Promise<void>
}

export const useAppStore = create<AppState>((set, get) => ({
  user: null,
  authChecked: false,
  setupComplete: false,
  setupStatus: {},
  meetings: [],
  activeMeetingId: null,
  calendarConnected: false,
  upcomingEvents: [],

  checkAuth: async () => {
    try {
      const { user } = await api.get('/auth/me')
      set({ user, authChecked: true })
    } catch {
      set({ user: null, authChecked: true })
    }
  },

  login: async (email: string, password: string) => {
    const { user } = await api.post('/auth/login', { email, password })
    set({ user })
  },

  signup: async (name: string, email: string, password: string) => {
    const { user } = await api.post('/auth/signup', { name, email, password })
    set({ user })
  },

  loginWithGoogle: async () => {
    const { auth_url } = await api.post('/auth/google', {})

    // Open Google's consent screen in the system browser.
    const shell = (window as any).aurelius?.shell
    if (shell) shell.open(auth_url)
    else window.open(auth_url, '_blank')

    // The backend creates the session once the OAuth callback fires; poll for it.
    await new Promise<void>((resolve, reject) => {
      let tries = 0
      const interval = setInterval(async () => {
        tries++
        try {
          const { user } = await api.get('/auth/me')
          if (user) {
            clearInterval(interval)
            // Google sign-in also granted calendar access — reflect it.
            set({ user, calendarConnected: true })
            resolve()
            return
          }
        } catch {
          /* ignore transient polling errors */
        }
        if (tries >= 80) {
          clearInterval(interval)
          reject(new Error('Timed out waiting for Google sign-in. Please try again.'))
        }
      }, 1500)
    })
  },

  logout: async () => {
    try {
      await api.post('/auth/logout', {})
    } finally {
      set({ user: null, calendarConnected: false, upcomingEvents: [] })
    }
  },

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
