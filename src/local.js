// Settings that live on this device only (theme, wallpaper, app lock, voice typing language)
import { useEffect, useState } from 'react'

const PREFIX = 'chitchat:'
const EVT = 'chitchat-local'

export function getLocal(key, fallback) {
  try {
    const v = localStorage.getItem(PREFIX + key)
    return v === null ? fallback : JSON.parse(v)
  } catch {
    return fallback
  }
}

export function setLocal(key, value) {
  try {
    if (value === undefined || value === null) localStorage.removeItem(PREFIX + key)
    else localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    /* storage full or blocked */
  }
  window.dispatchEvent(new CustomEvent(EVT, { detail: key }))
}

export function useLocal(key, fallback) {
  const [value, setValue] = useState(() => getLocal(key, fallback))
  useEffect(() => {
    const on = (e) => { if (!e.detail || e.detail === key) setValue(getLocal(key, fallback)) }
    window.addEventListener(EVT, on)
    return () => window.removeEventListener(EVT, on)
  }, [key])
  return [value, (v) => setLocal(key, typeof v === 'function' ? v(getLocal(key, fallback)) : v)]
}

// ---------- theme ----------
export function applyTheme(mode) {
  const dark = mode === 'dark' || (mode === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#202c33' : '#008069')
}

export function useTheme() {
  const [mode] = useLocal('theme', 'light')
  useEffect(() => {
    applyTheme(mode)
    if (mode !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const on = () => applyTheme('system')
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [mode])
}

// ---------- wallpaper ----------
export const WALL_COLORS = ['#efeae2', '#d9e7f5', '#fde2e4', '#e2f0cb', '#fff1c1', '#e0d7f7', '#cfe8e4', '#2c3e50', '#1f2c34', '#3b1f2b']

export function wallpaperStyle(w) {
  if (!w || w.type === 'default') return undefined
  if (w.type === 'color') return { background: w.value }
  if (w.type === 'image') return { background: `center / cover no-repeat url(${w.value})` }
  return undefined
}

export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
