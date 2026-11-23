// Supabase Edge Function "notify": sends a phone notification for every new message.
// Called by the database trigger in update_4_push.sql.
// Fill in the three values below (or set them as Edge Function secrets with the same names).
import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2'

const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? 'CHANGE_ME_PUBLIC'
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? 'CHANGE_ME_PRIVATE'
const CHITCHAT_SECRET = Deno.env.get('CHITCHAT_SECRET') ?? 'CHANGE_ME_SECRET'

webpush.setVapidDetails('mailto:chitchat@example.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

function preview(m: Record<string, any>) {
  if (m.media_type === 'system') return m.content || 'Chat settings changed'
  if (m.view_once) return `① ${m.media_type === 'video' ? 'Video' : 'Photo'}`
  if (m.media_type === 'audio') return '🎤 Voice message'
  if (m.media_type === 'sticker') return '💟 Sticker'
  if (m.media_type === 'image') return m.content ? `📷 ${plain(m.content)}` : '📷 Photo'
  if (m.media_type === 'video') return m.content ? `🎥 ${plain(m.content)}` : '🎥 Video'
  const t = plain(String(m.content || ''))
  return t.length > 140 ? t.slice(0, 140) + '…' : t
}

// remove *bold* _italic_ __underline__ ~strike~ `code` markers; never reveal ||spoilers||
function plain(t: string) {
  return t
    .replace(/```([\s\S]+?)```/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\|\|([^\n]+?)\|\|/g, '▒▒▒▒')
    .replace(/(^|[\s([{"'|])__(?!\s)([^\n]*?[^\s])__(?=$|[\s)\]}.,!?;:"'|])/g, '$1$2')
    .replace(/(^|[\s([{"'|])([*_~])(?!\s)([^\n]*?[^\s])\2(?=$|[\s)\]}.,!?;:"'|])/g, '$1$3')
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

async function sendTo(subs: Array<Record<string, string>>, payload: string) {
  const results = await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400, urgency: 'high' })
        return { ok: true, service: new URL(s.endpoint).host }
      } catch (e) {
        const err = e as { statusCode?: number; body?: string; message?: string }
        if (err.statusCode === 404 || err.statusCode === 410) await db.from('push_subscriptions').delete().eq('endpoint', s.endpoint) // device unsubscribed
        return { ok: false, service: new URL(s.endpoint).host, code: err.statusCode ?? null, error: String(err.body || err.message || e).slice(0, 200) }
      }
    })
  )
  return results
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const body = await req.json().catch(() => ({}))

  // "Check notifications" button in the app: send a test to the logged-in user's own devices
  if (body.test) {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    const { data: auth } = await db.auth.getUser(token)
    if (!auth?.user) return json({ ok: false, step: 'login', error: 'Not logged in' }, 401)
    const { data: subs, error } = await db.from('push_subscriptions').select('*').eq('user_id', auth.user.id)
    if (error) return json({ ok: false, step: 'database', error: error.message })
    if (!subs?.length) return json({ ok: false, step: 'devices', devices: 0, error: 'No device saved for notifications' })
    const results = await sendTo(subs, JSON.stringify({ title: 'Chit Chat ✅', body: 'Test notification: notifications are working!', tag: 'chitchat-test', test: true, url: '/' }))
    // also check the path new messages use (database → this function, no login token)
    let messagePath = 'unknown'
    try {
      const r = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-chitchat-secret': CHITCHAT_SECRET },
        body: JSON.stringify({ ping: true }),
      })
      messagePath = r.status === 401 ? 'jwt-on' : r.ok ? 'ok' : `http-${r.status}`
    } catch {
      messagePath = 'unreachable'
    }
    return json({ ok: results.some((r) => r.ok), step: 'sent', devices: subs.length, results, messagePath })
  }

  if (req.headers.get('x-chitchat-secret') !== CHITCHAT_SECRET) return new Response('forbidden', { status: 403 })
  if (body.ping) return new Response('pong')
  const m = body.record
  if (!m?.receiver_id) return new Response('skip')

  const [subs, sender, pref] = await Promise.all([
    db.from('push_subscriptions').select('*').eq('user_id', m.receiver_id),
    db.from('profiles').select('name').eq('id', m.sender_id).single(),
    db.from('chat_prefs').select('locked, hidden').eq('user_id', m.receiver_id).eq('friend_id', m.sender_id).maybeSingle(),
  ])
  if (!subs.data?.length) return new Response('no devices')

  // locked / hidden chats never show who or what in the notification
  const secret = pref.data?.locked || pref.data?.hidden
  const payload = JSON.stringify({
    title: secret ? 'Chit Chat' : sender.data?.name ?? 'Chit Chat',
    body: secret ? 'New message' : preview(m),
    tag: secret ? 'chitchat-private' : `chat-${m.sender_id}`,
    url: '/',
  })

  await sendTo(subs.data, payload)
  return new Response('sent')
})
