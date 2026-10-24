import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'

const root = resolve(process.cwd())
const output = join(root, 'native', 'windows-vcam', 'dist')

if (process.platform !== 'win32') {
  console.error('The Windows virtual-camera bridge can only be built on Windows.')
  process.exit(1)
}

const dotnet = process.env.DOTNET_EXE || 'dotnet'
const version = spawnSync(dotnet, ['--version'], { encoding: 'utf8' })
if (version.status !== 0) {
  console.error('The .NET 10 SDK is required to build the Windows virtual-camera component.')
  process.exit(version.status ?? 1)
}

rmSync(output, { recursive: true, force: true })
mkdirSync(output, { recursive: true })

const sourceProject = join(root, 'native', 'windows-vcam', 'source', 'BipCamVirtualCamera.csproj')
const controlProject = join(root, 'native', 'windows-vcam', 'control', 'BipCamVirtualCameraControl.csproj')

const sourceArgs = ['publish', sourceProject, '-c', 'Release', '-r', 'win-x64', '--no-self-contained', '-o', output]
const controlArgs = ['publish', controlProject, '-c', 'Release', '-r', 'win-x64', '--self-contained', 'true', '-o', output]

for (const args of [sourceArgs, controlArgs]) {
  const result = spawnSync(dotnet, args, { stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const source = join(output, 'BipCamVirtualCameraSource.comhost.dll')
const control = join(output, 'BipCamVirtualCameraControl.exe')
if (!existsSync(source) || !existsSync(control)) {
  console.error('The Windows virtual-camera build did not produce the required binaries.')
  process.exit(1)
}

console.log('Windows virtual-camera binaries built successfully.')
