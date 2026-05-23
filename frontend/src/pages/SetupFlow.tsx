import { useState, useEffect } from 'react'
import { CheckCircle, Circle, Loader, Download, AlertCircle, Mic } from 'lucide-react'
import { api } from '../hooks/useApi'
import { useAppStore } from '../store/appStore'

type StepStatus = 'idle' | 'loading' | 'done' | 'error'

interface Step {
  id: string
  label: string
  description: string
  status: StepStatus
  progress?: number
  error?: string
}

export default function SetupFlow() {
  const { checkSetup } = useAppStore()
  const [steps, setSteps] = useState<Step[]>([
    { id: 'whisper', label: 'Whisper Model', description: 'Speech-to-text (~74 MB)', status: 'idle' },
    { id: 'llm', label: 'Language Model', description: 'Note generation, Mistral 7B (~4 GB)', status: 'idle' },
    { id: 'blackhole', label: 'BlackHole Audio Driver', description: 'Captures system + mic audio', status: 'idle' },
    { id: 'microphone', label: 'Microphone Permission', description: 'Required for recording', status: 'idle' },
  ])
  const [setupStatus, setSetupStatus] = useState<any>(null)
  const [started, setStarted] = useState(false)
  const [allDone, setAllDone] = useState(false)

  useEffect(() => {
    loadStatus()
  }, [])

  const loadStatus = async () => {
    try {
      const status = await api.get('/setup/status')
      setSetupStatus(status)

      // Pre-populate what's already done
      setSteps(prev => prev.map(s => {
        if (s.id === 'whisper' && status.whisper_model?.available) return { ...s, status: 'done' }
        if (s.id === 'llm' && status.llm_model?.available) return { ...s, status: 'done' }
        if (s.id === 'blackhole' && status.blackhole?.available) return { ...s, status: 'done' }
        if (s.id === 'microphone' && status.microphone_permission?.granted) return { ...s, status: 'done' }
        return s
      }))

      if (status.ready) setAllDone(true)
    } catch (e) {
      console.error('Setup status failed:', e)
    }
  }

  const updateStep = (id: string, update: Partial<Step>) => {
    setSteps(prev => prev.map(s => s.id === id ? { ...s, ...update } : s))
  }

  const runSetup = async () => {
    setStarted(true)

    // 1. Download Whisper model
    if (setupStatus?.whisper_model?.available) {
      updateStep('whisper', { status: 'done' })
    } else {
      updateStep('whisper', { status: 'loading' })
      try {
        await api.post('/setup/download-model', { model_name: 'ggml-base.en.bin' })
        // Poll progress
        await pollDownload('whisper', 'ggml-base.en.bin')
        updateStep('whisper', { status: 'done' })
      } catch (e: any) {
        updateStep('whisper', { status: 'error', error: e.message })
        return
      }
    }

    // 2. Download LLM model
    if (setupStatus?.llm_model?.available) {
      updateStep('llm', { status: 'done' })
    } else {
      updateStep('llm', { status: 'loading' })
      try {
        await api.post('/setup/download-model', { model_name: 'llama-3.2-3b-instruct.Q4_K_M.gguf' })
        await pollDownload('llm', 'llama-3.2-3b-instruct.Q4_K_M.gguf')
        updateStep('llm', { status: 'done' })
      } catch (e: any) {
        updateStep('llm', { status: 'error', error: e.message })
      }
    }

    // 3. BlackHole
    if (setupStatus?.blackhole?.available) {
      updateStep('blackhole', { status: 'done' })
    } else {
      updateStep('blackhole', { status: 'loading' })
      try {
        const result = await api.post('/setup/install-blackhole', {})
        if (result.status === 'installed') {
          updateStep('blackhole', { status: 'done' })
        } else {
          updateStep('blackhole', { status: 'error', error: result.error || 'Install failed' })
        }
      } catch (e: any) {
        updateStep('blackhole', { status: 'error', error: e.message })
      }
    }

    // 4. Microphone
    if ((window as any).aurelius?.permissions) {
      updateStep('microphone', { status: 'loading' })
      const status = await (window as any).aurelius.permissions.microphone()
      updateStep('microphone', { status: status === 'granted' ? 'done' : 'error' })
    } else {
      updateStep('microphone', { status: 'done' })
    }

    setAllDone(true)
    await checkSetup()
  }

  const pollDownload = async (stepId: string, modelName: string) => {
    return new Promise<void>((resolve, reject) => {
      const interval = setInterval(async () => {
        try {
          const prog = await api.get(`/setup/download-progress/${encodeURIComponent(modelName)}`)
          if (prog.status === 'downloading') {
            updateStep(stepId, { progress: prog.percent })
          } else if (prog.status === 'complete') {
            clearInterval(interval)
            resolve()
          } else if (prog.status === 'error') {
            clearInterval(interval)
            reject(new Error(prog.error))
          }
        } catch (e) {
          clearInterval(interval)
          reject(e)
        }
      }, 1000)
    })
  }

  const doneCount = steps.filter(s => s.status === 'done').length

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100vh', background: 'var(--bg-base)',
      padding: '40px',
    }}>
      <div style={{
        width: '100%', maxWidth: 480,
        animation: 'fade-in 0.4s ease',
      }}>
        {/* Header */}
        <div style={{ marginBottom: 40 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
          }}>
            <span style={{ fontSize: 24, color: 'var(--accent)' }}>◈</span>
            <h1 style={{ fontSize: 26 }}>Aurelius</h1>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.7 }}>
            Setting up your local AI notetaker. Everything runs on your Mac — no cloud, no API keys, no data leaving your device.
          </p>
          {started && !allDone && (
            <div style={{ marginTop: 12 }}>
              <div style={{
                height: 2, background: 'var(--bg-overlay)', borderRadius: 1, overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%', width: `${(doneCount / steps.length) * 100}%`,
                  background: 'var(--accent)',
                  transition: 'width 0.5s ease',
                  borderRadius: 1,
                }} />
              </div>
              <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                {doneCount} / {steps.length} complete
              </div>
            </div>
          )}
        </div>

        {/* Steps */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 32 }}>
          {steps.map((step) => (
            <SetupStep key={step.id} step={step} />
          ))}
        </div>

        {/* CTA */}
        {allDone ? (
          <div style={{
            padding: '16px 20px',
            background: 'var(--success-dim)',
            border: '1px solid var(--success)',
            borderRadius: 'var(--radius-md)',
            display: 'flex', alignItems: 'center', gap: 10,
            color: 'var(--success)',
          }}>
            <CheckCircle size={16} />
            <span style={{ fontSize: 13, fontWeight: 500 }}>Aurelius is ready. Opening...</span>
          </div>
        ) : !started ? (
          <button
            onClick={runSetup}
            style={{
              width: '100%', padding: '12px 20px',
              background: 'var(--accent)', color: 'var(--text-inverse)',
              border: 'none', borderRadius: 'var(--radius-md)',
              font: '600 14px var(--font-sans)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            <Download size={15} />
            Set up Aurelius
          </button>
        ) : null}

        <p style={{ marginTop: 16, fontSize: 11, color: 'var(--text-tertiary)', textAlign: 'center' }}>
          One-time setup. Models are saved locally and reused across sessions.
        </p>
      </div>
    </div>
  )
}

