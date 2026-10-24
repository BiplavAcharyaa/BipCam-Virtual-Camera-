import { app, BrowserWindow, ipcMain, session } from 'electron'
import { createServer as createHttpServer, IncomingMessage, ServerResponse } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { readFileSync, existsSync, createReadStream, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
import { createServer as createPipeServer, Socket } from 'node:net'
import { networkInterfaces } from 'node:os'
import { execFile } from 'node:child_process'
import { randomInt } from 'node:crypto'
import selfsigned from 'selfsigned'
import { WebSocketServer, WebSocket } from 'ws'

app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')

let mainWindow: BrowserWindow | null = null
let httpServer: ReturnType<typeof createHttpServer> | null = null
let httpsServer: ReturnType<typeof createHttpsServer> | null = null
let wsServer: WebSocketServer | null = null
let videoPipeServer: ReturnType<typeof createPipeServer> | null = null
const videoBridgePort = 38721
const videoPipeClients = new Set<Socket>()
let latestVideoFrame: { width: number; height: number; stride: number; fps: number; timestamp: number; data: Buffer; seq: number } | null = null
let videoSeq = 0
const lastSentSeq = new WeakMap<Socket, number>()
const SOURCE_CLSID = '{B624D1C1-4F7D-4646-AAC0-1A51CD4CEDD7}'
let virtualCameraStatus: 'Not Running' | 'Running' | 'Unavailable' = 'Not Running'
let pairingCode = ''
let pairedSocket: WebSocket | null = null
const port = 38647

const root = app.getAppPath()
const mobileRoot = join(root, 'apps/mobile-web/public')
const certRoot = join(app.getPath('userData'), 'certs')

function getLanAddress() {
  const interfaces = networkInterfaces()
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address
    }
  }
  return '127.0.0.1'
}

function makePairingCode() {
  return String(randomInt(100000, 1000000))
}

function mime(path: string) {
  const type = extname(path).toLowerCase()
  if (type === '.html') return 'text/html; charset=utf-8'
  if (type === '.js') return 'text/javascript; charset=utf-8'
  if (type === '.css') return 'text/css; charset=utf-8'
  if (type === '.svg') return 'image/svg+xml'
  if (type === '.json') return 'application/json; charset=utf-8'
  if (type === '.wasm') return 'application/wasm'
  if (type === '.png') return 'image/png'
  return 'application/octet-stream'
}

function serveMobile(req: IncomingMessage, res: ServerResponse) {
  const requested = decodeURIComponent((req.url ?? '/').split('?')[0])
  const relative = requested === '/' ? 'index.html' : requested.replace(/^\/+/, '')
  const file = join(mobileRoot, relative)
  if (!file.startsWith(mobileRoot) || !existsSync(file)) {
    res.writeHead(404)
    res.end('Not found')
    return
  }
  const cacheable = relative.startsWith('mediapipe/') || relative.startsWith('mediapipe\\')
  res.writeHead(200, { 'Content-Type': mime(file), 'Cache-Control': cacheable ? 'public, max-age=86400' : 'no-store' })
  createReadStream(file).pipe(res)
}

function sendToDesktop(message: unknown) {
  mainWindow?.webContents.send('signal', message)
}

function broadcastToPhone(message: unknown) {
  if (pairedSocket?.readyState === WebSocket.OPEN) pairedSocket.send(JSON.stringify(message))
}

function nativeDir() {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'native')]
    : [join(app.getAppPath(), 'native/windows-vcam/dist'), join(process.cwd(), 'native/windows-vcam/dist')]
  return candidates.find(dir => existsSync(join(dir, 'BipCamVirtualCameraControl.exe'))) || ''
}

function virtualCameraControlPath() {
  const dir = nativeDir()
  return dir ? join(dir, 'BipCamVirtualCameraControl.exe') : ''
}

function run(file: string, args: string[], timeout = 20000) {
  return new Promise<{ code: number; stdout: string; stderr: string }>(resolve => {
    execFile(file, args, { windowsHide: true, timeout }, (error, stdout, stderr) => {
      const code = error ? (typeof (error as NodeJS.ErrnoException).code === 'number' ? Number((error as NodeJS.ErrnoException).code) : 1) : 0
      resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? error?.message ?? '') })
    })
  })
}

