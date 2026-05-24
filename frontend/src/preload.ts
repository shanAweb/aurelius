import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('aurelius', {
  // Store
  store: {
    get: (key: string) => ipcRenderer.invoke('store:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('store:set', key, value),
    delete: (key: string) => ipcRenderer.invoke('store:delete', key),
  },

  // Permissions
  permissions: {
    microphone: () => ipcRenderer.invoke('permissions:microphone'),
  },

  // Shell
  shell: {
    open: (url: string) => ipcRenderer.invoke('shell:open', url),
  },

  // Native OS notifications (used when the window is hidden/in tray)
  notify: {
    show: (opts: { title: string; body: string }) => ipcRenderer.invoke('notify:show', opts),
  },

  // Floating meeting bar (always-on-top overlay, like Granola/Fireflies)
  bar: {
    show: () => ipcRenderer.invoke('bar:show'),
    hide: () => ipcRenderer.invoke('bar:hide'),
    resize: (height: number) => ipcRenderer.invoke('bar:resize', height),
    openMain: () => ipcRenderer.invoke('bar:open-main'),
  },

  // Backend
  backend: {
    health: () => ipcRenderer.invoke('backend:health'),
  },

  // Tray
  tray: {
    setRecording: (isRecording: boolean) => ipcRenderer.send('tray:set-recording', isRecording),
    onStartRecording: (cb: () => void) => ipcRenderer.on('tray:start-recording', cb),
    onStopRecording: (cb: () => void) => ipcRenderer.on('tray:stop-recording', cb),
  },
})
