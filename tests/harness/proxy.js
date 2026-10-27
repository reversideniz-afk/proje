// İstemci ile sunucu arasına giren küçük bir TCP vekili. Testler bununla
// "internet bir an gidip geldi" durumunu (dropAll) ve sunucunun yeniden
// başlamasını (setTarget ile yeni sürece yönlendirme) taklit ediyor.
import net from 'node:net'

export function createProxy() {
  let targetPort = null
  const pairs = new Set()

  const server = net.createServer((client) => {
    if (!targetPort) {
      client.destroy()
      return
    }
    const upstream = net.connect(targetPort, '127.0.0.1')
    const pair = { client, upstream }
    pairs.add(pair)
    const close = () => {
      client.destroy()
      upstream.destroy()
      pairs.delete(pair)
    }
    client.on('error', close).on('close', close)
    upstream.on('error', close).on('close', close)
    client.pipe(upstream)
    upstream.pipe(client)
  })

  return {
    listen(port = 0) {
      return new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, '127.0.0.1', () => resolve(server.address().port))
      })
    },
    setTarget(port) {
      targetPort = port
    },
    // Açık bütün bağlantıları aniden keser — istemciler bunu ağ kopması
    // olarak görür ve kendi kendine yeniden bağlanmaya çalışır.
    dropAll() {
      for (const { client, upstream } of pairs) {
        client.destroy()
        upstream.destroy()
      }
      pairs.clear()
    },
    close() {
      this.dropAll()
      return new Promise((resolve) => server.close(() => resolve()))
    },
  }
}
