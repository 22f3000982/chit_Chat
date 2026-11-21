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
  if (m.media_type === 'image') return m.content ? `📷 ${m.content}` : '📷 Photo'
  if (m.media_type === 'video') return m.content ? `🎥 ${m.content}` : '🎥 Video'
  const t = String(m.content || '')
  return t.length > 140 ? t.slice(0, 140) + '…' : t
}

Deno.serve(async (req) => {
  if (req.headers.get('x-chitchat-secret') !== CHITCHAT_SECRET) return new Response('forbidden', { status: 403 })
  const { record: m } = await req.json().catch(() => ({ record: null }))
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

  await Promise.all(
    subs.data.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400, urgency: 'high' })
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode
        if (code === 404 || code === 410) await db.from('push_subscriptions').delete().eq('endpoint', s.endpoint) // device unsubscribed
      }
    })
  )
  return new Response('sent')
})
