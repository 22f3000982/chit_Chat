import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { MAX_VIDEO_MB } from './config'
import { compressImage, dayKey, dayLabel, EMOJIS, initials, lastSeenText, playPop, signedUrl, timeOf } from './utils'
import { Back, Ban, Clip, Close, Dots, Down, Download, Play, Send, Smile, Ticks } from './icons'

const PAGE = 60

const byTime = (a, b) => new Date(a.created_at) - new Date(b.created_at)

function mergeMessages(prev, incoming, myId) {
  const map = new Map(prev.map((m) => [m.id, m]))
  for (const m of incoming) {
    const old = map.get(m.id)
    // keep the local preview of a photo we just sent, drop the "sending" state
    map.set(m.id, old ? { ...m, _localUrl: old._localUrl } : m)
  }
  return [...map.values()].filter((m) => !(m.deleted_for || []).includes(myId)).sort(byTime)
}

export default function Chat({ session }) {
  const myId = session.user.id
  const [me, setMe] = useState(null)
  const [other, setOther] = useState(null)
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(false)
  const [text, setText] = useState('')
  const [replyTo, setReplyTo] = useState(null)
  const [showEmoji, setShowEmoji] = useState(false)
  const [otherOnline, setOtherOnline] = useState(false)
  const [otherTyping, setOtherTyping] = useState(false)
  const [visible, setVisible] = useState(document.visibilityState === 'visible')
  const [menu, setMenu] = useState(null) // message whose options are open
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [picked, setPicked] = useState(null) // { file, url, kind }
  const [caption, setCaption] = useState('')
  const [viewer, setViewer] = useState(null) // { url, kind, name }
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [newCount, setNewCount] = useState(0)
  const [toast, setToast] = useState('')
  const [showDown, setShowDown] = useState(false)

  const listRef = useRef(null)
  const atBottom = useRef(true)
  const stickNext = useRef(true)
  const prependFrom = useRef(null)
  const roomRef = useRef(null)
  const typingTimer = useRef(null)
  const lastTypingSent = useRef(0)
  const marking = useRef(false)
  const unread = useRef(0)
  const fileInput = useRef(null)
  const textRef = useRef(null)
  const meRef = useRef(null)
  meRef.current = me

  const flash = (t) => { setToast(t); setTimeout(() => setToast(''), 2500) }

  // ---------- initial load ----------
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: profiles } = await supabase.from('profiles').select('*')
      if (cancelled) return
      setMe(profiles?.find((p) => p.id === myId) || null)
      setOther(profiles?.find((p) => p.id !== myId) || null)
      const { data } = await supabase.from('messages').select('*').order('created_at', { ascending: false }).limit(PAGE)
      if (cancelled) return
      stickNext.current = true
      setMessages(mergeMessages([], data || [], myId))
      setHasMore((data || []).length === PAGE)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [myId])

  // ---------- realtime: new / changed messages and profile changes ----------
  useEffect(() => {
    const ch = supabase
      .channel('db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, ({ eventType, new: m }) => {
        if (eventType === 'DELETE' || !m?.id) return
        if (eventType === 'INSERT' && m.sender_id !== myId) {
          if (atBottom.current) stickNext.current = true
          else setNewCount((n) => n + 1)
          if (document.visibilityState !== 'visible') {
            unread.current += 1
            document.title = `(${unread.current}) Chit Chat`
            playPop()
          }
        }
        setMessages((prev) => mergeMessages(prev, [m], myId))
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, ({ new: p }) => {
        if (p.id === myId) setMe(p)
        else setOther(p)
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [myId])

  // ---------- presence (online) + typing ----------
  useEffect(() => {
    if (!other) return
    const ch = supabase.channel('room', { config: { presence: { key: myId } } })
    roomRef.current = ch
    ch.on('presence', { event: 'sync' }, () => {
      setOtherOnline(Object.keys(ch.presenceState()).includes(other.id))
    })
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (payload?.from === myId) return
        setOtherTyping(true)
        clearTimeout(typingTimer.current)
        typingTimer.current = setTimeout(() => setOtherTyping(false), 3000)
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED' && document.visibilityState === 'visible') ch.track({ at: Date.now() })
      })
    return () => { supabase.removeChannel(ch); roomRef.current = null }
  }, [myId, other?.id])

  // ---------- visibility: online/offline, last seen, catch up ----------
  const touchLastSeen = useCallback(() => {
    supabase.from('profiles').update({ last_seen: new Date().toISOString() }).eq('id', myId).then(() => {})
  }, [myId])

  const catchUp = useCallback(async () => {
    const { data } = await supabase.from('messages').select('*').order('created_at', { ascending: false }).limit(PAGE)
    if (data) setMessages((prev) => mergeMessages(prev, data, myId))
  }, [myId])

  useEffect(() => {
    const onVis = () => {
      const v = document.visibilityState === 'visible'
      setVisible(v)
      touchLastSeen()
      if (v) {
        unread.current = 0
        document.title = 'Chit Chat'
        roomRef.current?.track({ at: Date.now() })
        catchUp()
      } else {
        roomRef.current?.untrack()
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
  }, [touchLastSeen, catchUp])

  // ---------- ticks: mark incoming messages delivered / read ----------
  useEffect(() => {
    if (!me || marking.current) return
    const now = new Date().toISOString()
    const needDelivered = messages.some((m) => m.receiver_id === myId && !m.delivered_at)
    const needRead = visible && me.read_receipts && messages.some((m) => m.receiver_id === myId && !m.read_at && !m.deleted_for_everyone)
    if (!needDelivered && !needRead) return
    marking.current = true
    ;(async () => {
      if (needDelivered)
        await supabase.from('messages').update({ delivered_at: now }).eq('receiver_id', myId).is('delivered_at', null)
      if (needRead)
        await supabase.from('messages').update({ read_at: now }).eq('receiver_id', myId).is('read_at', null)
      setMessages((prev) =>
        prev.map((m) =>
          m.receiver_id === myId
            ? { ...m, delivered_at: m.delivered_at || now, read_at: needRead ? m.read_at || now : m.read_at }
            : m
        )
      )
      marking.current = false
    })()
  }, [messages, visible, me, myId])

  // ---------- scrolling ----------
  useLayoutEffect(() => {
    const el = listRef.current
    if (!el) return
    if (prependFrom.current != null) {
      el.scrollTop += el.scrollHeight - prependFrom.current
      prependFrom.current = null
    } else if (stickNext.current) {
      el.scrollTop = el.scrollHeight
      stickNext.current = false
    }
  }, [messages, loading])

  const scrollToBottom = (smooth = true) => {
    const el = listRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
    setNewCount(0)
  }

  const loadOlder = async () => {
    if (!hasMore || !messages.length || prependFrom.current != null) return
    prependFrom.current = listRef.current.scrollHeight
    const { data } = await supabase
      .from('messages')
      .select('*')
      .lt('created_at', messages[0].created_at)
      .order('created_at', { ascending: false })
      .limit(PAGE)
    setHasMore((data || []).length === PAGE)
    if (data?.length) setMessages((prev) => mergeMessages(prev, data, myId))
    else prependFrom.current = null
  }

  const onScroll = (e) => {
    const el = e.currentTarget
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (atBottom.current && newCount) setNewCount(0)
    if (showDown === atBottom.current) setShowDown(!atBottom.current)
    if (el.scrollTop < 60) loadOlder()
  }

  const onMediaLoad = () => { if (atBottom.current) scrollToBottom(false) }

  // ---------- sending ----------
  const sendTyping = () => {
    const now = Date.now()
    if (now - lastTypingSent.current < 2000) return
    lastTypingSent.current = now
    roomRef.current?.send({ type: 'broadcast', event: 'typing', payload: { from: myId } })
  }

  async function insertMessage(row, local = {}) {
    const optimistic = { ...row, created_at: new Date().toISOString(), delivered_at: null, read_at: null, deleted_for: [], deleted_for_everyone: false, _status: 'sending', ...local }
    stickNext.current = true
    setMessages((prev) => [...prev, optimistic])
    return optimistic
  }

  function markFailed(id) {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, _status: 'failed' } : m)))
  }

  async function sendText() {
    const content = text.trim()
    if (!content || !other) return
    const row = { id: crypto.randomUUID(), sender_id: myId, receiver_id: other.id, content, reply_to: replyTo?.id || null }
    setText('')
    if (textRef.current) textRef.current.style.height = 'auto'
    setReplyTo(null)
    setShowEmoji(false)
    textRef.current?.focus()
    await insertMessage(row)
    const { data, error } = await supabase.from('messages').insert(row).select().single()
    if (error) return markFailed(row.id)
    setMessages((prev) => mergeMessages(prev, [data], myId))
  }

  function pickFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const kind = file.type.startsWith('video/') ? 'video' : file.type.startsWith('image/') ? 'image' : null
    if (!kind) return flash('Only photos and videos can be sent')
    if (kind === 'video' && file.size > MAX_VIDEO_MB * 1024 * 1024) return flash(`Video is too big (max ${MAX_VIDEO_MB} MB)`)
    setCaption(text)
    setPicked({ file, kind, url: URL.createObjectURL(file) })
  }

  async function sendMedia() {
    if (!picked || !other) return
    const { kind, url } = picked
    let file = picked.file
    setPicked(null)
    const id = crypto.randomUUID()
    const row = { id, sender_id: myId, receiver_id: other.id, content: caption.trim() || null, media_type: kind, reply_to: replyTo?.id || null }
    setCaption('')
    setText('')
    setReplyTo(null)
    await insertMessage(row, { _localUrl: url })
    if (kind === 'image') file = await compressImage(file)
    const ext = (file.name.split('.').pop() || (kind === 'video' ? 'mp4' : 'jpg')).toLowerCase().slice(0, 5)
    const path = `${myId}/${id}.${ext}`
    const up = await supabase.storage.from('media').upload(path, file, { contentType: file.type, upsert: false })
    if (up.error) { flash('Upload failed: ' + up.error.message); return markFailed(id) }
    const { data, error } = await supabase.from('messages').insert({ ...row, media_path: path }).select().single()
    if (error) return markFailed(id)
    setMessages((prev) => mergeMessages(prev, [data], myId))
  }

  async function retry(m) {
    setMessages((prev) => prev.filter((x) => x.id !== m.id))
    if (!m.media_type) {
      setText(m.content || '')
      textRef.current?.focus()
    } else flash('Please choose the file again')
  }

  // ---------- deleting ----------
  async function deleteForMe(m) {
    setConfirmDelete(null)
    setMessages((prev) => prev.filter((x) => x.id !== m.id))
    if (m._status) return // never reached the server
    const deleted_for = [...new Set([...(m.deleted_for || []), myId])]
    const { error } = await supabase.from('messages').update({ deleted_for }).eq('id', m.id)
    if (error) return flash('Could not delete')
    // both people removed it → free the storage space
    if (m.media_path && other && deleted_for.includes(other.id)) supabase.storage.from('media').remove([m.media_path])
  }

  async function deleteForEveryone(m) {
    setConfirmDelete(null)
    if (m.media_path) await supabase.storage.from('media').remove([m.media_path])
    const patch = { deleted_for_everyone: true, content: null, media_path: null, media_type: null }
    setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, ...patch, _localUrl: null } : x)))
    const { error } = await supabase.from('messages').update(patch).eq('id', m.id)
    if (error) flash('Could not delete for everyone')
  }

  // ---------- settings ----------
  async function updateMe(patch) {
    setMe((p) => ({ ...p, ...patch }))
    await supabase.from('profiles').update(patch).eq('id', myId)
  }

  // ---------- helpers ----------
  const status = (m) => {
    if (m._status) return m._status
    if (m.read_at && me?.read_receipts) return 'read'
    if (m.delivered_at) return 'delivered'
    return 'sent'
  }

  const headerStatus = () => {
    if (!other) return ''
    if (otherTyping) return 'typing…'
    if (otherOnline) return 'online'
    if (other.hide_last_seen || me?.hide_last_seen) return ''
    return lastSeenText(other.last_seen)
  }

  const findMsg = (id) => messages.find((m) => m.id === id)
  const nameOf = (id) => (id === myId ? 'You' : other?.name || '')

  const jumpTo = (id) => {
    const el = document.getElementById('m-' + id)
    if (!el) return flash('Message is further up, scroll to find it')
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('flash')
    setTimeout(() => el.classList.remove('flash'), 1200)
  }

  const openViewer = async (m) => {
    try {
      const url = m._localUrl || (await signedUrl(m.media_path))
      setViewer({ url, kind: m.media_type, name: m.media_path?.split('/').pop() || 'media' })
    } catch {
      flash('Could not open file')
    }
  }

  if (loading || !me) return <div className="center-screen"><div className="spinner" /></div>

  if (!other)
    return (
      <div className="center-screen">
        <p>Your friend's account isn't set up yet.</p>
        <button className="primary" onClick={() => supabase.auth.signOut()}>Log out</button>
      </div>
    )

  let prevDay = null
  let prevSender = null

  return (
    <div className="app">
      <header className="chat-header">
        <span className="avatar">{initials(other.name)}</span>
        <div className="who-info">
          <div className="who-name">{other.name}</div>
          <div className={'who-status' + (otherTyping ? ' typing' : '')}>{headerStatus()}</div>
        </div>
        <button className="icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Settings"><Dots /></button>
      </header>

      <main className="messages" ref={listRef} onScroll={onScroll} onClick={() => setShowEmoji(false)}>
        {hasMore && <div className="load-more">Loading older messages…</div>}
        {!messages.length && (
          <div className="empty-note">🔒 This is your private chat with {other.name}. Say hi! 👋</div>
        )}
        {messages.map((m) => {
          const k = dayKey(m.created_at)
          const showDay = k !== prevDay
          const mine = m.sender_id === myId
          const first = showDay || prevSender !== m.sender_id
          prevDay = k
          prevSender = m.sender_id
          return (
            <Fragment key={m.id}>
              {showDay && <div className="day"><span>{dayLabel(m.created_at)}</span></div>}
              <Bubble
                m={m}
                mine={mine}
                first={first}
                status={mine ? status(m) : null}
                reply={m.reply_to ? findMsg(m.reply_to) : null}
                replyName={m.reply_to ? nameOf(findMsg(m.reply_to)?.sender_id) : ''}
                onMenu={() => setMenu(m)}
                onOpen={() => openViewer(m)}
                onJump={() => jumpTo(m.reply_to)}
                onRetry={() => retry(m)}
                onMediaLoad={onMediaLoad}
              />
            </Fragment>
          )
        })}
      </main>

      {newCount > 0 || showDown ? (
        <button className="to-bottom" onClick={() => scrollToBottom()} aria-label="Scroll to latest">
          {newCount > 0 && <span className="badge">{newCount}</span>}
          <Down />
        </button>
      ) : null}

      {showEmoji && (
        <div className="emoji-panel">
          {EMOJIS.map((e) => (
            <button key={e} onClick={() => { setText((t) => t + e); textRef.current?.focus() }}>{e}</button>
          ))}
        </div>
      )}

      <footer className="composer">
        {replyTo && (
          <div className="reply-bar">
            <div className="quote">
              <b>{nameOf(replyTo.sender_id)}</b>
              <span>{replyTo.media_type ? (replyTo.media_type === 'image' ? '📷 Photo' : '🎥 Video') : ''} {replyTo.content}</span>
            </div>
            <button className="icon-btn dark" onClick={() => setReplyTo(null)} aria-label="Cancel reply"><Close /></button>
          </div>
        )}
        <div className="composer-row">
          <div className="input-box">
            <button className="icon-btn dark" onClick={() => setShowEmoji((s) => !s)} aria-label="Emoji"><Smile /></button>
            <textarea
              ref={textRef}
              rows={1}
              placeholder="Message"
              value={text}
              onChange={(e) => { setText(e.target.value); sendTyping(); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 130) + 'px' }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); sendText() }
              }}
            />
            <button className="icon-btn dark" onClick={() => fileInput.current?.click()} aria-label="Attach photo or video"><Clip /></button>
            <input ref={fileInput} type="file" accept="image/*,video/*" hidden onChange={pickFile} />
          </div>
          <button className="send-btn" onClick={sendText} disabled={!text.trim()} aria-label="Send"><Send /></button>
        </div>
      </footer>

      {/* message options */}
      {menu && (
        <div className="overlay" onClick={() => setMenu(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            {!menu.deleted_for_everyone && !menu._status && (
              <button onClick={() => { setReplyTo(menu); setMenu(null); textRef.current?.focus() }}>↩️ Reply</button>
            )}
            {menu.content && !menu.deleted_for_everyone && (
              <button onClick={() => { navigator.clipboard?.writeText(menu.content); setMenu(null); flash('Copied') }}>📋 Copy</button>
            )}
            {menu.media_path && !menu.deleted_for_everyone && (
              <button onClick={() => { openViewer(menu); setMenu(null) }}>🔍 Open</button>
            )}
            <button className="danger" onClick={() => { setConfirmDelete(menu); setMenu(null) }}>🗑️ Delete</button>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="overlay" onClick={() => setConfirmDelete(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <p>Delete message?</p>
            <div className="dialog-actions">
              {confirmDelete.sender_id === myId && !confirmDelete.deleted_for_everyone && !confirmDelete._status && (
                <button onClick={() => deleteForEveryone(confirmDelete)}>Delete for everyone</button>
              )}
              <button onClick={() => deleteForMe(confirmDelete)}>Delete for me</button>
              <button onClick={() => setConfirmDelete(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* photo / video preview before sending */}
      {picked && (
        <div className="preview">
          <div className="preview-top">
            <button className="icon-btn" onClick={() => { URL.revokeObjectURL(picked.url); setPicked(null) }} aria-label="Cancel"><Close /></button>
          </div>
          <div className="preview-media">
            {picked.kind === 'image' ? <img src={picked.url} alt="" /> : <video src={picked.url} controls playsInline />}
          </div>
          <div className="preview-bottom">
            <input placeholder="Add a caption…" value={caption} onChange={(e) => setCaption(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && sendMedia()} autoFocus />
            <button className="send-btn" onClick={sendMedia} aria-label="Send"><Send /></button>
          </div>
        </div>
      )}

      {/* full screen viewer */}
      {viewer && (
        <div className="preview" onClick={() => setViewer(null)}>
          <div className="preview-top" onClick={(e) => e.stopPropagation()}>
            <button className="icon-btn" onClick={() => setViewer(null)} aria-label="Close"><Back /></button>
            <a className="icon-btn" href={viewer.url} download={viewer.name} target="_blank" rel="noreferrer" aria-label="Download"><Download /></a>
          </div>
          <div className="preview-media" onClick={(e) => e.stopPropagation()}>
            {viewer.kind === 'image' ? <img src={viewer.url} alt="" /> : <video src={viewer.url} controls autoPlay playsInline />}
          </div>
        </div>
      )}

      {settingsOpen && <Settings me={me} onClose={() => setSettingsOpen(false)} onChange={updateMe} flash={flash} />}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------

function Bubble({ m, mine, first, status, reply, replyName, onMenu, onOpen, onJump, onRetry, onMediaLoad }) {
  const press = useRef(null)
  const startPress = () => { press.current = setTimeout(() => { press.current = 'fired'; navigator.vibrate?.(20); onMenu() }, 450) }
  const endPress = () => { if (press.current !== 'fired') clearTimeout(press.current); }

  const handlers = {
    onContextMenu: (e) => { e.preventDefault(); onMenu() },
    onTouchStart: startPress,
    onTouchEnd: endPress,
    onTouchMove: endPress,
    onClickCapture: (e) => { if (press.current === 'fired') { e.stopPropagation(); press.current = null } },
  }

  const meta = (
    <span className="meta">
      {timeOf(m.created_at)}
      {mine && !m.deleted_for_everyone && <Ticks status={status} />}
    </span>
  )

  if (m.deleted_for_everyone) {
    return (
      <div id={'m-' + m.id} className={`row ${mine ? 'mine' : 'theirs'}${first ? ' first' : ''}`}>
        <div className="bubble deleted" {...handlers}>
          <Ban /> <i>{mine ? 'You deleted this message' : 'This message was deleted'}</i>
          {meta}
        </div>
      </div>
    )
  }

  return (
    <div id={'m-' + m.id} className={`row ${mine ? 'mine' : 'theirs'}${first ? ' first' : ''}`}>
      <div className={'bubble' + (m.media_type ? ' has-media' : '')} {...handlers}>
        <button className="bubble-menu" onClick={(e) => { e.stopPropagation(); onMenu() }} aria-label="Message options"><Down /></button>
        {m.reply_to && (
          <div className="quote in-bubble" onClick={onJump}>
            <b>{reply ? replyName : ''}</b>
            <span>
              {!reply ? 'Message' : reply.deleted_for_everyone ? 'This message was deleted' : `${reply.media_type === 'image' ? '📷 Photo ' : reply.media_type === 'video' ? '🎥 Video ' : ''}${reply.content || ''}`}
            </span>
          </div>
        )}
        {m.media_type && <Media m={m} onOpen={onOpen} onLoad={onMediaLoad} />}
        {m.content && <span className="text"><Linkify text={m.content} /></span>}
        {meta}
        {status === 'failed' && (
          <button className="retry" onClick={onRetry}>Not sent. Tap to retry</button>
        )}
      </div>
    </div>
  )
}

function Media({ m, onOpen, onLoad }) {
  const [url, setUrl] = useState(m._localUrl || null)
  const [err, setErr] = useState(false)
  useEffect(() => {
    if (m._localUrl) return setUrl(m._localUrl)
    if (!m.media_path) return
    let alive = true
    signedUrl(m.media_path).then((u) => alive && setUrl(u)).catch(() => alive && setErr(true))
    return () => { alive = false }
  }, [m.media_path, m._localUrl])

  const uploading = m._status === 'sending'
  return (
    <div className="media" onClick={() => !uploading && url && onOpen()}>
      {err ? (
        <div className="media-missing">Media not available</div>
      ) : !url ? (
        <div className="media-loading"><div className="spinner small" /></div>
      ) : m.media_type === 'image' ? (
        <img src={url} alt="" onLoad={onLoad} />
      ) : (
        <>
          <video src={url + (m._localUrl ? '' : '#t=0.1')} preload="metadata" muted playsInline onLoadedData={onLoad} />
          {!uploading && <span className="play"><Play /></span>}
        </>
      )}
      {uploading && <div className="media-uploading"><div className="spinner" /></div>}
    </div>
  )
}

function Linkify({ text }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g)
  return parts.map((p, i) =>
    /^https?:\/\//.test(p) ? <a key={i} href={p} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{p}</a> : <Fragment key={i}>{p}</Fragment>
  )
}

function Settings({ me, onClose, onChange, flash }) {
  const [pin, setPin] = useState('')
  const [saving, setSaving] = useState(false)

  async function changePin() {
    if (pin.length < 6) return flash('Password must be at least 6 characters')
    setSaving(true)
    const { error } = await supabase.auth.updateUser({ password: pin })
    setSaving(false)
    if (error) return flash(error.message)
    setPin('')
    flash('Password changed ✔')
  }

  return (
    <div className="overlay" onClick={onClose}>
      <aside className="settings" onClick={(e) => e.stopPropagation()}>
        <header className="chat-header">
          <button className="icon-btn" onClick={onClose} aria-label="Back"><Back /></button>
          <div className="who-name">Settings</div>
        </header>
        <div className="settings-me">
          <span className="avatar big">{initials(me.name)}</span>
          <div><b>{me.name}</b><small>Logged in</small></div>
        </div>

        <h3>Privacy</h3>
        <label className="setting">
          <div>
            <b>Hide last seen</b>
            <small>If you hide yours, you won't see theirs either.</small>
          </div>
          <input type="checkbox" className="switch" checked={me.hide_last_seen} onChange={(e) => onChange({ hide_last_seen: e.target.checked })} />
        </label>
        <label className="setting">
          <div>
            <b>Read receipts (blue ticks)</b>
            <small>If turned off, you won't send or see blue ticks.</small>
          </div>
          <input type="checkbox" className="switch" checked={me.read_receipts} onChange={(e) => onChange({ read_receipts: e.target.checked })} />
        </label>

        <h3>Security</h3>
        <div className="setting">
          <input className="pin-field" type="password" autoCapitalize="none" placeholder="New password (min 6)" value={pin} onChange={(e) => setPin(e.target.value)} />
          <button className="primary small" onClick={changePin} disabled={saving}>Change password</button>
        </div>

        <button className="logout" onClick={() => supabase.auth.signOut()}>Log out</button>
      </aside>
    </div>
  )
}
