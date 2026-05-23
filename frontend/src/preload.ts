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
