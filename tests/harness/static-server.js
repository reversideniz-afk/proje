// Test için derlenen istemciyi (tests/.cache/client) tarayıcıya sunan
// minik dosya sunucusu.
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

export function startStaticServer(rootDir) {
  const server = http.createServer(async (req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    const filePath = path.join(rootDir, urlPath === '/' ? 'index.html' : urlPath)
    if (!filePath.startsWith(rootDir)) {
      res.writeHead(403).end()
      return
    }
    try {
      const body = await fs.readFile(filePath)
      const type = CONTENT_TYPES[path.extname(filePath)] || 'application/octet-stream'
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }).end(body)
    } catch {
      res.writeHead(404).end('Bulunamadı')
    }
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}/`,
        close: () => new Promise((r) => server.close(() => r())),
      })
    })
  })
}
