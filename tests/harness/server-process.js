// server/server.js'i HİÇ DEĞİŞTİRMEDEN ayrı bir süreç olarak çalıştırıyor.
// Yeniden başlatma, Render'ın deploy/uyku sonrası yeniden başlamasını
// taklit ediyor.
import { spawn } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { serverDir } from './paths.js'

export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

export class ServerProcess {
  constructor({ mongoUri, extraEnv = {} }) {
    // Güvenlik kemeri: yanlışlıkla gerçek veritabanına bağlanmayalım.
    if (!mongoUri.startsWith('mongodb://127.0.0.1:')) {
      throw new Error(`Testler yalnızca yerel MongoDB'ye bağlanabilir, verilen: ${mongoUri}`)
    }
    this.mongoUri = mongoUri
    this.extraEnv = extraEnv
    this.child = null
    this.port = null
    this.logs = []
  }

  async start() {
    this.port = await freePort()
    const env = { ...process.env }
    // Kullanıcının kabuğundaki gerçek ayarlar sızmasın.
    for (const key of ['MONGODB_URI', 'TURN_URL', 'TURN_USERNAME', 'TURN_CREDENTIAL']) delete env[key]
    Object.assign(env, this.extraEnv, { MONGODB_URI: this.mongoUri, PORT: String(this.port) })

    const child = spawn(process.execPath, [path.join(serverDir, 'server.js')], {
      cwd: serverDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    this.child = child
    this.logs.push(`--- sunucu başlatıldı (port ${this.port}) ---`)

    await new Promise((resolve, reject) => {
      let listening = false
      let dbReady = false
      const timer = setTimeout(
        () => reject(new Error(`Sunucu 20 saniyede hazır olmadı:\n${this.logs.join('\n')}`)),
        20_000
      )
      const onLine = (line) => {
        this.logs.push(line)
        if (line.includes('portunda çalışıyor')) listening = true
        if (line.includes('MongoDB bağlantısı kuruldu')) dbReady = true
        if (listening && dbReady) {
          clearTimeout(timer)
          resolve()
        }
      }
      const pipeLines = (stream) => {
        let buffer = ''
        stream.setEncoding('utf8')
        stream.on('data', (chunk) => {
          buffer += chunk
          const lines = buffer.split(/\r?\n/)
          buffer = lines.pop()
          lines.forEach(onLine)
        })
      }
      pipeLines(child.stdout)
      pipeLines(child.stderr)
      child.once('exit', (code) => {
        clearTimeout(timer)
        reject(new Error(`Sunucu açılırken kapandı (çıkış kodu ${code}):\n${this.logs.join('\n')}`))
      })
    })
    child.removeAllListeners('exit')
    child.once('exit', (code) => this.logs.push(`--- sunucu kapandı (çıkış kodu ${code}) ---`))
    return this.port
  }

  async stop() {
    const child = this.child
    if (!child || child.exitCode !== null || child.signalCode !== null) return
    await new Promise((resolve) => {
      child.once('exit', resolve)
      child.kill()
    })
  }

  async restart() {
    await this.stop()
    return this.start()
  }
}
