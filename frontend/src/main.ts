import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, systemPreferences, Notification, screen } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import { spawn, ChildProcess } from 'child_process'
import Store from 'electron-store'

const store = new Store()
let mainWindow: BrowserWindow | null = null
let barWindow: BrowserWindow | null = null
let tray: Tray | null = null
let backendProcess: ChildProcess | null = null
const isDev = process.env.NODE_ENV === 'development'

const BAR_WIDTH = 460
const BAR_HEIGHT = 60

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

  const startedAt = Date.now()

  backendProcess.stdout?.on('data', (data) => {
    console.log('[Backend]', data.toString().trim())
  })

  backendProcess.stderr?.on('data', (data) => {
    console.error('[Backend ERR]', data.toString().trim())
  })

  backendProcess.on('exit', (code) => {
    backendProcess = null
    if (code && Date.now() - startedAt < 5000) {
      // Almost always a leftover backend still holding port 8765.
      console.error(
        `[Backend] exited with code ${code} right after launch — port 8765 is ` +
        `likely already in use by an old backend. Run: lsof -ti tcp:8765 | xargs kill`
      )
    } else {
      console.log('[Backend] exited with code:', code)
    }
  })
}

function stopBackend() {
  if (backendProcess) {
    backendProcess.kill('SIGTERM')
    // Force-kill if it doesn't exit promptly, so it can't orphan on 8765.
    const proc = backendProcess
    setTimeout(() => { try { proc.kill('SIGKILL') } catch { /* already gone */ } }, 2000)
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

// ─── Floating meeting bar ──────────────────────────────────────────────────────
// A small always-on-top overlay (like Granola/Fireflies) that appears at the top
// of the screen when a meeting is detected, with a "Start taking notes" button —
// so the user never has to open the main app. Created hidden; the renderer in it
// listens on the events socket and calls bar:show / bar:hide.

function positionBar() {
  if (!barWindow) return
  // Show on whichever display the cursor is on (the one the user is using).
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const { workArea } = display
  barWindow.setBounds({
    x: Math.round(workArea.x + (workArea.width - BAR_WIDTH) / 2),
    y: workArea.y + 12,
    width: BAR_WIDTH,
    height: BAR_HEIGHT,
  })
}

function createBarWindow() {
  barWindow = new BrowserWindow({
    width: BAR_WIDTH,
    height: BAR_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    // 'panel' (NSPanel) is what lets the window float ABOVE other apps'
    // full-screen Spaces — a plain always-on-top window can't do that.
    type: 'panel',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Float above everything, on every Space, including full-screen apps.
  barWindow.setAlwaysOnTop(true, 'screen-saver')
  barWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true,
  })

  if (isDev) {
    barWindow.loadURL('http://localhost:5173/?view=bar')
  } else {
    barWindow.loadFile(path.join(__dirname, '../renderer/index.html'), { query: { view: 'bar' } })
  }

  positionBar()
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

  // Floating meeting bar controls
  ipcMain.handle('bar:show', () => {
    if (!barWindow) return
    positionBar()
    barWindow.showInactive()  // appear without stealing focus from the call
  })
  ipcMain.handle('bar:hide', () => barWindow?.hide())
  ipcMain.handle('bar:resize', (_, height: number) => {
    if (!barWindow) return
    const h = Math.max(48, Math.round(height))
    const b = barWindow.getBounds()
    barWindow.setBounds({ ...b, height: h })
  })
  ipcMain.handle('bar:open-main', () => { mainWindow?.show(); mainWindow?.focus() })

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
    createBarWindow()
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

// Ctrl+C in the dev terminal SIGINTs Electron without running before-quit,
// which would orphan the Python backend on port 8765. Kill it explicitly.
const shutdown = () => { stopBackend(); app.exit(0) }
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
process.on('exit', () => { backendProcess?.kill('SIGKILL') })
