// Test turunun başında bir kez çalışır: istemciyi, yerel vekile bağlanacak
// şekilde ayrı bir klasöre derler. desktop/dist'e (gerçek derlemeye)
// dokunmaz.
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { clientBuildDir, desktopDir } from './paths.js'
import { freePort } from './server-process.js'

const run = promisify(execFile)

export default async function globalSetup() {
  const proxyPort = await freePort()
  process.env.DISCO_PROXY_PORT = String(proxyPort)

  const viteBin = path.join(desktopDir, 'node_modules', 'vite', 'bin', 'vite.js')
  try {
    await run(
      process.execPath,
      [viteBin, 'build', '--outDir', clientBuildDir, '--emptyOutDir', '--logLevel', 'warn'],
      {
        cwd: desktopDir,
        env: { ...process.env, VITE_SERVER_URL: `http://127.0.0.1:${proxyPort}` },
        maxBuffer: 20 * 1024 * 1024,
      }
    )
  } catch (err) {
    throw new Error(
      `İstemci derlenemedi. desktop klasöründe "npm install" yapıldı mı?\n${err.stderr || err.message}`
    )
  }
}
