import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('bipcam', {
  getAppInfo: () => ipcRenderer.invoke('app-info'),
  regeneratePairingCode: () => ipcRenderer.invoke('new-pairing-code'),
  disconnectPhone: () => ipcRenderer.invoke('disconnect-phone'),
  getVirtualCameraStatus: () => ipcRenderer.invoke('virtual-camera-status'),
  startVirtualCamera: () => ipcRenderer.invoke('virtual-camera-start'),
  stopVirtualCamera: () => ipcRenderer.invoke('virtual-camera-stop'),
  removeVirtualCamera: () => ipcRenderer.invoke('virtual-camera-remove'),
  publishVideoFrame: (frame: { width: number; height: number; stride: number; fps: number; timestamp: number; data: ArrayBuffer }) => ipcRenderer.invoke('video-frame', frame),
  sendSignal: (message: unknown) => ipcRenderer.send('signal-to-phone', message),
  onSignal: (callback: (message: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, message: unknown) => callback(message)
    ipcRenderer.on('signal', listener)
    return () => ipcRenderer.removeListener('signal', listener)
  }
})
