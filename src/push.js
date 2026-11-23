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

// Step-by-step check used by Settings → "Check notifications"
export async function diagnosePush(userId) {
  const steps = []
  const add = (label, ok, detail, fix) => steps.push({ label, ok, detail, fix })

  if (!pushSupported()) {
    add('Browser support', false, 'This browser cannot receive notifications.', 'Use Chrome on Android, or Safari on iPhone (iOS 16.4+) with the app added to the home screen.')
    return steps
  }
  if (needsHomeScreen()) {
    add('iPhone home screen', false, 'On iPhone, notifications only work in the installed app.', 'Safari → Share → Add to Home Screen, then open Chit Chat from the home screen icon.')
    return steps
  }
  add('Browser support', true, 'Supported')

  if (Notification.permission === 'denied') {
    add('Permission', false, 'Notifications are blocked for this site.', 'Phone: Settings → Apps → Chrome (or Chit Chat) → Notifications → Allow. Or in Chrome: ⋮ → Settings → Site settings → Notifications → allow this site.')
    return steps
  }
  if (Notification.permission !== 'granted') {
    try { await Notification.requestPermission() } catch { /* ignore */ }
    if (Notification.permission !== 'granted') {
      add('Permission', false, 'Permission not given yet.', 'Press "Check" again and tap Allow.')
      return steps
    }
  }
  add('Permission', true, 'Allowed')

  let reg
  try {
    reg = await Promise.race([registration(), new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 8000))])
  } catch {
    add('Background service', false, 'The background worker is not running.', 'Close the app fully and open it again (or reload the page).')
    return steps
  }
  add('Background service', true, 'Running')

  // make sure this device is subscribed and saved for this user
  try {
    await enablePush(userId)
  } catch (e) {
    add('This device', false, e.message, /update_4/.test(e.message) ? 'Run update_4_push.sql in Supabase SQL Editor.' : 'Try again; if it keeps failing, reinstall the app.')
    return steps
  }
  const sub = await reg.pushManager.getSubscription()
  add('This device', !!sub, sub ? `Registered with ${new URL(sub.endpoint).host}` : 'Not registered')

  // ask the server to send a test notification
  const { data, error } = await supabase.functions.invoke('notify', { body: { test: true } })
  if (error) {
    const status = error.context?.status
    const fix =
      status === 404 ? 'The Edge Function is missing. In Supabase → Edge Functions, create a function named exactly "notify" and paste notify_READY.ts.'
      : status === 401 ? 'In Supabase → Edge Functions → notify → settings, turn OFF "Verify JWT", then Save.'
      : 'Open Supabase → Edge Functions → notify → Logs to see the error. Re-deploy notify_READY.ts if unsure.'
    add('Server', false, `Could not reach the notify function${status ? ` (error ${status})` : ''}.`, fix)
    return steps
  }
  if (!data?.ok) {
    const r = data?.results?.find((x) => !x.ok)
    const keyIssue = r && (r.code === 401 || r.code === 403)
    add('Server', false, data?.error || `Sending failed${r?.code ? ` (error ${r.code})` : ''}: ${r?.error || ''}`,
      keyIssue ? 'The keys in the notify function don\'t match the app. Re-deploy the latest notify_READY.ts.' : 'Try again in a minute.')
    return steps
  }
  add('Server', true, `Test sent to ${data.devices} device${data.devices > 1 ? 's' : ''}`)

  if (data.messagePath === 'jwt-on')
    add('New-message alerts', false, '"Verify JWT" is ON for the notify function, so real messages can\'t trigger notifications.', 'Supabase → Edge Functions → notify → turn OFF "Verify JWT" (Enforce JWT verification) → Save.')
  else if (data.messagePath === 'ok')
    add('New-message alerts', true, 'Ready. Your friend\'s messages will notify this device.')
  else
    add('New-message alerts', false, `Could not confirm (${data.messagePath}).`, 'Make sure update_4_push.sql was run (it creates the database trigger).')

  return steps
}
