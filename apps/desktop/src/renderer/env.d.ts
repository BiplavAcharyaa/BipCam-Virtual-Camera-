interface Window {
  bipcam: {
    getAppInfo: () => Promise<{ pairingCode: string; lanAddress: string; httpPort: number; httpsPort: number }>
    regeneratePairingCode: () => Promise<string>
    disconnectPhone: () => Promise<boolean>
    getVirtualCameraStatus: () => Promise<'Not Running' | 'Running' | 'Unavailable'>
    startVirtualCamera: () => Promise<{ ok: boolean; status: 'Not Running' | 'Running' | 'Unavailable'; error?: string }>
    stopVirtualCamera: () => Promise<{ ok: boolean; status: 'Not Running' | 'Running' | 'Unavailable'; error?: string }>
    removeVirtualCamera: () => Promise<{ ok: boolean; status: 'Not Running' | 'Running' | 'Unavailable'; error?: string }>
    publishVideoFrame: (frame: { width: number; height: number; stride: number; fps: number; timestamp: number; data: ArrayBuffer }) => Promise<boolean>
    sendSignal: (message: unknown) => void
    onSignal: (callback: (message: any) => void) => () => void
  }
}

declare class MediaStreamTrackProcessor<T extends MediaStreamTrack = MediaStreamTrack> {
  constructor(init: { track: T; maxBufferSize?: number })
  readable: ReadableStream<any>
}

declare interface VideoFrame {
  displayWidth: number
  displayHeight: number
  codedWidth: number
  codedHeight: number
  timestamp: number
  copyTo(destination: ArrayBuffer, options?: any): Promise<void>
  close(): void
}
