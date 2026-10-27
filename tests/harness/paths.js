import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

export const testsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const repoDir = path.resolve(testsDir, '..')
export const serverDir = path.join(repoDir, 'server')
export const desktopDir = path.join(repoDir, 'desktop')
export const cacheDir = path.join(testsDir, '.cache')
export const clientBuildDir = path.join(cacheDir, 'client')

// Sunucunun kendi modüllerini (db.js, mongoose, bcryptjs) sunucunun
// node_modules'ünden yüklüyoruz — testler sunucuyla birebir aynı şema ve
// kütüphane sürümünü kullansın diye.
export const requireFromServer = createRequire(path.join(serverDir, 'server.js'))
// Masaüstü uygulamasının paketleri (ör. electron: çalıştırılabilir dosyanın yolu).
export const requireFromDesktop = createRequire(path.join(desktopDir, 'package.json'))
