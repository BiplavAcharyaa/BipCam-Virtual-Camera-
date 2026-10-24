import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

if (process.platform !== 'win32') process.exit(0)

const root = process.cwd()
const control = join(root, 'native', 'windows-vcam', 'dist', 'BipCamVirtualCameraControl.exe')
const source = join(root, 'native', 'windows-vcam', 'dist', 'BipCamVirtualCameraSource.comhost.dll')

if (existsSync(control) && existsSync(source)) process.exit(0)

// build-vcam.mjs is a Node script; it was previously (wrongly) launched through "dotnet".
const result = spawnSync(process.execPath, [join(root, 'scripts', 'build-vcam.mjs')], { stdio: 'inherit' })
if (result.error || result.status !== 0) console.warn('[BIPCAM] Windows virtual-camera component is not built. The Electron/WebRTC preview will still run.')
