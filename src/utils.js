import { supabase } from './supabase'

const pad = (n) => String(n).padStart(2, '0')

export function timeOf(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function startOfDay(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export function dayKey(iso) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

export function dayLabel(iso) {
  const diff = Math.round((startOfDay(new Date()) - startOfDay(iso)) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  const d = new Date(iso)
  if (diff < 7) return d.toLocaleDateString([], { weekday: 'long' })
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}

export function lastSeenText(iso) {
  if (!iso) return ''
  const diff = Math.round((startOfDay(new Date()) - startOfDay(iso)) / 86400000)
  const t = timeOf(iso)
  if (diff === 0) return `last seen today at ${t}`
  if (diff === 1) return `last seen yesterday at ${t}`
  return `last seen ${dayLabel(iso)} at ${t}`
}

export function initials(name = '') {
  return name.trim().slice(0, 1).toUpperCase()
}

// Shrink big photos before upload: faster to send, saves storage.
export async function compressImage(file, maxSide = 1600, quality = 0.82) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale)
    canvas.height = Math.round(bmp.height * scale)
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality))
    if (!blob || blob.size >= file.size) return file
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch {
    return file
  }
}

// Private bucket → files are opened through short-lived signed links.
const urlCache = new Map()
export async function signedUrl(path) {
  const hit = urlCache.get(path)
  if (hit && hit.exp > Date.now()) return hit.url
  const { data, error } = await supabase.storage.from('media').createSignedUrl(path, 60 * 60 * 6)
  if (error) throw error
  urlCache.set(path, { url: data.signedUrl, exp: Date.now() + 1000 * 60 * 60 * 5 })
  return data.signedUrl
}

// Short notification "pop" made with WebAudio (no sound file needed).
let audioCtx
export function playPop() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)()
    const o = audioCtx.createOscillator()
    const g = audioCtx.createGain()
    o.type = 'sine'
    o.frequency.setValueAtTime(880, audioCtx.currentTime)
    o.frequency.exponentialRampToValueAtTime(440, audioCtx.currentTime + 0.12)
    g.gain.setValueAtTime(0.15, audioCtx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.2)
    o.connect(g).connect(audioCtx.destination)
    o.start()
    o.stop(audioCtx.currentTime + 0.2)
  } catch {
    /* ignore */
  }
}

// Louder two-note chime for a new message when you're not looking at the app
export function playChime() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)()
    if (audioCtx.state === 'suspended') audioCtx.resume()
    const t0 = audioCtx.currentTime
    ;[[988, 0], [1319, 0.14], [988, 0.42], [1319, 0.56]].forEach(([f, at]) => {
      const o = audioCtx.createOscillator()
      const g = audioCtx.createGain()
      o.type = 'triangle'
      o.frequency.setValueAtTime(f, t0 + at)
      g.gain.setValueAtTime(0.0001, t0 + at)
      g.gain.exponentialRampToValueAtTime(0.4, t0 + at + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.25)
      o.connect(g).connect(audioCtx.destination)
      o.start(t0 + at)
      o.stop(t0 + at + 0.27)
    })
  } catch {
    /* ignore */
  }
}

// browsers only allow sound after the first tap/key press on the page
if (typeof window !== 'undefined') {
  const unlock = () => {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)()
      audioCtx.resume()
    } catch { /* ignore */ }
    window.removeEventListener('pointerdown', unlock)
    window.removeEventListener('keydown', unlock)
  }
  window.addEventListener('pointerdown', unlock)
  window.addEventListener('keydown', unlock)
}

export const EMOJIS =
  '😀 😂 🤣 😊 😍 🥰 😘 😜 🤔 😎 😭 😢 😡 😴 🥺 😅 🙈 🙏 👍 👎 👏 🙌 💪 🤝 ❤️ 🧡 💛 💚 💙 💜 🖤 💔 🔥 ✨ 🎉 🎂 🌹 ☕ 🍕 ✅ ❌ 💯 😇 🤗 😏 🤭 😬 🥳'.split(
    ' '
  )