async function isSourceRegistered(dll: string) {
  const result = await run('reg.exe', ['query', `HKLM\\SOFTWARE\\Classes\\CLSID\\${SOURCE_CLSID}\\InprocServer32`, '/ve', '/reg:64'])
  if (result.code !== 0) return false
  return result.stdout.toLowerCase().includes(dll.toLowerCase())
}

// Windows Frame Server (the service that hands the camera to Teams/Zoom/Meet/WhatsApp) runs as LocalService and
// can only load the media source if its COM host is registered machine-wide AND lives somewhere it can read
// (not under a user profile such as Downloads/Desktop). The installer does this; in development we stage a copy in
// ProgramData and register it, all inside ONE elevated PowerShell process (a normal user cannot write there reliably).
function stagedDirFor(dir: string) {
  return app.isPackaged ? dir : join(process.env.ProgramData || 'C:\\ProgramData', 'BipCam', 'native')
}

function sameBinary(a: string, b: string) {
  try {
    const x = statSync(a)
    const y = statSync(b)
    return x.size === y.size && Math.abs(x.mtimeMs - y.mtimeMs) < 2000
  } catch {
    return false
  }
}

function psQuote(value: string) {
  return `'${value.replace(/'/g, "''")}'`
}

async function ensureSourceRegistered() {
  const dir = nativeDir()
  if (!dir) return { ok: false, error: 'The BipCam Windows virtual-camera component is not built. Run "npm run build:vcam" on Windows.' }
  if (!existsSync(join(dir, 'BipCamVirtualCameraSource.comhost.dll'))) return { ok: false, error: 'BipCamVirtualCameraSource.comhost.dll is missing. Run "npm run build:vcam".' }
  const target = stagedDirFor(dir)
  const dll = join(target, 'BipCamVirtualCameraSource.comhost.dll')
  const upToDate = app.isPackaged || sameBinary(join(dir, 'BipCamVirtualCameraSource.dll'), join(target, 'BipCamVirtualCameraSource.dll'))
  if (existsSync(dll) && upToDate && (await isSourceRegistered(dll))) return { ok: true }

  const inner = [
    "$ErrorActionPreference = 'Stop'",
    // Log folder the camera source (running inside Frame Server as another account) is allowed to write to.
    "$logs = Join-Path $env:ProgramData 'BipCam\\logs'",
    'New-Item -ItemType Directory -Force -Path $logs | Out-Null',
    "& icacls.exe $logs /grant '*S-1-1-0:(OI)(CI)M' | Out-Null",
    ...(app.isPackaged ? [] : [
      `$src = ${psQuote(dir)}`,
      `$dst = ${psQuote(target)}`,
      'New-Item -ItemType Directory -Force -Path $dst | Out-Null',
      // Frame Server keeps the previous source DLL loaded; stop it so the files can be replaced (it restarts on demand).
      'Stop-Service -Name FrameServer -Force -ErrorAction SilentlyContinue',
      "Copy-Item -Path (Join-Path $src '*') -Destination $dst -Recurse -Force"
    ]),
    `$dll = ${psQuote(dll)}`,
    "$p = Start-Process -FilePath (Join-Path $env:WINDIR 'System32\\regsvr32.exe') -ArgumentList '/s', ('\"' + $dll + '\"') -Wait -PassThru",
    'exit $p.ExitCode'
  ].join('\n')
  const encoded = Buffer.from(inner, 'utf16le').toString('base64')
  const outer = `$p = Start-Process -FilePath powershell.exe -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','${encoded}' -Verb RunAs -Wait -PassThru; exit $p.ExitCode`
  const result = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', outer], 180000)
  if (result.code !== 0) return { ok: false, error: 'Administrator permission is required once to install and register the BipCam camera source. Please accept the Windows prompt and press Start again.' }
  if (!(await isSourceRegistered(dll))) return { ok: false, error: 'Registering the BipCam camera source failed. Make sure the .NET 10 Runtime (x64) is installed, then try again.' }
  return { ok: true }
}

