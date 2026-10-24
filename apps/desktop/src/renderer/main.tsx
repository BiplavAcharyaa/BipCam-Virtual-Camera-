import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import QRCode from 'qrcode'
import './style.css'

type Status = 'Disconnected' | 'Connecting' | 'Connected'
type Orientation = 'landscape' | 'portrait'
type BackgroundMode = 'off' | 'blur'
type MirrorMode = 'auto' | 'on' | 'off'

let fallbackCanvas: OffscreenCanvas | null = null

function App() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const peerRef = useRef<RTCPeerConnection | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const meterFrameRef = useRef<number>(0)
  const lastStatsRef = useRef({ time: 0, frames: 0 })
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([])
  const remoteDescriptionReadyRef = useRef(false)
  const [status, setStatus] = useState<Status>('Disconnected')
  const [pairingCode, setPairingCode] = useState('------')
  const [lanAddress, setLanAddress] = useState('')
  const [httpsPort, setHttpsPort] = useState(38648)
  const [qr, setQr] = useState('')
  const [resolution, setResolution] = useState(localStorage.getItem('bipcam.resolution') || '1920x1080')
  const [fps, setFps] = useState(localStorage.getItem('bipcam.fps') || '60')
  const [orientation, setOrientation] = useState<Orientation>((localStorage.getItem('bipcam.orientation') as Orientation) || 'landscape')
  const [background, setBackground] = useState<BackgroundMode>((localStorage.getItem('bipcam.background') as BackgroundMode) || 'off')
  const [mirror, setMirror] = useState<MirrorMode>((localStorage.getItem('bipcam.mirror') as MirrorMode) || 'auto')
  const [previewPortrait, setPreviewPortrait] = useState(false)
  const sessionRef = useRef('')
  const micMutedRef = useRef(false)
  const autoVirtualRef = useRef(localStorage.getItem('bipcam.virtualAuto') === 'true')
  const virtualStatusRef = useRef<'Not Running' | 'Running' | 'Unavailable'>('Not Running')
  const fpsRef = useRef(localStorage.getItem('bipcam.fps') || '60')
  const [virtualStatus, setVirtualStatus] = useState<'Not Running' | 'Running' | 'Unavailable'>('Not Running')
  const [virtualError, setVirtualError] = useState('')
  const virtualAbortRef = useRef<AbortController | null>(null)
  const virtualPublishBusyRef = useRef(false)
  const [error, setError] = useState('')
  const [phoneCamera, setPhoneCamera] = useState('Unknown')
  const [actualResolution, setActualResolution] = useState('—')
  const [actualFps, setActualFps] = useState('—')
  const [microphone, setMicrophone] = useState<'Connected' | 'Muted' | 'Unavailable'>('Unavailable')
  const [micLevel, setMicLevel] = useState(0)
  const [micMuted, setMicMuted] = useState(localStorage.getItem('bipcam.microphone') === 'false')
  const [autoVirtualCamera, setAutoVirtualCamera] = useState(localStorage.getItem('bipcam.virtualAuto') === 'true')
  const [processing, setProcessing] = useState('Direct video')

  virtualStatusRef.current = virtualStatus
  micMutedRef.current = micMuted
  fpsRef.current = fps

  const mobileUrl = useMemo(() => `https://${lanAddress}:${httpsPort}/?code=${pairingCode}`, [lanAddress, httpsPort, pairingCode])

  async function refreshQr(code = pairingCode) {
    if (!lanAddress || !code || code === '------') return
    const url = `https://${lanAddress}:${httpsPort}/?code=${code}`
    setQr(await QRCode.toDataURL(url, { width: 190, margin: 1 }))
  }

  function sendControl(type: string, value?: unknown) {
    window.bipcam.sendSignal({ type, value })
  }

  function stopMeter() {
    if (meterFrameRef.current) cancelAnimationFrame(meterFrameRef.current)
    meterFrameRef.current = 0
    setMicLevel(0)
  }

  function startMeter(stream: MediaStream) {
    stopMeter()
    const track = stream.getAudioTracks()[0]
    if (!track || micMutedRef.current) return
    const context = audioContextRef.current || new AudioContext()
    audioContextRef.current = context
    const source = context.createMediaStreamSource(new MediaStream([track]))
    const analyser = context.createAnalyser()
    analyser.fftSize = 512
    analyser.smoothingTimeConstant = 0.7
    source.connect(analyser)
    analyserRef.current = analyser
    const data = new Uint8Array(analyser.fftSize)
    const loop = () => {
      if (!analyserRef.current) return
      analyserRef.current.getByteTimeDomainData(data)
      let sum = 0
      for (const value of data) {
        const sample = (value - 128) / 128
        sum += sample * sample
      }
      const rms = Math.sqrt(sum / data.length)
      setMicLevel(Math.min(100, Math.round(rms * 220)))
      meterFrameRef.current = requestAnimationFrame(loop)
    }
    context.resume().catch(() => undefined)
    loop()
  }

  function attachRemoteAudio(stream: MediaStream) {
    const audioTrack = stream.getAudioTracks()[0]
    if (!audioTrack) {
      setMicrophone('Unavailable')
      stopMeter()
      return
    }
    setMicrophone(micMutedRef.current ? 'Muted' : 'Connected')
    if (!micMutedRef.current) startMeter(stream)
  }

  async function readStats(pc: RTCPeerConnection) {
    const report = await pc.getStats()
    report.forEach(stat => {
      if (stat.type === 'inbound-rtp' && stat.kind === 'video') {
        const now = performance.now()
        const frames = Number(stat.framesDecoded ?? stat.framesReceived ?? 0)
        if (lastStatsRef.current.time && now - lastStatsRef.current.time >= 700 && frames >= lastStatsRef.current.frames) {
          const seconds = (now - lastStatsRef.current.time) / 1000
          const rate = (frames - lastStatsRef.current.frames) / seconds
          if (Number.isFinite(rate) && rate > 0) setActualFps(`${rate.toFixed(1)} FPS`)
        }
        lastStatsRef.current = { time: now, frames }
      }
    })
    if (peerRef.current === pc) window.setTimeout(() => readStats(pc).catch(() => undefined), 800)
  }

  async function createPeer() {
    peerRef.current?.close()
    remoteDescriptionReadyRef.current = false
    pendingIceRef.current = []
    lastStatsRef.current = { time: 0, frames: 0 }
    const pc = new RTCPeerConnection({ iceServers: [] })
    peerRef.current = pc
    pc.ontrack = event => {
      const stream = event.streams[0] || new MediaStream([event.track])
      try {
        const receiver = event.receiver as any
        if ('jitterBufferTarget' in receiver) receiver.jitterBufferTarget = 0
        if ('playoutDelayHint' in receiver) receiver.playoutDelayHint = 0
      } catch {
      }
      if (event.track.kind === 'video' && videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.play().catch(() => undefined)
        // A new peer means a new remote track: (re)attach the virtual-camera publisher to it.
        if (virtualStatusRef.current === 'Running') {
          startVideoFramePublisher().catch(() => undefined)
        } else if (autoVirtualRef.current) {
          window.setTimeout(() => startVirtualCamera().catch(() => undefined), 0)
        }
      }
      if (event.track.kind === 'audio') attachRemoteAudio(stream)
    }
    pc.onicecandidate = event => {
      if (event.candidate) window.bipcam.sendSignal({ type: 'ice', candidate: event.candidate })
    }
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') setStatus('Connected')
      // "disconnected" is frequently transient on Wi-Fi and recovers by itself; only give up on failed/closed.
      if (pc.connectionState === 'disconnected') setStatus('Connecting')
      if (['failed', 'closed'].includes(pc.connectionState)) {
        setStatus('Disconnected')
        stopMeter()
      }
    }
    readStats(pc).catch(() => undefined)
    return pc
  }

  useEffect(() => {
    let cleanup: () => void = () => undefined
    const bipcam = window.bipcam
    if (!bipcam) {
      setError('BipCam desktop bridge failed to initialise. Restart the application.')
      return cleanup
    }
    bipcam.getVirtualCameraStatus().then(setVirtualStatus).catch(() => undefined)
    bipcam.getAppInfo().then(async info => {
      setPairingCode(info.pairingCode)
      setLanAddress(info.lanAddress)
      setHttpsPort(info.httpsPort)
      const url = `https://${info.lanAddress}:${info.httpsPort}/?code=${info.pairingCode}`
      setQr(await QRCode.toDataURL(url, { width: 190, margin: 1 }))
    }).catch(initError => {
      console.error('[BIPCAM] Failed to initialise desktop bridge:', initError)
      setError('Unable to initialise BipCam. Restart the application.')
    })
    cleanup = bipcam.onSignal(async message => {
      if (message.type === 'phone-status') {
        setStatus(message.status === 'connected' ? 'Connected' : 'Disconnected')
        if (message.status !== 'connected') stopMeter()
        if (message.status === 'connected') setError('')
        return
      }
      if (message.type === 'pairing-code') {
        setPairingCode(message.code)
        refreshQr(message.code)
        return
      }
      if (message.type === 'phone-info') {
        setPhoneCamera(message.name || (message.facingMode === 'environment' ? 'Back camera' : 'Front camera'))
        return
      }
      if (message.type === 'phone-media-info') {
        const value = message.value || {}
        if (value.width && value.height) setActualResolution(`${value.width}×${value.height}`)
        if (value.frameRate) setActualFps(`${Number(value.frameRate).toFixed(1)} FPS requested`)
        setMicrophone(value.microphone ? (value.microphoneMuted ? 'Muted' : 'Connected') : 'Unavailable')
        setProcessing(value.processing || (value.background === 'blur' ? 'Background segmentation' : 'Direct video'))
        return
      }
      if (message.type === 'offer') {
        setStatus('Connecting')
        // The phone re-sends an offer whenever it renegotiates (e.g. blur / orientation changes).
        // Only build a NEW peer connection when the phone started a new session; otherwise answer on the
        // existing one. Replacing the peer on every offer is what used to kill the stream after ~1 second.
        const session = String(message.session ?? 'default')
        let pc = peerRef.current
        if (!pc || sessionRef.current !== session || pc.signalingState === 'closed' || pc.connectionState === 'failed') {
          pc = await createPeer()
          sessionRef.current = session
        }
        await pc.setRemoteDescription(message.offer)
        remoteDescriptionReadyRef.current = true
        for (const candidate of pendingIceRef.current.splice(0)) await pc.addIceCandidate(candidate).catch(() => undefined)
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        window.bipcam.sendSignal({ type: 'answer', answer })
        return
      }
      if (message.type === 'ice') {
        const pc = peerRef.current
        if (pc && message.candidate) {
          if (remoteDescriptionReadyRef.current) await pc.addIceCandidate(message.candidate).catch(() => undefined)
          else pendingIceRef.current.push(message.candidate)
        }
        return
      }
      if (message.type === 'virtual-camera-status') {
        setVirtualStatus(message.status)
        if (message.error) setVirtualError(message.error)
        return
      }
      if (message.type === 'error') setError(message.message || 'Connection error')
    })
    return () => {
      cleanup()
      peerRef.current?.close()
      peerRef.current = null
      stopMeter()
      stopVideoFramePublisher()
      audioContextRef.current?.close().catch(() => undefined)
    }
  }, [])

  function updateSetting(key: string, value: string) {
    localStorage.setItem(`bipcam.${key}`, value)
  }

  function currentVideoTrack() {
    const stream = videoRef.current?.srcObject
    return stream instanceof MediaStream ? stream.getVideoTracks()[0] ?? null : null
  }

  async function frameToBgra(frame: VideoFrame, srcWidth: number, srcHeight: number, width: number, height: number): Promise<ArrayBuffer> {
    if (srcWidth === width && srcHeight === height) {
      try {
        const buffer = new ArrayBuffer(width * height * 4)
        await frame.copyTo(buffer, { format: 'BGRA', layout: [{ offset: 0, stride: width * 4 }] })
        return buffer
      } catch {
      }
    }
    if (!fallbackCanvas || fallbackCanvas.width !== width || fallbackCanvas.height !== height) fallbackCanvas = new OffscreenCanvas(width, height)
    const context = fallbackCanvas.getContext('2d', { willReadFrequently: true })!
    context.drawImage(frame as unknown as CanvasImageSource, 0, 0, width, height)
    const image = context.getImageData(0, 0, width, height)
    const pixels = new Uint32Array(image.data.buffer)
    for (let i = 0; i < pixels.length; i++) {
      const p = pixels[i]
      pixels[i] = 0xFF000000 | ((p & 0xFF) << 16) | (p & 0xFF00) | ((p >>> 16) & 0xFF)
    }
    return image.data.buffer as ArrayBuffer
  }

  async function startVideoFramePublisher() {
    stopVideoFramePublisher()
    const track = currentVideoTrack()
    if (!track) {
      setVirtualError('Virtual camera is running. Start the phone camera - video will appear in Teams/Zoom/Meet as soon as the first frame arrives.')
      return
    }
    if (!('MediaStreamTrackProcessor' in window)) {
      setVirtualError('This Electron runtime does not expose the video-frame processing API required by the virtual camera.')
      return
    }
    setVirtualError('')
    const processor = new MediaStreamTrackProcessor({ track, maxBufferSize: 1 })
    const reader = processor.readable.getReader()
    const abort = new AbortController()
    virtualAbortRef.current = abort
    virtualPublishBusyRef.current = true
    abort.signal.addEventListener('abort', () => { reader.cancel().catch(() => undefined) })
    let lastSent = 0
    try {
      while (!abort.signal.aborted) {
        const result = await reader.read()
        if (result.done || !result.value) break
        const frame = result.value as VideoFrame
        try {
          // Publish at the configured rate (up to 60). Only frames arriving faster than that are dropped, with some
          // slack so ordinary timing jitter never costs a frame; the reader keeps just the newest frame (maxBufferSize 1).
          const targetFps = Math.min(Math.max(Number(fpsRef.current) || 30, 15), 60)
          const now = performance.now()
          if (now - lastSent < (1000 / targetFps) * 0.8) continue
          lastSent = now
          const srcWidth = frame.displayWidth || frame.codedWidth
          const srcHeight = frame.displayHeight || frame.codedHeight
          // Full 1080p is passed through untouched (no down-scale, then up-scale, which is what made 1080p look soft).
          const longSide = Math.max(srcWidth, srcHeight)
          const scale = longSide > 1920 ? 1920 / longSide : 1
          const width = Math.round(srcWidth * scale) & ~1
          const height = Math.round(srcHeight * scale) & ~1
          if (width < 2 || height < 2) continue
          const data = await frameToBgra(frame, srcWidth, srcHeight, width, height)
          await window.bipcam.publishVideoFrame({ width, height, stride: width * 4, fps: targetFps, timestamp: frame.timestamp || performance.now() * 1000, data })
        } finally {
          frame.close()
        }
      }
    } catch (error) {
      if (!abort.signal.aborted) {
        console.error('[BIPCAM] virtual camera frame publisher failed:', error)
        setVirtualError('Virtual camera frame publishing stopped unexpectedly.')
      }
    } finally {
      try { reader.releaseLock() } catch { /* already released */ }
      if (virtualAbortRef.current === abort) {
        virtualAbortRef.current = null
        virtualPublishBusyRef.current = false
      }
    }
  }

  function stopVideoFramePublisher() {
    virtualAbortRef.current?.abort()
    virtualAbortRef.current = null
    virtualPublishBusyRef.current = false
  }

  async function startVirtualCamera() {
    setVirtualError('')
    const result = await window.bipcam.startVirtualCamera()
    setVirtualStatus(result.status)
    if (!result.ok) {
      setVirtualError(result.error || 'Unable to start the Windows virtual camera.')
      return
    }
    await startVideoFramePublisher()
  }

  async function stopVirtualCamera() {
    stopVideoFramePublisher()
    const result = await window.bipcam.stopVirtualCamera()
    setVirtualStatus(result.status)
    if (!result.ok) setVirtualError(result.error || 'Unable to stop the Windows virtual camera.')
  }

  async function regenerate() {
    const code = await window.bipcam.regeneratePairingCode()
    setPairingCode(code)
    await refreshQr(code)
    setStatus('Disconnected')
  }

  async function disconnect() {
    peerRef.current?.close()
    peerRef.current = null
    pendingIceRef.current = []
    remoteDescriptionReadyRef.current = false
    stopVideoFramePublisher()
    sessionRef.current = ''
    if (videoRef.current) videoRef.current.srcObject = null
    stopMeter()
    await window.bipcam.disconnectPhone()
    setStatus('Disconnected')
    setPhoneCamera('Unknown')
    setActualResolution('—')
    setActualFps('—')
    setMicrophone('Unavailable')
  }

  function changeMicrophoneMute(value: boolean) {
    setMicMuted(value)
    localStorage.setItem('bipcam.microphone', String(!value))
    sendControl('microphone-mute', { muted: value })
    if (value) stopMeter()
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div><div className="brand">BipCam</div><div className="subtitle">Wireless Android webcam for Windows</div></div>
        <div className={`status-pill ${status.toLowerCase()}`}><span />{status}</div>
      </header>
      <main className="content">
        <section className="hero-grid">
          <div className="preview-card">
            <div className="card-head"><div><span className="eyebrow">LIVE PREVIEW</span><h2>Phone Camera</h2></div><span className="mini-status">{phoneCamera}</span></div>
            <div className={`video-wrap${previewPortrait ? ' portrait' : ''}`}><video ref={videoRef} autoPlay playsInline muted onResize={e => setPreviewPortrait(e.currentTarget.videoHeight > e.currentTarget.videoWidth)} />{status !== 'Connected' && <div className="empty-state"><div className="camera-icon">◉</div><strong>Waiting for phone video</strong><span>Pair your Android phone and start the camera.</span></div>}</div>
            <div className="preview-footer"><span>WebRTC video</span><span>{actualResolution} · {actualFps}</span></div>
          </div>
          <aside className="pair-card">
            <div className="card-head"><div><span className="eyebrow">PAIRING</span><h2>Connect phone</h2></div></div>
            <div className="code-box"><span>Pairing code</span><strong>{pairingCode}</strong></div>
            <div className="qr-box">{qr && <img src={qr} alt="BipCam pairing QR code" />}</div>
            <div className="url-box"><span>Phone URL</span><code>{mobileUrl}</code></div>
            <div className="pair-actions"><button className="secondary" onClick={regenerate}>New code</button><button className="secondary" onClick={() => navigator.clipboard?.writeText(mobileUrl)}>Copy URL</button></div>
            <p className="hint">Phone and laptop must be on the same Wi-Fi. The first HTTPS visit may show a local certificate warning.</p>
          </aside>
        </section>
        <section className="controls-grid">
          <div className="card">
            <div className="eyebrow">CAMERA</div><h2>Stream settings</h2>
            <div className="form-grid">
              <label>Orientation<div className="segmented"><button className={orientation === 'landscape' ? 'active' : ''} onClick={() => { setOrientation('landscape'); updateSetting('orientation','landscape'); sendControl('settings',{orientation:'landscape',resolution,fps,background,mirror}) }}>Landscape</button><button className={orientation === 'portrait' ? 'active' : ''} onClick={() => { setOrientation('portrait'); updateSetting('orientation','portrait'); sendControl('settings',{orientation:'portrait',resolution,fps,background,mirror}) }}>Portrait</button></div></label>
              <label>Resolution<select value={resolution} onChange={e => { setResolution(e.target.value); updateSetting('resolution',e.target.value); sendControl('settings',{resolution:e.target.value,fps,orientation,background,mirror}) }}><option value="1280x720">720p</option><option value="1920x1080">1080p</option></select></label>
              <label>Frame Rate<select value={fps} onChange={e => { setFps(e.target.value); updateSetting('fps',e.target.value); sendControl('settings',{resolution,fps:e.target.value,orientation,background,mirror}) }}><option value="30">30 FPS</option><option value="60">60 FPS</option></select></label>
              <label>Background<select value={background} onChange={e => { setBackground(e.target.value as BackgroundMode); updateSetting('background',e.target.value); sendControl('settings',{resolution,fps,orientation,background:e.target.value,mirror}) }}><option value="off">Off</option><option value="blur">Blur</option></select></label>
              <label>Mirror (selfie)<select value={mirror} onChange={e => { const value = e.target.value as MirrorMode; setMirror(value); updateSetting('mirror',value); sendControl('settings',{resolution,fps,orientation,background,mirror:value}) }}><option value="auto">Auto (front camera)</option><option value="on">Always mirror</option><option value="off">No mirror</option></select></label>
            </div>
            <div className="actual-grid"><div><span>Actual resolution</span><strong>{actualResolution}</strong></div><div><span>Actual FPS</span><strong>{actualFps}</strong></div></div>
            <div className="button-row"><button className="primary" onClick={() => sendControl('camera-start',{resolution,fps,orientation,background,mirror})}>Start Camera</button><button className="secondary" onClick={() => sendControl('camera-stop')}>Stop Camera</button></div>
          </div>
          <div className="card">
            <div className="eyebrow">MICROPHONE</div><h2>Phone audio</h2>
            <div className="connection-line"><span className={`dot ${microphone === 'Connected' ? 'connected' : microphone === 'Muted' ? 'connected' : 'disconnected'}`} /><strong>{microphone}</strong><span className="muted">WebRTC audio</span></div>
            <div className="audio-meter"><div className="audio-meter-fill" style={{ width: `${micLevel}%` }} /></div><div className="meter-label"><span>Live input</span><strong>{micLevel}%</strong></div>
            <div className="button-row"><button className={micMuted ? 'primary' : 'secondary'} onClick={() => changeMicrophoneMute(!micMuted)}>{micMuted ? 'Unmute Microphone' : 'Mute Microphone'}</button><button className="secondary" onClick={() => sendControl('camera-switch')}>Switch Camera</button></div>
            {error && <div className="error-box">{error}</div>}
          </div>
          <div className="card virtual-card">
            <div className="eyebrow">WINDOWS OUTPUT</div><h2>Virtual Camera</h2><div className="virtual-status"><span className={`dot ${virtualStatus === 'Running' ? 'connected' : virtualStatus === 'Unavailable' ? 'disconnected' : ''}`} /><strong>{virtualStatus}</strong></div>
            <div className="connection-line"><strong>BipCam Camera</strong><span className="muted">Windows webcam</span></div>
            <p>Exposes the processed phone video as the system camera named BipCam Camera for compatible Windows camera applications.</p>
            <div className="button-row"><button className="primary" onClick={startVirtualCamera} disabled={virtualStatus === 'Running'}>Start Virtual Camera</button><button className="secondary" onClick={stopVirtualCamera} disabled={virtualStatus !== 'Running'}>Stop Virtual Camera</button></div>
            <label className="auto-toggle"><span>Start Virtual Camera Automatically</span><input type="checkbox" checked={autoVirtualCamera} onChange={event => { setAutoVirtualCamera(event.target.checked); autoVirtualRef.current = event.target.checked; localStorage.setItem('bipcam.virtualAuto', String(event.target.checked)) }} /></label>
            {virtualError && <div className="error-box">{virtualError}</div>}
            <div className="connection-line"><span className="dot connected" /><strong>{processing}</strong><span className="muted">Phone processing</span></div>
          </div>
        </section>
      </main>
      <footer>Local-only · No video upload · WebRTC media · BipCam 0.1.0</footer>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
