/**
 * Локальная (LAN) presence-служба. Каждый запущенный экземпляр
 * приложения шлёт UDP-broadcast «я живой» с инфой о себе, и слушает
 * такие же пакеты от других. Никакого сервера/аккаунта не нужно —
 * работает в пределах одной IP-сети.
 *
 * Privacy: рассылается hostname, имя Windows-юзера, локальный IP,
 * версия приложения, PID. Можно отключить через prefs (Settings).
 *
 * Firewall: первый запуск пытается забиндить UDP 41789. Windows
 * Defender Firewall попросит разрешение — нужно нажать Allow.
 * Без этого presence просто не работает (молча); ошибка в логах.
 *
 * Под VPN: если VPN дает /32 на туннель — broadcast не пройдёт.
 * Под обычной офисной LAN, домашним роутером, или общим
 * корпоративным VPN с DHCP — работает.
 */

import dgram from 'node:dgram'
import os from 'node:os'
import { app } from 'electron'

const PORT = 41789
const MAGIC = 'workhelper-presence'
const BROADCAST_INTERVAL_MS = 15_000
const SESSION_TTL_MS = 60_000

let socket = null
let broadcastTimer = null
let cleanupTimer = null
const sessions = new Map()
let myId = null
let enabled = false

function localIp() {
  const ifaces = os.networkInterfaces()
  // Берём первый IPv4 не-internal — обычно это LAN-адрес.
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address
    }
  }
  return null
}

function buildPayload() {
  return JSON.stringify({
    kind: MAGIC,
    id: myId,
    user: os.userInfo().username,
    host: os.hostname(),
    ip: localIp(),
    version: app.getVersion(),
    startedAt: startedAtIso,
    pid: process.pid
  })
}

let startedAtIso = null

export function startPresence() {
  if (socket || enabled) return
  enabled = true
  startedAtIso = new Date().toISOString()
  myId = `${os.userInfo().username}@${os.hostname()}#${process.pid}`

  socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
  socket.on('error', (err) => {
    console.warn('[presence] socket error:', err?.message || err)
    stopPresence()
  })
  socket.on('message', (msg, rinfo) => {
    try {
      const data = JSON.parse(msg.toString())
      if (data?.kind !== MAGIC || typeof data.id !== 'string') return
      sessions.set(data.id, {
        ...data,
        remoteAddress: rinfo.address,
        lastSeen: Date.now()
      })
    } catch {
      // мусор, игнорим
    }
  })
  socket.bind(PORT, () => {
    try {
      socket.setBroadcast(true)
    } catch (err) {
      console.warn('[presence] setBroadcast failed:', err?.message)
    }
    sendBroadcast()
  })

  broadcastTimer = setInterval(sendBroadcast, BROADCAST_INTERVAL_MS)
  cleanupTimer = setInterval(cleanupSessions, BROADCAST_INTERVAL_MS)
}

function sendBroadcast() {
  if (!socket || !enabled) return
  const text = buildPayload()
  const buf = Buffer.from(text)
  socket.send(buf, 0, buf.length, PORT, '255.255.255.255', (err) => {
    if (err) console.warn('[presence] send error:', err?.message)
  })
  // Регистрируем самого себя — чтобы в UI был видно «вы»
  try {
    sessions.set(myId, {
      ...JSON.parse(text),
      remoteAddress: localIp(),
      lastSeen: Date.now()
    })
  } catch {
    // ignore
  }
}

function cleanupSessions() {
  const cutoff = Date.now() - SESSION_TTL_MS
  for (const [id, s] of sessions) {
    if (s.lastSeen < cutoff) sessions.delete(id)
  }
}

export function stopPresence() {
  enabled = false
  if (broadcastTimer) {
    clearInterval(broadcastTimer)
    broadcastTimer = null
  }
  if (cleanupTimer) {
    clearInterval(cleanupTimer)
    cleanupTimer = null
  }
  if (socket) {
    try {
      socket.close()
    } catch {
      // ignore
    }
    socket = null
  }
  sessions.clear()
}

/**
 * @returns {{
 *   id: string, user: string, host: string, ip: string|null,
 *   remoteAddress: string|null, version: string,
 *   startedAt: string, lastSeen: number, isMe: boolean
 * }[]}
 */
export function getSessions() {
  cleanupSessions()
  return Array.from(sessions.values())
    .map((s) => ({
      id: s.id,
      user: s.user,
      host: s.host,
      ip: s.ip || null,
      remoteAddress: s.remoteAddress || null,
      version: s.version,
      startedAt: s.startedAt,
      lastSeen: s.lastSeen,
      isMe: s.id === myId
    }))
    .sort((a, b) => {
      if (a.isMe !== b.isMe) return a.isMe ? -1 : 1
      return a.host.localeCompare(b.host) || a.user.localeCompare(b.user)
    })
}

export function isPresenceEnabled() {
  return enabled
}
