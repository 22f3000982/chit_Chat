// Phone / desktop push notifications
import { supabase } from './supabase'
import { VAPID_PUBLIC_KEY } from './config'

export const pushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent)
const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true
// iPhone only allows notifications once the site is added to the home screen
export const needsHomeScreen = () => isIOS() && !isStandalone()

function keyBytes(base64) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

async function registration() {
  if (!navigator.serviceWorker.controller) await navigator.serviceWorker.register('/sw.js').catch(() => {})
  return navigator.serviceWorker.ready
}

export async function pushState() {
  if (!pushSupported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'blocked'
  if (Notification.permission !== 'granted') return 'off'
  const reg = await registration()
  return (await reg.pushManager.getSubscription()) ? 'on' : 'off'
}

// Ask permission (if needed), subscribe this device and save it for the logged-in user
export async function enablePush(userId) {
  if (!pushSupported()) throw new Error('This browser does not support notifications')
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error('Notifications are blocked. Allow them in your browser settings.')
  const reg = await registration()
  let sub = await reg.pushManager.getSubscription()
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) })
  const j = sub.toJSON()
  await supabase.from('push_subscriptions').delete().eq('endpoint', j.endpoint)
  const { error } = await supabase.from('push_subscriptions').insert({ endpoint: j.endpoint, user_id: userId, p256dh: j.keys.p256dh, auth: j.keys.auth })
  if (error) throw new Error(/relation|schema cache/.test(error.message) ? 'Run update_4_push.sql in Supabase first' : error.message)
}

export async function disablePush() {
  if (!pushSupported()) return
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
  await sub.unsubscribe().catch(() => {})
}

// Log out and stop notifications on this device
export async function logout() {
  try { await disablePush() } catch { /* ignore */ }
  await supabase.auth.signOut()
}
