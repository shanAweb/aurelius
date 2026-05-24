import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Loader, AlertCircle } from 'lucide-react'
import { useAppStore } from '../store/appStore'

type Mode = 'login' | 'signup'

const copy = {
  login: {
    title: 'Welcome back',
    subtitle: 'Sign in to your local Aurelius account.',
    submit: 'Sign in',
    switchText: 'New to Aurelius?',
    switchLink: 'Create an account',
    switchTo: '/signup',
  },
  signup: {
    title: 'Create your account',
    subtitle: 'Everything stays on your Mac — no cloud, no API keys.',
    submit: 'Create account',
    switchText: 'Already have an account?',
    switchLink: 'Sign in',
    switchTo: '/login',
  },
} as const

export default function AuthForm({ mode }: { mode: Mode }) {
  const { login, signup, loginWithGoogle } = useAppStore()
  const navigate = useNavigate()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [googleBusy, setGoogleBusy] = useState(false)

  const t = copy[mode]
  const busy = submitting || googleBusy

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      if (mode === 'signup') await signup(name, email, password)
      else await login(email, password)
      navigate('/')
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleGoogle = async () => {
    setError(null)
    setGoogleBusy(true)
    try {
      await loginWithGoogle()
      navigate('/')
    } catch (err: any) {
      setError(err.message || 'Google sign-in failed. Please try again.')
    } finally {
      setGoogleBusy(false)
    }
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100vh', background: 'var(--bg-base)', padding: 40,
    }}>
      <div style={{ width: '100%', maxWidth: 380, animation: 'fade-in 0.4s ease' }}>
        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28 }}>
          <span style={{ fontSize: 24, color: 'var(--accent)' }}>◈</span>
          <h1 style={{ fontSize: 26 }}>Aurelius</h1>
        </div>

        <h2 style={{ fontSize: 20, marginBottom: 6 }}>{t.title}</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 24, lineHeight: 1.6 }}>
          {t.subtitle}
        </p>

        {/* Continue with Google */}
        <button
          type="button"
          onClick={handleGoogle}
          disabled={busy}
          style={{
            width: '100%', padding: '11px 16px', marginBottom: 18,
            background: '#ffffff', color: '#1f1f1f',
            border: 'none', borderRadius: 'var(--radius-md)',
            font: '500 14px var(--font-sans)',
            cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          }}
        >
          {googleBusy
            ? <Loader size={16} style={{ animation: 'spin 1s linear infinite' }} />
            : <GoogleIcon />}
          {googleBusy ? 'Waiting for Google…' : 'Continue with Google'}
        </button>

        {/* Divider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '6px 0 18px' }}>
          <div style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>OR</span>
          <div style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
        </div>

        {/* Email / password */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {mode === 'signup' && (
            <Field label="Name">
              <input
                type="text" value={name} onChange={e => setName(e.target.value)}
                placeholder="Your name" autoComplete="name" style={inputStyle}
              />
            </Field>
          )}
          <Field label="Email">
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com" autoComplete="email" required style={inputStyle}
            />
          </Field>
          <Field label="Password">
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              required style={inputStyle}
            />
          </Field>

          {error && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
              background: 'var(--recording-red-dim)', border: '1px solid var(--recording-red)',
              borderRadius: 'var(--radius-sm)', color: 'var(--recording-red)', fontSize: 12,
            }}>
              <AlertCircle size={14} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit" disabled={busy}
            style={{
              width: '100%', padding: '11px 16px', marginTop: 4,
              background: 'var(--accent)', color: 'var(--text-inverse)',
              border: 'none', borderRadius: 'var(--radius-md)',
              font: '600 14px var(--font-sans)',
              cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            {submitting && <Loader size={15} style={{ animation: 'spin 1s linear infinite' }} />}
            {t.submit}
          </button>
        </form>

        {/* Switch mode */}
        <p style={{ marginTop: 22, fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center' }}>
          {t.switchText}{' '}
          <Link to={t.switchTo} style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 500 }}>
            {t.switchLink}
          </Link>
        </p>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', letterSpacing: '0.05em' }}>
        {label.toUpperCase()}
      </span>
      {children}
    </label>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px',
  background: 'var(--bg-elevated)', color: 'var(--text-primary)',
  border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)',
  font: '400 14px var(--font-sans)', outline: 'none',
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  )
}
