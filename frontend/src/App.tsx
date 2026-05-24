import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAppStore } from './store/appStore'
import Layout from './components/Layout'
import SetupFlow from './pages/SetupFlow'
import Dashboard from './pages/Dashboard'
import MeetingDetail from './pages/MeetingDetail'
import RecordingPage from './pages/RecordingPage'
import Login from './pages/Login'
import Signup from './pages/Signup'

export default function App() {
  const { user, setupComplete, checkAuth, checkSetup } = useAppStore()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([checkAuth(), checkSetup()]).finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: 'var(--bg-base)', color: 'var(--text-tertiary)',
        fontFamily: 'var(--font-mono)', fontSize: '12px', letterSpacing: '0.1em',
      }}>
        AURELIUS
      </div>
    )
  }

  // Gate: not signed in → auth pages; signed in but not set up → setup; else app.
  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  if (!setupComplete) {
    return (
      <Routes>
        <Route path="/setup" element={<SetupFlow />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    )
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/meeting/:id" element={<MeetingDetail />} />
        <Route path="/recording/:id" element={<RecordingPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
