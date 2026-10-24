import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const source = join(root, '..', 'node_modules', '@mediapipe', 'selfie_segmentation')
const target = join(root, '..', 'apps', 'mobile-web', 'public', 'mediapipe')

if (!existsSync(source)) process.exit(0)
mkdirSync(target, { recursive: true })

// Copy EVERYTHING the runtime may request. The previous whitelist omitted
// selfie_segmentation.binarypb (the graph definition) and *_wasm_bin.data, so the model
// could never load and background blur failed.
for (const file of readdirSync(source)) {
  if (/\.(md|d\.ts|json)$/i.test(file)) continue
  const from = join(source, file)
  if (statSync(from).isFile()) cpSync(from, join(target, file))
}
