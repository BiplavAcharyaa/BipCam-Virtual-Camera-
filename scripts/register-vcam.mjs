// Manual helper: registers (or unregisters) the BipCam COM camera source machine-wide (asks for admin).
// BipCam also does this automatically the first time you press "Start Virtual Camera".
import { existsSync, cpSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

if (process.platform !== 'win32') { console.error('Windows only.'); process.exit(1) }
const dist = join(process.cwd(), 'native', 'windows-vcam', 'dist')
if (!existsSync(join(dist, 'BipCamVirtualCameraSource.comhost.dll'))) { console.error('Build first: npm run build:vcam'); process.exit(1) }
// Frame Server (LocalService) cannot read user-profile folders, so register a copy from ProgramData.
const staged = join(process.env.ProgramData || 'C:\\ProgramData', 'BipCam', 'native')
mkdirSync(staged, { recursive: true })
cpSync(dist, staged, { recursive: true, force: true })
const dll = join(staged, 'BipCamVirtualCameraSource.comhost.dll')
const unregister = process.argv.includes('--unregister')
const args = unregister ? "'/u','/s'" : "'/s'"
const script = `Start-Process -FilePath (Join-Path $env:WINDIR 'System32\\regsvr32.exe') -ArgumentList ${args},'"${dll.replace(/'/g, "''")}"' -Verb RunAs -Wait`
const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], { stdio: 'inherit' })
process.exit(result.status ?? 1)
