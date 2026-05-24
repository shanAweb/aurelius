import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, systemPreferences, Notification } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import { spawn, ChildProcess } from 'child_process'
import Store from 'electron-store'

const store = new Store()
let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let backendProcess: ChildProcess | null = null
const isDev = process.env.NODE_ENV === 'development'

// ─── Backend Lifecycle ────────────────────────────────────────────────────────

function getBackendPath(): string {
  if (isDev) {
    return path.join(__dirname, '../../backend/main.py')
  }
  return path.join(process.resourcesPath, 'backend', 'aurelius-backend')
}

function startBackend() {
  const backendPath = getBackendPath()
  console.log('[Main] Starting backend at:', backendPath)

  if (isDev) {
    // Run from inside backend/ (package-relative imports) using the venv
    // Python so the installed deps are available. Falls back to python3.
    const backendDir = path.dirname(backendPath)
    const venvPython = path.join(backendDir, 'aurenv', 'bin', 'python')
    const pythonBin = fs.existsSync(venvPython) ? venvPython : 'python3'
    backendProcess = spawn(pythonBin, ['main.py'], {
      cwd: backendDir,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  } else {
    backendProcess = spawn(backendPath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  }

  backendProcess.stdout?.on('data', (data) => {
    console.log('[Backend]', data.toString().trim())
  })

  backendProcess.stderr?.on('data', (data) => {
    console.error('[Backend ERR]', data.toString().trim())
  })

  backendProcess.on('exit', (code) => {
    console.log('[Backend] exited with code:', code)
    backendProcess = null
  })
}

function stopBackend() {
  if (backendProcess) {
    backendProcess.kill('SIGTERM')
    backendProcess = null
  }
}

// ─── Window ───────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    vibrancy: 'under-window',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, '../resources/icon.png'),
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('close', (e) => {
    // Hide to tray instead of closing
    e.preventDefault()
    mainWindow?.hide()
  })
}

// ─── System Tray ─────────────────────────────────────────────────────────────

function createTray() {
  const iconPath = path.join(__dirname, '../resources/tray-icon.png')
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
  tray = new Tray(icon)

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open Aurelius', click: () => { mainWindow?.show(); mainWindow?.focus() } },
    { type: 'separator' },
    { label: 'Start Recording Now', click: () => { mainWindow?.webContents.send('tray:start-recording') } },
    { label: 'Stop Recording', click: () => { mainWindow?.webContents.send('tray:stop-recording') } },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.exit(0) } },
  ])

  tray.setToolTip('Aurelius — AI Notetaker')
  tray.setContextMenu(contextMenu)
  tray.on('click', () => { mainWindow?.show(); mainWindow?.focus() })
}

// ─── IPC Handlers ─────────────────────────────────────────────────────────────

function registerIPC() {
  // Store (settings, tokens)
  ipcMain.handle('store:get', (_, key: string) => store.get(key))
  ipcMain.handle('store:set', (_, key: string, value: unknown) => store.set(key, value))
  ipcMain.handle('store:delete', (_, key: string) => store.delete(key))

  // Permissions
  ipcMain.handle('permissions:microphone', async () => {
    const status = systemPreferences.getMediaAccessStatus('microphone')
    if (status !== 'granted') {
      await systemPreferences.askForMediaAccess('microphone')
    }
    return systemPreferences.getMediaAccessStatus('microphone')
  })

  // Open external links
  ipcMain.handle('shell:open', (_, url: string) => shell.openExternal(url))

  // Native notification (meeting detected / auto-started while window hidden)
  ipcMain.handle('notify:show', (_, opts: { title: string; body: string }) => {
    if (!Notification.isSupported()) return
    const n = new Notification({ title: opts.title, body: opts.body, silent: false })
    n.on('click', () => { mainWindow?.show(); mainWindow?.focus() })
    n.show()
  })

  // Backend health
  ipcMain.handle('backend:health', async () => {
    try {
      const res = await fetch('http://localhost:8765/health')
      return res.ok
    } catch {
      return false
    }
  })

  // Tray icon update (recording state)
  ipcMain.on('tray:set-recording', (_, isRecording: boolean) => {
    if (!tray) return
    const label = isRecording ? '● REC' : ''
    tray.setTitle(label)
  })
}

// ─── App Events ───────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  startBackend()

  // Wait a moment for backend to start
  setTimeout(() => {
    createWindow()
    createTray()
    registerIPC()
  }, 1500)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else mainWindow?.show()
  })
})

app.on('before-quit', () => {
  mainWindow?.removeAllListeners('close')
  stopBackend()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    stopBackend()
    app.quit()
  }
})