function SetupStep({ step }: { step: Step }) {
  const icons = {
    idle: <Circle size={16} style={{ color: 'var(--text-tertiary)' }} />,
    loading: <Loader size={16} style={{ color: 'var(--accent)', animation: 'spin 1s linear infinite' }} />,
    done: <CheckCircle size={16} style={{ color: 'var(--success)' }} />,
    error: <AlertCircle size={16} style={{ color: 'var(--recording-red)' }} />,
  }

  const bgColors = {
    idle: 'var(--bg-elevated)',
    loading: 'var(--accent-dim)',
    done: 'var(--success-dim)',
    error: 'var(--recording-red-dim)',
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
      background: bgColors[step.status], borderRadius: 'var(--radius-md)',
      border: `1px solid ${step.status === 'done' ? 'var(--success)' : step.status === 'error' ? 'var(--recording-red)' : 'var(--border-subtle)'}`,
      transition: 'all 0.2s',
    }}>
      {icons[step.status]}
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{step.label}</div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 1 }}>
          {step.status === 'loading' && step.progress !== undefined
            ? `Downloading... ${step.progress}%`
            : step.error || step.description
          }
        </div>
        {step.status === 'loading' && step.progress !== undefined && (
          <div style={{ height: 2, background: 'var(--bg-overlay)', borderRadius: 1, marginTop: 6, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${step.progress}%`, background: 'var(--accent)', transition: 'width 0.3s', borderRadius: 1 }} />
          </div>
        )}
      </div>
    </div>
  )
}
