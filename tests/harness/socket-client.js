// Tarayıcı olmadan, doğrudan Socket.IO protokolüyle konuşan test istemcisi.
// İki işe yarıyor: (1) sunucunun o an ne düşündüğünü gözlemlemek (kim
// çevrimiçi, kim seste), (2) arayüzün izin vermediği istekleri göndererek
// sunucu tarafı güvenlik kontrollerini denemek.
import { io } from 'socket.io-client'
import { PASSWORD } from './seed.js'

export class TestClient {
  constructor(url) {
    this.socket = io(url, {
      transports: ['websocket'],
      forceNew: true,
      reconnectionDelay: 200,
      reconnectionDelayMax: 1000,
    })
    this.events = []
    this.members = { online: [], offline: [] }
    this.token = null
    this.socket.onAny((event, ...args) => this.events.push({ event, args }))
    this.socket.on('channel-members', (members) => {
      this.members = members
    })
  }

  connected() {
    if (this.socket.connected) return Promise.resolve()
    return new Promise((resolve, reject) => {
      this.socket.once('connect', resolve)
      this.socket.once('connect_error', reject)
    })
  }

  emitAck(event, payload, timeout = 10_000) {
    return this.socket.timeout(timeout).emitWithAck(event, payload)
  }

  async login(username, password = PASSWORD) {
    const response = await this.emitAck('login', { username, password })
    if (!response?.success) throw new Error(`${username} giriş yapamadı: ${response?.message}`)
    this.username = username
    this.token = response.token
    return response
  }

  // Bir sonraki "name" olayını (isteğe bağlı bir koşulla) bekler.
  nextEvent(name, predicate = () => true, timeout = 10_000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.socket.off(name, handler)
        reject(new Error(`"${name}" olayı ${timeout} ms içinde gelmedi`))
      }, timeout)
      const handler = (...args) => {
        if (!predicate(...args)) return
        clearTimeout(timer)
        this.socket.off(name, handler)
        resolve(args.length > 1 ? args : args[0])
      }
      this.socket.on(name, handler)
    })
  }

  joinChannel(serverId, channelId, timeout = 10_000) {
    this.channel = { serverId, channelId }
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer)
        this.socket.off('channel-members', onMembers)
        this.socket.off('join-error', onError)
      }
      const onMembers = (members) => {
        cleanup()
        resolve(members)
      }
      const onError = (message) => {
        cleanup()
        reject(new Error(`Kanala katılamadı: ${message}`))
      }
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error('Kanala katılma yanıtı gelmedi'))
      }, timeout)
      this.socket.on('channel-members', onMembers)
      this.socket.on('join-error', onError)
      this.socket.emit('join-channel', { serverId, channelId, token: this.token })
    })
  }

  // Bağlantı koparsa (ör. sunucu yeniden başlarsa) kanala kendiliğinden
  // geri dönsün — gözlemci hesap için.
  rejoinOnReconnect() {
    this.socket.io.on('reconnect', () => {
      if (this.channel) this.socket.emit('join-channel', { ...this.channel, token: this.token })
    })
  }

  // Kanaldaki herkese güncel üye listesini yeniden gönderttirir.
  refreshMembers() {
    const next = this.nextEvent('channel-members')
    this.socket.emit('join-channel', { ...this.channel, token: this.token })
    return next
  }

  onlineUsernames() {
    return this.members.online.map((m) => m.username).sort()
  }

  voiceUsernames() {
    return this.members.online
      .filter((m) => m.inVoice)
      .map((m) => m.username)
      .sort()
  }

  received(event) {
    return this.events.filter((e) => e.event === event).map((e) => e.args[0])
  }

  // Olay kaydında bir işaret: "bundan SONRA ne geldi" diye sorabilmek için.
  mark() {
    return this.events.length
  }

  // İşaretten sonra gelen en son üye listesi (hiç gelmediyse null).
  latestMembersSince(mark) {
    const snapshots = this.events.slice(mark).filter((e) => e.event === 'channel-members')
    return snapshots.length ? snapshots[snapshots.length - 1].args[0] : null
  }

  membersSince(mark) {
    return this.events
      .slice(mark)
      .filter((e) => e.event === 'channel-members')
      .map((e) => e.args[0])
  }

  close() {
    this.socket.disconnect()
  }
}