function dotnetRuntimeHint() {
  const base = 'C:\\Program Files\\dotnet\\shared\\Microsoft.NETCore.App'
  try {
    const has = existsSync(base) && readdirSync(base).some(name => name.startsWith('10.'))
    return has ? '' : ' The .NET 10 Runtime (x64) does not appear to be installed - it is required by the camera source.'
  } catch {
    return ''
  }
}

async function runVirtualCameraCommand(command: 'start' | 'stop' | 'remove') {
  if (process.platform !== 'win32') return { ok: false, status: 'Unavailable' as const, error: 'Windows virtual cameras are only available on Windows.' }
  const control = virtualCameraControlPath()
  if (!control) return { ok: false, status: 'Unavailable' as const, error: 'The BipCam Windows virtual-camera component is not installed. Run "npm run build:vcam" on Windows.' }
  if (command === 'start') {
    const registration = await ensureSourceRegistered()
    if (!registration.ok) return { ok: false, status: 'Unavailable' as const, error: registration.error }
  }
  const result = await run(control, [command])
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout).trim()
    return { ok: false, status: 'Unavailable' as const, error: `${detail || 'Virtual camera command failed.'}${dotnetRuntimeHint()}` }
  }
  return { ok: true, status: command === 'start' ? 'Running' as const : 'Not Running' as const }
}

function startVideoPipe() {
  if (videoPipeServer) return
  videoPipeServer = createPipeServer(socket => {
    videoPipeClients.add(socket)
    socket.setNoDelay(true)
    socket.on('data', () => {
      const frame = latestVideoFrame
      const header = Buffer.alloc(28)
      header.writeUInt32LE(0x4d434942, 0)
      header.writeUInt16LE(1, 4)
      header.writeUInt16LE(0, 6)
      if (!frame) {
        socket.write(header)
        return
      }
      const isNew = lastSentSeq.get(socket) !== frame.seq
      header.writeInt32LE(frame.width, 8)
      header.writeInt32LE(frame.height, 12)
      header.writeInt32LE(frame.stride, 16)
      header.writeInt32LE(frame.fps, 20)
      // payload 0 == "nothing new since your last request"; the native side keeps its cached frame.
      header.writeInt32LE(isNew ? frame.data.length : 0, 24)
      socket.cork()
      socket.write(header)
      if (isNew) {
        socket.write(frame.data)
        lastSentSeq.set(socket, frame.seq)
      }
      socket.uncork()
    })
    socket.on('close', () => videoPipeClients.delete(socket))
    socket.on('error', () => videoPipeClients.delete(socket))
  })
  videoPipeServer.on('error', error => console.warn('[BIPCAM] video pipe error:', error))
  videoPipeServer.listen(videoBridgePort, '127.0.0.1')
}

function publishVideoFrame(frame: { width: number; height: number; stride: number; fps: number; timestamp: number; data: ArrayBuffer }) {
  if (!frame?.data || frame.width <= 0 || frame.height <= 0 || frame.stride < frame.width * 4) return
  latestVideoFrame = { ...frame, data: Buffer.from(frame.data), seq: ++videoSeq }
}

function stopVideoPipe() {
  for (const client of videoPipeClients) client.destroy()
  videoPipeClients.clear()
  videoPipeServer?.close()
  videoPipeServer = null
  latestVideoFrame = null
}

function setupSignalling() {
  wsServer = new WebSocketServer({ noServer: true })
  wsServer.on('connection', (socket) => {
    let authenticated = false
    socket.on('message', raw => {
      try {
        const message = JSON.parse(raw.toString())
        if (message.type === 'pair') {
          if (message.code !== pairingCode) {
            socket.send(JSON.stringify({ type: 'pair-error', message: 'Wrong pairing code' }))
            return
          }
          if (pairedSocket && pairedSocket !== socket) pairedSocket.close()
          pairedSocket = socket
          authenticated = true
          socket.send(JSON.stringify({ type: 'paired', role: 'phone' }))
          sendToDesktop({ type: 'phone-status', status: 'connected' })
          return
        }
        if (!authenticated) return
        sendToDesktop(message)
      } catch {
        socket.send(JSON.stringify({ type: 'error', message: 'Invalid signalling message' }))
      }
    })
    socket.on('close', () => {
      if (pairedSocket === socket) {
        pairedSocket = null
        sendToDesktop({ type: 'phone-status', status: 'disconnected' })
      }
    })
  })
}

