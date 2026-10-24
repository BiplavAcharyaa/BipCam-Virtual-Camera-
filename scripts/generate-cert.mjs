import { mkdirSync, existsSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import os from 'node:os'

const dir = join(process.cwd(), 'certs')
const key = join(dir, 'localhost-key.pem')
const cert = join(dir, 'localhost-cert.pem')
mkdirSync(dir, { recursive: true })
if (existsSync(key) && existsSync(cert)) process.exit(0)
const tmp = join(os.tmpdir(), `bipcam-${Date.now()}.cnf`)
const config = `[req]\ndistinguished_name=req_distinguished_name\nx509_extensions=v3_req\nprompt=no\n[req_distinguished_name]\nCN=BipCam LAN\n[v3_req]\nsubjectAltName=@alt_names\n[alt_names]\nDNS.1=localhost\nIP.1=127.0.0.1\n`
writeFileSync(tmp, config)
try {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '3650', '-config', tmp], { stdio: 'inherit' })
} catch {
  console.error('OpenSSL is required to generate the local HTTPS certificate. Install OpenSSL and run npm run generate:cert.')
  process.exit(1)
}
