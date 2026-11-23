import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase'
import { dayLabel, initials, playChime, playPop, timeOf } from './utils'
import { Back, Dots, Ticks } from './icons'
import Chat from './Chat'
import Avatar from './Avatar'
import Settings from './Settings'
import { previewOf, useLongPress } from './Bubble'
import { stripFormat } from './format'
import { enablePush, logout, needsHomeScreen, pushState } from './push'
import { getLocal, setLocal, useLocal } from './local'

const PAGE = 60
const byTime = (a, b) => new Date(a.created_at) - new Date(b.created_at)
const EPOCH = '1970-01-01T00:00:00Z'

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function listTime(iso) {
  if (!iso) return ''
  const l = dayLabel(iso)
  return l === 'Today' ? timeOf(iso) : l
}

export default function Home({ session, appLocked }) {
  const myId = session.user.id
  const [me, setMe] = useState(null)
  const [friends, setFriends] = useState([])
  const [messages, setMessagesRaw] = useState([])
  const [hasMore, setHasMore] = useState({})
  const [prefs, setPrefs] = useState({})
  const [prefsReady, setPrefsReady] = useState(true)
  const [lockHash, setLockHash] = useState(null)
  const [loading, setLoading] = useState(true)
  const [online, setOnline] = useState(new Set())
  const [typing, setTyping] = useState({})
  const [visible, setVisible] = useState(document.visibilityState === 'visible')
  const [openId, setOpenId] = useState(null)
  const [view, setView] = useState('all') // all | archived | locked | hidden
  const [unlocked, setUnlocked] = useState(false)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [chatMenu, setChatMenu] = useState(null) // friend id
  const [topMenu, setTopMenu] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [codeDialog, setCodeDialog] = useState(null) // { mode: 'set'|'enter', title, onOk }
  const [toast, setToast] = useState('')

  const roomRef = useRef(null)
  const typingTimers = useRef({})
  const lastTypingSent = useRef(0)
  const unread = useRef(0)
  const openRef = useRef(null)
  openRef.current = openId

  // ---------- phone notifications ----------
  const [push, setPushRaw] = useState('unknown')
  const setPush = (v) => { pushRef.current = v; setPushRaw(v) }
  const [pushDismissed, setPushDismissed] = useLocal('pushBannerDismissed', false)
  useEffect(() => {
    pushState().then((st) => {
      setPush(st)
      // already allowed on this device → make sure it is saved for this user
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') enablePush(myId).then(() => setPush('on')).catch(() => {})
    })
  }, [myId])
  const turnOnPush = async (alreadyDone) => {
    if (alreadyDone === true) return setPush('on')
    try {
      await enablePush(myId)
      setPush('on')
      flash('🔔 Notifications on')
    } catch (e) {
      flash(e.message)
      pushState().then(setPush)
    }
  }

  const flash = useCallback((t) => { setToast(t); setTimeout(() => setToast(''), 2500) }, [])

  const mergeMessages = useCallback((prev, incoming) => {
    const map = new Map(prev.map((m) => [m.id, m]))
    for (const m of incoming) {
      const old = map.get(m.id)
      map.set(m.id, old ? { ...m, _localUrl: old._localUrl } : m)
    }
    return [...map.values()].filter((m) => !(m.deleted_for || []).includes(myId)).sort(byTime)
  }, [myId])
  const setMessages = setMessagesRaw

  const pairFilter = (fid) => `and(sender_id.eq.${myId},receiver_id.eq.${fid}),and(sender_id.eq.${fid},receiver_id.eq.${myId})`

  const fetchLatest = useCallback(async (list) => {
    const results = await Promise.all(
      list.map((f) => supabase.from('messages').select('*').or(pairFilter(f.id)).order('created_at', { ascending: false }).limit(PAGE))
    )
    const all = []
    const more = {}
    results.forEach((r, i) => { all.push(...(r.data || [])); more[list[i].id] = (r.data || []).length === PAGE })
    return { all, more }
  }, [myId])

  // ---------- initial load ----------
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: profiles } = await supabase.from('profiles').select('*')
      const others = (profiles || []).filter((p) => p.id !== myId).sort((a, b) => a.name.localeCompare(b.name))
      const [{ all, more }, prefRes, privRes] = await Promise.all([
        fetchLatest(others),
        supabase.from('chat_prefs').select('*'),
        supabase.from('private_settings').select('lock_hash').eq('user_id', myId).maybeSingle(),
      ])
      if (cancelled) return
      setMe((profiles || []).find((p) => p.id === myId) || null)
      setFriends(others)
      // messages typed while offline (saved on this device) show up as "sending"
      const queued = getLocal('outbox', []).filter((r) => r.sender_id === myId).map(({ _at, ...r }) => ({
        reactions: {}, meta: {}, deleted_for: [], deleted_for_everyone: false, ...r, created_at: _at || new Date().toISOString(), _status: 'sending',
      }))
      setMessages(mergeMessages([], [...all, ...queued]))
      setHasMore(more)
      if (prefRes.error) setPrefsReady(false)
      else setPrefs(Object.fromEntries((prefRes.data || []).map((p) => [p.friend_id, p])))
      setLockHash(privRes.data?.lock_hash || null)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [myId, fetchLatest, mergeMessages])

  // ---------- realtime ----------
  useEffect(() => {
    const ch = supabase
      .channel('db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, ({ eventType, new: m }) => {
        if (eventType === 'DELETE' || !m?.id) return
        if (eventType === 'INSERT' && m.receiver_id === myId) alertRef.current?.(m)
        setMessages((prev) => mergeMessages(prev, [m]))
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, ({ new: p }) => {
        if (p.id === myId) setMe(p)
        else setFriends((fs) => fs.map((f) => (f.id === p.id ? p : f)))
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [myId, mergeMessages])

  // ---------- alert for a new message: chime, blinking tab title, popup ----------
  const alertRef = useRef(null)
  const blinkTimer = useRef(null)
  const pushRef = useRef('unknown')
  const stopBlink = useCallback(() => {
    clearInterval(blinkTimer.current)
    blinkTimer.current = null
    unread.current = 0
    document.title = 'Chit Chat'
  }, [])
  alertRef.current = (m) => {
    const away = document.visibilityState !== 'visible' || !document.hasFocus()
    if (!away) {
      if (openRef.current !== m.sender_id) playPop() // looking at the app, but another screen
      return
    }
    const sender = friendsRef.current.find((f) => f.id === m.sender_id)
    const p = prefsRef.current[m.sender_id]
    const secret = p?.locked || p?.hidden
    const name = secret ? 'Chit Chat' : sender?.name || 'New message'
    const body = secret ? 'New message' : previewOf(m) || 'New message'
    unread.current += 1
    playChime()
    navigator.vibrate?.([120, 60, 120])
    // blink the tab title so it's easy to spot
    clearInterval(blinkTimer.current)
    let on = false
    const a = `(${unread.current}) Chit Chat`
    const b = secret ? '💬 New message' : `💬 ${sender?.name || 'New'} messaged you`
    document.title = b
    blinkTimer.current = setInterval(() => { on = !on; document.title = on ? a : b }, 1000)
    // popup from the page itself when phone-style push isn't on for this device
    if (pushRef.current !== 'on' && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      navigator.serviceWorker?.getRegistration().then((reg) => {
        const opts = { body, icon: '/icon-192.png', badge: '/badge-96.png', tag: secret ? 'chitchat-private' : `chat-${m.sender_id}`, renotify: true }
        if (reg) reg.showNotification(name, opts)
        else new Notification(name, opts)
      }).catch(() => {})
    }
  }
  useEffect(() => {
    const back = () => { if (document.visibilityState === 'visible' && document.hasFocus()) stopBlink() }
    window.addEventListener('focus', back)
    document.addEventListener('visibilitychange', back)
    return () => { window.removeEventListener('focus', back); document.removeEventListener('visibilitychange', back); stopBlink() }
  }, [stopBlink])

  // ---------- presence (online) + typing ----------
  useEffect(() => {
    const ch = supabase.channel('room', { config: { presence: { key: myId } } })
    roomRef.current = ch
    ch.on('presence', { event: 'sync' }, () => setOnline(new Set(Object.keys(ch.presenceState()))))
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (!payload || payload.to !== myId) return
        const from = payload.from
        const kind = payload.kind === 'recording' ? 'recording' : payload.kind === 'stop' ? false : 'typing'
        setTyping((t) => ({ ...t, [from]: kind }))
        clearTimeout(typingTimers.current[from])
        typingTimers.current[from] = setTimeout(() => setTyping((t) => ({ ...t, [from]: false })), 3000)
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED' && document.visibilityState === 'visible') ch.track({ at: Date.now() })
      })
    return () => { supabase.removeChannel(ch); roomRef.current = null }
  }, [myId])

  const sendTyping = useCallback((to, kind = 'typing') => {
    const now = Date.now()
    if (kind !== 'stop' && now - lastTypingSent.current < 2000) return
    lastTypingSent.current = kind === 'stop' ? 0 : now
    roomRef.current?.send({ type: 'broadcast', event: 'typing', payload: { from: myId, to, kind } })
  }, [myId])

  // ---------- visibility: online/offline, last seen, catch up, re-lock ----------
  const touchLastSeen = useCallback(() => {
    supabase.from('profiles').update({ last_seen: new Date().toISOString() }).eq('id', myId).then(() => {})
  }, [myId])

  const prefsRef = useRef(prefs)
  prefsRef.current = prefs
  const friendsRef = useRef(friends)
  friendsRef.current = friends

  useEffect(() => {
    const onVis = async () => {
      const v = document.visibilityState === 'visible'
      setVisible(v)
      touchLastSeen()
      if (v) {
        roomRef.current?.track({ at: Date.now() })
        const { all } = await fetchLatest(friendsRef.current)
        setMessages((prev) => mergeMessages(prev, all))
      } else {
        roomRef.current?.untrack()
        // leaving the app locks locked/hidden chats again
        const p = prefsRef.current[openRef.current]
        if (p?.locked || p?.hidden) setOpenId(null)
        setUnlocked(false)
        setView((vw) => (vw === 'locked' || vw === 'hidden' ? 'all' : vw))
      }
    }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('pagehide', touchLastSeen)
    touchLastSeen()
    const beat = setInterval(() => document.visibilityState === 'visible' && touchLastSeen(), 60000)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pagehide', touchLastSeen)
      clearInterval(beat)
    }
  }, [touchLastSeen, fetchLatest, mergeMessages])

  // ---------- delivered ticks (any chat, as soon as the app has the message) ----------
  const markingDelivered = useRef(false)
  useEffect(() => {
    if (markingDelivered.current || !messages.some((m) => m.receiver_id === myId && !m.delivered_at)) return
    markingDelivered.current = true
    const now = new Date().toISOString()
    supabase.from('messages').update({ delivered_at: now }).eq('receiver_id', myId).is('delivered_at', null).then(() => {
      setMessages((prev) => prev.map((m) => (m.receiver_id === myId && !m.delivered_at ? { ...m, delivered_at: now } : m)))
      markingDelivered.current = false
    })
  }, [messages, myId])

  // ---------- browser / phone back button closes the chat ----------
  useEffect(() => {
    const onPop = () => {
      if (openRef.current) setOpenId(null)
      else setView('all')
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const openChat = (fid) => {
    if (!openRef.current) history.pushState({ chat: fid }, '')
    setOpenId(fid)
  }
  const closeChat = () => {
    if (history.state?.chat) history.back()
    else setOpenId(null)
  }

  // ---------- offline sending: keep unsent messages and send them when the internet is back ----------
  const [netOnline, setNetOnline] = useState(navigator.onLine)
  const pendingFiles = useRef(new Map()) // id → { file, row } (photos/voice wait in memory while the app is open)
  const flushing = useRef(false)

  const isNetworkError = useCallback(
    (e) => !navigator.onLine || /failed to fetch|network|load failed|timeout|fetch failed|ERR_/i.test(String(e?.message || e)),
    []
  )

  const queueSend = useCallback((row, file) => {
    if (file) pendingFiles.current.set(row.id, { file, row })
    else setLocal('outbox', [...getLocal('outbox', []).filter((r) => r.id !== row.id), { ...row, _at: new Date().toISOString() }])
  }, [])

  const flushOutbox = useCallback(async () => {
    if (flushing.current || !navigator.onLine) return
    flushing.current = true
    try {
      // 1) photos / voice notes that could not upload
      for (const [id, { file, row }] of [...pendingFiles.current]) {
        const ext = (file.name?.split('.').pop() || 'bin').toLowerCase().slice(0, 5)
        const path = `${myId}/${row.id}.${ext}`
        const up = await supabase.storage.from('media').upload(path, file, { contentType: file.type, upsert: false })
        if (up.error && isNetworkError(up.error)) break
        pendingFiles.current.delete(id)
        if (up.error && !/exists|duplicate/i.test(up.error.message)) {
          setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, _status: 'failed' } : m)))
          continue
        }
        queueSend({ ...row, media_path: path })
      }
      // 2) messages waiting to be saved
      for (const { _at, ...row } of getLocal('outbox', [])) {
        const { data, error } = await supabase.from('messages').upsert(row, { onConflict: 'id', ignoreDuplicates: true }).select()
        if (error && isNetworkError(error)) break
        setLocal('outbox', getLocal('outbox', []).filter((r) => r.id !== row.id))
        if (error) setMessages((prev) => prev.map((m) => (m.id === row.id ? { ...m, _status: 'failed' } : m)))
        else {
          const rows = Array.isArray(data) ? data : data ? [data] : []
          if (rows.length) setMessages((prev) => mergeMessages(prev, rows))
          else setMessages((prev) => prev.map((m) => (m.id === row.id ? { ...m, _status: undefined } : m)))
        }
      }
    } finally {
      flushing.current = false
    }
  }, [myId, isNetworkError, mergeMessages, queueSend])

  useEffect(() => {
    const on = () => { setNetOnline(true); flushOutbox() }
    const off = () => setNetOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    flushOutbox()
    const t = setInterval(() => {
      if (getLocal('outbox', []).length || pendingFiles.current.size) flushOutbox()
    }, 15000)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); clearInterval(t) }
  }, [flushOutbox])

  // ---------- disappearing messages: hide expired ones, clean them up ----------
  const [nowTick, setNowTick] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 30000)
    const clean = async () => {
      const { data, error } = await supabase.rpc('cleanup_expired')
      if (error) return
      const paths = (data || []).map((r) => (typeof r === 'string' ? r : r?.cleanup_expired)).filter(Boolean)
      if (paths.length) supabase.storage.from('media').remove(paths)
    }
    clean()
    const c = setInterval(clean, 5 * 60000)
    return () => { clearInterval(t); clearInterval(c) }
  }, [])

  // ---------- per-chat data ----------
  const convo = useCallback(
    (fid) => messages.filter((m) =>
      ((m.sender_id === myId && m.receiver_id === fid) || (m.sender_id === fid && m.receiver_id === myId)) &&
      (!m.expires_at || new Date(m.expires_at) > nowTick)),
    [messages, myId, nowTick]
  )

  const fallbackReadAt = (fid) => {
    const read = convo(fid).filter((m) => m.sender_id === fid && m.read_at)
    return read.length ? read[read.length - 1].created_at : EPOCH
  }

  const unreadCount = (fid) => {
    const p = prefs[fid]
    return convo(fid).filter(
      (m) => m.sender_id === fid && !m.deleted_for_everyone && (p ? new Date(m.created_at) > new Date(p.last_read_at) : !m.read_at)
    ).length
  }

  const updatePref = useCallback(async (fid, patch) => {
    if (!prefsReady) { flash('Run update_1_chat_list.sql in Supabase first'); return }
    const base = prefsRef.current[fid] || { user_id: myId, friend_id: fid, pinned: false, archived: false, locked: false, hidden: false, last_read_at: fallbackReadAt(fid) }
    const row = { ...base, ...patch }
    prefsRef.current = { ...prefsRef.current, [fid]: row }
    setPrefs((all) => ({ ...all, [fid]: row }))
    const { error } = await supabase.from('chat_prefs').upsert(row)
    if (error) flash('Could not save: ' + error.message)
  }, [myId, prefsReady, flash, messages])

  const loadOlder = useCallback(async (fid, before) => {
    const { data } = await supabase.from('messages').select('*').or(pairFilter(fid)).lt('created_at', before).order('created_at', { ascending: false }).limit(PAGE)
    setHasMore((h) => ({ ...h, [fid]: (data || []).length === PAGE }))
    if (data?.length) setMessages((prev) => mergeMessages(prev, data))
    return !!data?.length
  }, [myId, mergeMessages])

  // ---------- secret code (chat lock) ----------
  const checkCode = async (code) => lockHash && (await sha256(`${myId}:${code}`)) === lockHash

  const setNewCode = (then) =>
    setCodeDialog({
      mode: 'set',
      title: lockHash ? 'New secret code' : 'Create a secret code',
      note: 'You will need it to open locked chats. Typing it in the search bar shows hidden chats.',
      onOk: async (code) => {
        if (!prefsReady) { flash('Run update_1_chat_list.sql in Supabase first'); return false }
        const hash = await sha256(`${myId}:${code}`)
        const { error } = await supabase.from('private_settings').upsert({ user_id: myId, lock_hash: hash })
        if (error) { flash('Could not save: ' + error.message); return false }
        setLockHash(hash)
        flash('Secret code saved ✔')
        then?.()
        return true
      },
    })

  const askCode = (title, then) =>
    setCodeDialog({
      mode: 'enter',
      title,
      onOk: async (code) => {
        if (!(await checkCode(code))) return 'Wrong code'
        then()
        return true
      },
    })

  const withCode = (fn) => (lockHash ? fn() : setNewCode(fn))

  // search box doubles as the secret door for hidden chats
  useEffect(() => {
    if (!lockHash || search.length < 4) return
    let alive = true
    checkCode(search).then((ok) => {
      if (ok && alive) { setSearch(''); setUnlocked(true); setView('hidden'); flash('Showing hidden chats') }
    })
    return () => { alive = false }
  }, [search, lockHash])

  // ---------- chat options ----------
  const chatActions = (fid) => {
    const p = prefs[fid] || {}
    const close = () => setChatMenu(null)
    const acts = []
    acts.push({ label: p.pinned ? '📌 Unpin chat' : '📌 Pin chat', run: () => updatePref(fid, { pinned: !p.pinned }) })
    if (!p.hidden && !p.locked)
      acts.push({ label: p.archived ? '📤 Unarchive chat' : '📥 Archive chat', run: () => updatePref(fid, { archived: !p.archived }) })
    if (!p.hidden)
      acts.push({
        label: p.locked ? '🔓 Remove chat lock' : '🔒 Lock chat',
        run: () => (p.locked
          ? askCode('Enter secret code to remove lock', () => { updatePref(fid, { locked: false }); flash('Chat unlocked') })
          : withCode(() => { updatePref(fid, { locked: true, archived: false }); setUnlocked(false); if (view === 'all') setOpenId((o) => (o === fid ? null : o)); flash('Chat locked 🔒') })),
      })
    acts.push({
      label: p.hidden ? '👁️ Unhide chat' : '🙈 Hide chat',
      run: () => (p.hidden
        ? (updatePref(fid, { hidden: false }), flash('Chat is visible again'))
        : withCode(() => { updatePref(fid, { hidden: true, archived: false }); setOpenId((o) => (o === fid ? null : o)); flash('Chat hidden. Type your secret code in search to see it.') })),
    })
    if (unreadCount(fid) > 0) acts.push({ label: '✔️ Mark as read', run: () => updatePref(fid, { last_read_at: new Date().toISOString() }) })
    return acts.map((a) => ({ ...a, run: () => { close(); a.run() } }))
  }

  // ---------- list building ----------
  const rows = useMemo(() => {
    return friends.map((f) => {
      const c = convo(f.id)
      return { friend: f, last: c[c.length - 1], pref: prefs[f.id] || {}, unread: unreadCount(f.id) }
    })
  }, [friends, messages, prefs, nowTick])

  const inView = (r) => {
    const p = r.pref
    if (view === 'hidden') return p.hidden
    if (p.hidden) return false
    if (view === 'locked') return p.locked
    if (p.locked) return false
    if (view === 'archived') return p.archived
    return !p.archived
  }

  const shown = rows
    .filter(inView)
    .filter((r) => (filter === 'unread' ? r.unread > 0 : true))
    .filter((r) => !search || r.friend.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => (b.pref.pinned ? 1 : 0) - (a.pref.pinned ? 1 : 0) || new Date(b.last?.created_at || 0) - new Date(a.last?.created_at || 0))

  const archivedRows = rows.filter((r) => r.pref.archived && !r.pref.locked && !r.pref.hidden)
  const lockedRows = rows.filter((r) => r.pref.locked && !r.pref.hidden)
  const archivedUnread = archivedRows.reduce((n, r) => n + (r.unread ? 1 : 0), 0)
  const lockedUnread = lockedRows.some((r) => r.unread)

  async function updateMe(patch, alreadySaved = false) {
    setMe((p) => ({ ...p, ...patch }))
    if (!alreadySaved) await supabase.from('profiles').update(patch).eq('id', myId)
  }

  if (loading || !me) return <div className="center-screen"><div className="spinner" /></div>

  const openFriend = friends.find((f) => f.id === openId)
  const viewTitle = { archived: 'Archived', locked: 'Locked chats', hidden: 'Hidden chats' }[view]

  return (
    <div className={'home' + (openFriend ? ' chat-open' : '')}>
      {/* ---------------- chat list ---------------- */}
      <section className="sidebar">
        {settingsOpen ? (
          <Settings
            me={me}
            onClose={() => setSettingsOpen(false)}
            onChange={updateMe}
            flash={flash}
            hasLock={!!lockHash}
            friends={friends}
            push={push}
            onPushOn={turnOnPush}
            onPushOff={async () => { const { disablePush } = await import('./push'); await disablePush(); setPush('off'); flash('Notifications off on this device') }}
            onChangeLockCode={() => (lockHash ? askCode('Enter current secret code', () => setNewCode()) : setNewCode())}
          />
        ) : (
          <>
            {!netOnline && <div className="offline-bar top">📶 You're offline. Messages will send when you're back online.</div>}
            <header className="list-header">
              {view === 'all' ? (
                <h1>Chit Chat</h1>
              ) : (
                <>
                  <button className="icon-btn dark" onClick={() => setView('all')} aria-label="Back"><Back /></button>
                  <h2>{viewTitle}</h2>
                </>
              )}
              <div className="spacer" />
              <Avatar person={me} className="small" title={me.name} onClick={() => setSettingsOpen(true)} />
              <div className="top-menu-wrap">
                <button className="icon-btn dark" onClick={() => setTopMenu((s) => !s)} aria-label="Menu"><Dots /></button>
                {topMenu && (
                  <div className="dropdown" onMouseLeave={() => setTopMenu(false)}>
                    <button onClick={() => { setTopMenu(false); setSettingsOpen(true) }}>Settings</button>
                    <button onClick={() => { setTopMenu(false); logout() }}>Log out</button>
                  </div>
                )}
              </div>
            </header>

            {view === 'all' && (
              <>
                <div className="search">
                  <span>🔍</span>
                  <input placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} autoComplete="off" />
                </div>
                <div className="chips">
                  <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>All</button>
                  <button className={filter === 'unread' ? 'on' : ''} onClick={() => setFilter('unread')}>
                    Unread {rows.filter((r) => inView(r) && r.unread).length || ''}
                  </button>
                </div>
              </>
            )}

            {view === 'all' && !pushDismissed && (push === 'off' || push === 'blocked') && (
              <div className="push-banner">
                <span className="push-bell">🔔</span>
                <div>
                  <b>Get notified of new messages</b>
                  <small>
                    {needsHomeScreen()
                      ? 'On iPhone: Share → Add to Home Screen, then open Chit Chat from there.'
                      : push === 'blocked'
                        ? 'Notifications are blocked. Allow them in your browser site settings.'
                        : 'Turn on notifications so you know when a message arrives.'}
                  </small>
                  <div className="push-actions">
                    {push === 'off' && !needsHomeScreen() && <button className="primary small" onClick={turnOnPush}>Turn on</button>}
                    <button className="link" onClick={() => setPushDismissed(true)}>Not now</button>
                  </div>
                </div>
              </div>
            )}

            <div className="chat-list">
              {view === 'all' && !search && lockedRows.length > 0 && (
                <button className="folder-row" onClick={() => (unlocked ? setView('locked') : askCode('Enter secret code', () => { setUnlocked(true); setView('locked') }))}>
                  <span className="folder-icon">🔒</span>
                  <span className="folder-name">Locked chats</span>
                  {lockedUnread && <span className="dot" />}
                </button>
              )}
              {view === 'all' && !search && archivedRows.length > 0 && (
                <button className="folder-row" onClick={() => setView('archived')}>
                  <span className="folder-icon">📥</span>
                  <span className="folder-name">Archived</span>
                  <span className="folder-count">{archivedUnread || archivedRows.length}</span>
                </button>
              )}

              {shown.map((r) => (
                <ChatRow
                  key={r.friend.id}
                  row={r}
                  myId={myId}
                  me={me}
                  active={openId === r.friend.id}
                  typing={typing[r.friend.id]}
                  onOpen={() => openChat(r.friend.id)}
                  onMenu={() => setChatMenu(r.friend.id)}
                />
              ))}

              {!shown.length && (
                <p className="list-empty">
                  {search ? 'No chats found' : view === 'all' ? (filter === 'unread' ? 'No unread chats' : 'No chats here') : 'Nothing here'}
                </p>
              )}
              {view === 'hidden' && <p className="list-note">These chats are hidden from the list. Tap ⋮ / long-press → Unhide to bring one back.</p>}
              {view === 'archived' && <p className="list-note">Archived chats stay archived when new messages arrive.</p>}
            </div>
          </>
        )}
      </section>

      {/* ---------------- open conversation ---------------- */}
      <section className="pane">
        {openFriend ? (
          <Chat
            key={openFriend.id}
            me={me}
            friend={openFriend}
            messages={convo(openFriend.id)}
            setMessages={setMessages}
            mergeMessages={mergeMessages}
            hasMore={!!hasMore[openFriend.id]}
            loadOlder={loadOlder}
            online={online.has(openFriend.id)}
            typing={typing[openFriend.id] || false}
            sendTyping={sendTyping}
            visible={visible && !appLocked}
            pref={prefs[openFriend.id]}
            updatePref={updatePref}
            onBack={closeChat}
            chatActions={chatActions(openFriend.id)}
            flash={flash}
            queueSend={queueSend}
            isNetworkError={isNetworkError}
            netOnline={netOnline}
          />
        ) : (
          <div className="pane-empty">
            <img src="/icon.svg" alt="" width="72" height="72" />
            <h2>Chit Chat</h2>
            <p>Pick a chat from the list to start talking.</p>
            <small>🔒 Private between you two</small>
          </div>
        )}
      </section>

      {chatMenu && (
        <div className="overlay" onClick={() => setChatMenu(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-title">{friends.find((f) => f.id === chatMenu)?.name}</div>
            {chatActions(chatMenu).map((a) => <button key={a.label} onClick={a.run}>{a.label}</button>)}
          </div>
        </div>
      )}

      {codeDialog && <CodeDialog {...codeDialog} onClose={() => setCodeDialog(null)} />}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------

function ChatRow({ row, myId, me, active, typing, onOpen, onMenu }) {
  const { friend, last, pref, unread } = row
  const handlers = useLongPress(onMenu)
  const [draft] = useLocal('draft:' + friend.id, '')
  const mine = last?.sender_id === myId
  const st = !last ? null : last._status || (last.read_at && me.read_receipts ? 'read' : last.delivered_at ? 'delivered' : 'sent')
  return (
    <div className={'chat-row' + (active ? ' active' : '')} onClick={onOpen} {...handlers} role="button" tabIndex={0}>
      <Avatar person={friend} className="big-ish" />
      <div className="chat-row-main">
        <div className="chat-row-top">
          <span className="chat-row-name">{friend.name}</span>
          <span className={'chat-row-time' + (unread ? ' unread' : '')}>{listTime(last?.created_at)}</span>
        </div>
        <div className="chat-row-bottom">
          <span className={'chat-row-preview' + (typing ? ' typing' : '')}>
            {typing ? (typing === 'recording' ? '🎤 recording audio…' : 'typing…') : draft && !active ? (
              <><span className="draft-label">Draft:</span> {stripFormat(draft).replace(/\s+/g, ' ')}</>
            ) : last ? (
              <>
                {mine && !last.deleted_for_everyone && last.media_type !== 'system' && <Ticks status={st} />}
                {previewOf(last)}
              </>
            ) : 'Tap to start chatting'}
          </span>
          {pref.pinned && <span className="pin" title="Pinned">📌</span>}
          {unread > 0 && <span className="badge inline">{unread}</span>}
          <button className="row-menu" onClick={(e) => { e.stopPropagation(); onMenu() }} aria-label="Chat options">⌄</button>
        </div>
      </div>
    </div>
  )
}

function CodeDialog({ mode, title, note, onOk, onClose }) {
  const [code, setCode] = useState('')
  const [code2, setCode2] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (code.length < 4) return setErr('Use at least 4 characters')
    if (mode === 'set' && code !== code2) return setErr("Codes don't match")
    setBusy(true)
    const res = await onOk(code)
    setBusy(false)
    if (res === true) onClose()
    else if (typeof res === 'string') { setErr(res); setCode('') }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <form className="dialog code-dialog" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="lock-big">🔒</div>
        <p>{title}</p>
        {note && <small>{note}</small>}
        <input type="password" autoFocus autoCapitalize="none" placeholder="Secret code" value={code} onChange={(e) => { setCode(e.target.value); setErr('') }} />
        {mode === 'set' && (
          <input type="password" autoCapitalize="none" placeholder="Type it again" value={code2} onChange={(e) => { setCode2(e.target.value); setErr('') }} />
        )}
        {err && <div className="error">{err}</div>}
        <div className="dialog-actions row">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={busy}>{mode === 'set' ? 'Save' : 'Unlock'}</button>
        </div>
      </form>
    </div>
  )
}