function startLanServer() {
  pairingCode = makePairingCode()
  setupSignalling()
  httpServer = createHttpServer((req, res) => serveMobile(req, res))
  httpServer.on('upgrade', (req, socket, head) => wsServer?.handleUpgrade(req, socket, head, client => wsServer?.emit('connection', client, req)))
  httpServer.listen(port, '0.0.0.0')
  const keyPath = join(certRoot, 'lan-key.pem')
  const certPath = join(certRoot, 'lan-cert.pem')
  const lan = getLanAddress()
  mkdirSync(certRoot, { recursive: true })
  try {
    const attrs = [{ name: 'commonName', value: 'BipCam LAN' }]
    const generated = selfsigned.generate(attrs, { days: 825, keySize: 2048, algorithm: 'sha256', extensions: [{ name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }, { type: 7, ip: lan }] }] })
    writeFileSync(keyPath, generated.private, { mode: 0o600 })
    writeFileSync(certPath, generated.cert)
  } catch (error) {
    console.warn('[BIPCAM] LAN certificate generation failed:', error)
  }
  if (existsSync(keyPath) && existsSync(certPath)) {
    httpsServer = createHttpsServer({ key: readFileSync(keyPath), cert: readFileSync(certPath) }, (req, res) => serveMobile(req, res))
    httpsServer.on('upgrade', (req, socket, head) => wsServer?.handleUpgrade(req, socket, head, client => wsServer?.emit('connection', client, req)))
    httpsServer.listen(port + 1, '0.0.0.0')
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 780,
    minWidth: 900,
    minHeight: 650,
    backgroundColor: '#0b1020',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      preload: join(root, 'apps/desktop/dist/main/preload.js')
    }
  })
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[RENDERER] process exited:', details.reason, details.exitCode)
  })
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('[RENDERER] failed to load:', errorCode, errorDescription, validatedURL)
  })
  if (app.isPackaged) mainWindow.loadFile(join(root, 'apps/desktop/dist/renderer/index.html'))
  else mainWindow.loadURL('http://127.0.0.1:5173')
}

ipcMain.handle('app-info', () => ({
  pairingCode,
  lanAddress: getLanAddress(),
  httpPort: port,
  httpsPort: port + 1
}))

ipcMain.on('signal-to-phone', (_event, message) => broadcastToPhone(message))
ipcMain.handle('new-pairing-code', () => {
  pairingCode = makePairingCode()
  if (pairedSocket) pairedSocket.close()
  sendToDesktop({ type: 'pairing-code', code: pairingCode })
  return pairingCode
})
ipcMain.handle('virtual-camera-status', () => virtualCameraStatus)
ipcMain.handle('virtual-camera-start', async () => {
  const result = await runVirtualCameraCommand('start')
  virtualCameraStatus = result.status
  sendToDesktop({ type: 'virtual-camera-status', status: virtualCameraStatus, error: result.error })
  return result
})
ipcMain.handle('virtual-camera-stop', async () => {
  const result = await runVirtualCameraCommand('stop')
  virtualCameraStatus = result.status
  sendToDesktop({ type: 'virtual-camera-status', status: virtualCameraStatus, error: result.error })
  return result
})
ipcMain.handle('virtual-camera-remove', async () => {
  const result = await runVirtualCameraCommand('remove')
  virtualCameraStatus = result.status
  return result
})
ipcMain.handle('video-frame', (_event, frame) => {
  publishVideoFrame(frame)
  return true
})
ipcMain.handle('disconnect-phone', () => {
  pairedSocket?.close()
  pairedSocket = null
  return true
})

app.whenReady().then(() => {
  session.defaultSession.setCertificateVerifyProc((_request, callback) => callback(0))
  startLanServer()
  startVideoPipe()
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  wsServer?.close()
  httpServer?.close()
  httpsServer?.close()
  stopVideoPipe()
})
