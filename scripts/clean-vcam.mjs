import { rmSync } from 'node:fs'
import { join } from 'node:path'
rmSync(join(process.cwd(), 'native', 'windows-vcam', 'dist'), { recursive: true, force: true })
