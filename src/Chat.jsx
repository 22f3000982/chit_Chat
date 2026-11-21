import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { MAX_VIDEO_MB } from './config'
import { compressImage, dayKey, dayLabel, EMOJIS, initials, lastSeenText, signedUrl } from './utils'
import { Back, Check, Clip, Close, Dots, Down, Download, Send, Smile } from './icons'
import Bubble, { previewOf } from './Bubble'

const QUICK = ['👍', '❤️', '😂', '😮', '😢', '🙏']

// One conversation. Shared data (messages, presence, prefs) lives in Home.
export default function Chat({
  me, friend, messages, setMessages, hasMore, loadOlder, online, typing, sendTyping,
  visible, pref, updatePref, onBack, onChatMenu, flash, mergeMessages,
}) {
  const myId = me.id
  const fid = friend.id
  const [text, setText] = useState('')
  const [replyTo, setReplyTo] = useState(null)
  const [showEmoji, setShowEmoji] = useState(false)
  const [menu, setMenu] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [picked, setPicked] = useState(null)
  const [caption, setCaption] = useState('')
  const [viewer, setViewer] = useState(null)
  const [newCount, setNewCount] = useState(0)
  const [showDown, setShowDown] = useState(false)
  const [editing, setEditing] = useState(null) // message being edited
  const [reactInfo, setReactInfo] = useState(null) // message whose reactions are shown
  const [moreEmoji, setMoreEmoji] = useState(false)
  const [dragging, setDragging] = useState(false)

  const listRef = useRef(null)
  const atBottom = useRef(true)
  const prependFrom = useRef(null)
  const lastId = useRef(null)
  const marking = useRef(false)
  const fileInput = useRef(null)
  const textRef = useRef(null)

  // ---------- read receipts + unread counter ----------
  useEffect(() => {
    if (!visible || marking.current) return
    const incoming = messages.filter((m) => m.sender_id === fid)
    const newest = incoming[incoming.length - 1]
    if (newest && (!pref?.last_read_at || new Date(newest.created_at) > new Date(pref.last_read_at)))
      updatePref(fid, { last_read_at: new Date().toISOString() })
    if (!me.read_receipts || !incoming.some((m) => !m.read_at && !m.deleted_for_everyone)) return
    marking.current = true
    const now = new Date().toISOString()
    supabase.from('messages').update({ read_at: now }).eq('receiver_id', myId).eq('sender_id', fid).is('read_at', null)
      .then(() => {
        setMessages((prev) => prev.map((m) => (m.sender_id === fid && m.receiver_id === myId && !m.read_at ? { ...m, read_at: now, delivered_at: m.delivered_at || now } : m)))
        marking.current = false
      })
  }, [messages, visible, me.read_receipts, fid, myId, pref?.last_read_at])

  // ---------- scrolling ----------
  useLayoutEffect(() => {
    const el = listRef.current
    if (!el) return
    if (prependFrom.current != null) {
      el.scrollTop += el.scrollHeight - prependFrom.current
      prependFrom.current = null
      return
    }
    const last = messages[messages.length - 1]
    if (!last || last.id === lastId.current) return
    const first = lastId.current === null
    lastId.current = last.id
    if (first || last.sender_id === myId || atBottom.current) el.scrollTop = el.scrollHeight
    else setNewCount((n) => n + 1)
  }, [messages, myId])

  const scrollToBottom = (smooth = true) => {
    const el = listRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
    setNewCount(0)
  }

  const onScroll = async (e) => {
    const el = e.currentTarget
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (atBottom.current && newCount) setNewCount(0)
    if (showDown === atBottom.current) setShowDown(!atBottom.current)
    if (el.scrollTop < 60 && hasMore && messages.length && prependFrom.current == null) {
      prependFrom.current = el.scrollHeight
      const got = await loadOlder(fid, messages[0].created_at)
      if (!got) prependFrom.current = null
    }
  }

  const onMediaLoad = () => { if (atBottom.current) scrollToBottom(false) }

  // ---------- sending ----------
  function addOptimistic(row, local = {}) {
    atBottom.current = true
    setMessages((prev) => [...prev, { ...row, created_at: new Date().toISOString(), delivered_at: null, read_at: null, deleted_for: [], deleted_for_everyone: false, _status: 'sending', ...local }])
  }
  const markFailed = (id) => setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, _status: 'failed' } : m)))

  async function sendText() {
    if (editing) return saveEdit()
    const content = text.trim()
    if (!content) return
    const row = { id: crypto.randomUUID(), sender_id: myId, receiver_id: fid, content, reply_to: replyTo?.id || null }
    setText('')
    if (textRef.current) textRef.current.style.height = 'auto'
    setReplyTo(null)
    setShowEmoji(false)
    textRef.current?.focus()
    addOptimistic(row)
    const { data, error } = await supabase.from('messages').insert(row).select().single()
    if (error) return markFailed(row.id)
    setMessages((prev) => mergeMessages(prev, [data]))
  }

  // ---------- edit ----------
  const EDIT_MINUTES = 15
  const canEdit = (m) =>
    m.sender_id === myId && !m.deleted_for_everyone && !m._status && Date.now() - new Date(m.created_at) < EDIT_MINUTES * 60000

  function startEdit(m) {
    setReplyTo(null)
    setEditing(m)
    setText(m.content || '')
    setTimeout(() => {
      const el = textRef.current
      if (!el) return
      el.focus()
      el.style.height = 'auto'
      el.style.height = Math.min(el.scrollHeight, 130) + 'px'
      el.setSelectionRange(el.value.length, el.value.length)
    }, 30)
  }

  function cancelEdit() {
    setEditing(null)
    setText('')
    if (textRef.current) textRef.current.style.height = 'auto'
  }

  async function saveEdit() {
    const m = editing
    const content = text.trim()
    if (!content && !m.media_type) return flash('Message cannot be empty. Use Delete instead.')
    cancelEdit()
    if ((content || null) === (m.content || null)) return
    if (!canEdit(m)) return flash(`Messages can only be edited for ${EDIT_MINUTES} minutes`)
    const now = new Date().toISOString()
    setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, content: content || null, edited_at: now } : x)))
    const { data, error } = await supabase.from('messages').update({ content: content || null, edited_at: now }).eq('id', m.id).select().single()
    if (error) {
      setMessages((prev) => prev.map((x) => (x.id === m.id ? m : x)))
      return flash(error.message.includes('15 minutes') ? 'Too late to edit (15 min limit)' : 'Could not edit: ' + error.message)
    }
    setMessages((prev) => mergeMessages(prev, [data]))
  }

  // ---------- reactions ----------
  async function react(m, emoji) {
    setMenu(null)
    setMoreEmoji(false)
    setReactInfo(null)
    const current = (m.reactions || {})[myId]
    const next = current === emoji ? null : emoji // same emoji again removes it
    const reactions = { ...(m.reactions || {}) }
    if (next) reactions[myId] = next
    else delete reactions[myId]
    setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, reactions } : x)))
    const { error } = await supabase.rpc('react', { msg_id: m.id, emoji: next })
    if (error) {
      setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, reactions: m.reactions } : x)))
      flash(error.message.includes('function') ? 'Run update_2_react_edit.sql in Supabase first' : 'Could not react')
    }
  }

  // ---------- photos / videos: pick, paste or drop ----------
  function pickFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    handleFile(file)
  }

  function onPaste(e) {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.kind === 'file' && /^(image|video)\//.test(i.type))
    const file = item?.getAsFile()
    if (!file) return
    e.preventDefault()
    handleFile(file)
  }

  function onDrop(e) {
    e.preventDefault()
    setDragging(false)
    handleFile(e.dataTransfer?.files?.[0])
  }

  function handleFile(file) {
    if (!file) return
    if (editing) cancelEdit()
    const kind = file.type.startsWith('video/') ? 'video' : file.type.startsWith('image/') ? 'image' : null
    if (!kind) return flash('Only photos and videos can be sent')
    if (kind === 'video' && file.size > MAX_VIDEO_MB * 1024 * 1024) return flash(`Video is too big (max ${MAX_VIDEO_MB} MB)`)
    setCaption(text)
    setPicked({ file, kind, url: URL.createObjectURL(file) })
  }

  async function sendMedia() {
    if (!picked) return
    const { kind, url } = picked
    let file = picked.file
    setPicked(null)
    const id = crypto.randomUUID()
    const row = { id, sender_id: myId, receiver_id: fid, content: caption.trim() || null, media_type: kind, reply_to: replyTo?.id || null }
    setCaption('')
    setText('')
    setReplyTo(null)
    addOptimistic(row, { _localUrl: url })
    if (kind === 'image') file = await compressImage(file)
    const ext = (file.name.split('.').pop() || (kind === 'video' ? 'mp4' : 'jpg')).toLowerCase().slice(0, 5)
    const path = `${myId}/${id}.${ext}`
    const up = await supabase.storage.from('media').upload(path, file, { contentType: file.type, upsert: false })
    if (up.error) { flash('Upload failed: ' + up.error.message); return markFailed(id) }
    const { data, error } = await supabase.from('messages').insert({ ...row, media_path: path }).select().single()
    if (error) return markFailed(id)
    setMessages((prev) => mergeMessages(prev, [data]))
  }

  function retry(m) {
    setMessages((prev) => prev.filter((x) => x.id !== m.id))
    if (!m.media_type) { setText(m.content || ''); textRef.current?.focus() } else flash('Please choose the file again')
  }

  // ---------- deleting ----------
  async function deleteForMe(m) {
    setConfirmDelete(null)
    setMessages((prev) => prev.filter((x) => x.id !== m.id))
    if (m._status) return
    const deleted_for = [...new Set([...(m.deleted_for || []), myId])]
    const { error } = await supabase.from('messages').update({ deleted_for }).eq('id', m.id)
    if (error) return flash('Could not delete')
    if (m.media_path && deleted_for.includes(fid)) supabase.storage.from('media').remove([m.media_path])
  }

  async function deleteForEveryone(m) {
    setConfirmDelete(null)
    if (m.media_path) await supabase.storage.from('media').remove([m.media_path])
    const patch = { deleted_for_everyone: true, content: null, media_path: null, media_type: null }
    setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, ...patch, _localUrl: null } : x)))
    const { error } = await supabase.from('messages').update(patch).eq('id', m.id)
    if (error) flash('Could not delete for everyone')
  }

  // ---------- helpers ----------
  const status = (m) => {
    if (m._status) return m._status
    if (m.read_at && me.read_receipts) return 'read'
    if (m.delivered_at) return 'delivered'
    return 'sent'
  }
  const headerStatus = typing ? 'typing…' : online ? 'online' : friend.hide_last_seen || me.hide_last_seen ? '' : lastSeenText(friend.last_seen)
  const findMsg = (id) => messages.find((m) => m.id === id)
  const nameOf = (id) => (id === myId ? 'You' : friend.name)

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

  let prevDay = null
  let prevSender = null

  return (
    <div
      className="chat"
      onDragOver={(e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); setDragging(true) } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false) }}
      onDrop={onDrop}
    >
      {dragging && <div className="drop-hint">Drop photo or video to send</div>}
      <header className="chat-header">
        <button className="icon-btn back-btn" onClick={onBack} aria-label="Back to chats"><Back /></button>
        <span className="avatar">{initials(friend.name)}</span>
        <div className="who-info">
          <div className="who-name">{friend.name} {pref?.locked && <span title="Locked chat">🔒</span>}</div>
          <div className={'who-status' + (typing ? ' typing' : '')}>{headerStatus}</div>
        </div>
        <button className="icon-btn" onClick={onChatMenu} aria-label="Chat options"><Dots /></button>
      </header>

      <main className="messages" ref={listRef} onScroll={onScroll} onClick={() => setShowEmoji(false)}>
        {hasMore && <div className="load-more">Scroll up for older messages</div>}
        <div className="empty-note">🔒 Only you and {friend.name} can read this chat.</div>
        {messages.map((m) => {
          const k = dayKey(m.created_at)
          const showDay = k !== prevDay
          const mine = m.sender_id === myId
          const first = showDay || prevSender !== m.sender_id
          prevDay = k
          prevSender = m.sender_id
          const reply = m.reply_to ? findMsg(m.reply_to) : null
          return (
            <Fragment key={m.id}>
              {showDay && <div className="day"><span>{dayLabel(m.created_at)}</span></div>}
              <Bubble
                m={m}
                mine={mine}
                first={first}
                status={mine ? status(m) : null}
                reply={reply}
                replyName={reply ? nameOf(reply.sender_id) : ''}
                onMenu={() => setMenu(m)}
                onReply={() => { if (editing) cancelEdit(); setReplyTo(m); textRef.current?.focus() }}
                onReactions={() => setReactInfo(m)}
                onOpen={() => openViewer(m)}
                onJump={() => jumpTo(m.reply_to)}
                onRetry={() => retry(m)}
                onMediaLoad={onMediaLoad}
              />
            </Fragment>
          )
        })}
      </main>

      {(newCount > 0 || showDown) && (
        <button className="to-bottom" onClick={() => scrollToBottom()} aria-label="Scroll to latest">
          {newCount > 0 && <span className="badge">{newCount}</span>}
          <Down />
        </button>
      )}

      {showEmoji && (
        <div className="emoji-panel">
          {EMOJIS.map((e) => (
            <button key={e} onClick={() => { setText((t) => t + e); textRef.current?.focus() }}>{e}</button>
          ))}
        </div>
      )}

      <footer className="composer">
        {editing && (
          <div className="reply-bar">
            <div className="quote edit">
              <b>✏️ Edit message</b>
              <span>{previewOf(editing)}</span>
            </div>
            <button className="icon-btn dark" onClick={cancelEdit} aria-label="Cancel edit"><Close /></button>
          </div>
        )}
        {replyTo && (
          <div className="reply-bar">
            <div className="quote">
              <b>{nameOf(replyTo.sender_id)}</b>
              <span>{previewOf(replyTo)}</span>
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
              onChange={(e) => {
                setText(e.target.value)
                sendTyping(fid)
                e.target.style.height = 'auto'
                e.target.style.height = Math.min(e.target.scrollHeight, 130) + 'px'
              }}
              onPaste={onPaste}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && editing) return cancelEdit()
                if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); sendText() }
              }}
            />
            {!editing && <button className="icon-btn dark" onClick={() => fileInput.current?.click()} aria-label="Attach photo or video"><Clip /></button>}
            <input ref={fileInput} type="file" accept="image/*,video/*" hidden onChange={pickFile} />
          </div>
          <button className="send-btn" onClick={sendText} disabled={!text.trim() && !editing?.media_type} aria-label={editing ? 'Save edit' : 'Send'}>{editing ? <Check /> : <Send />}</button>
        </div>
      </footer>

      {menu && (
        <div className="overlay" onClick={() => setMenu(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            {!menu.deleted_for_everyone && !menu._status && (
              <>
                <div className="react-bar">
                  {QUICK.map((e) => (
                    <button key={e} className={(menu.reactions || {})[myId] === e ? 'mine' : ''} onClick={() => react(menu, e)}>{e}</button>
                  ))}
                  <button className="more" onClick={() => setMoreEmoji((v) => !v)} aria-label="More emoji">＋</button>
                </div>
                {moreEmoji && (
                  <div className="emoji-panel in-sheet">
                    {EMOJIS.map((e) => <button key={e} onClick={() => react(menu, e)}>{e}</button>)}
                  </div>
                )}
                <button onClick={() => { if (editing) cancelEdit(); setReplyTo(menu); setMenu(null); textRef.current?.focus() }}>↩️ Reply</button>
              </>
            )}
            {canEdit(menu) && (
              <button onClick={() => { const m = menu; setMenu(null); startEdit(m) }}>✏️ Edit</button>
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

      {reactInfo && (() => {
        const live = messages.find((x) => x.id === reactInfo.id) || reactInfo
        const entries = Object.entries(live.reactions || {})
        return (
          <div className="overlay" onClick={() => setReactInfo(null)}>
            <div className="sheet" onClick={(e) => e.stopPropagation()}>
              <div className="sheet-title">{entries.length} reaction{entries.length === 1 ? '' : 's'}</div>
              {entries.map(([uid, emoji]) => (
                <button key={uid} className="react-who" onClick={() => (uid === myId ? react(live, emoji) : setReactInfo(null))}>
                  <span className="avatar small">{initials(uid === myId ? me.name : friend.name)}</span>
                  <span className="react-name">
                    {uid === myId ? 'You' : friend.name}
                    {uid === myId && <small>Tap to remove</small>}
                  </span>
                  <span className="react-emoji">{emoji}</span>
                </button>
              ))}
            </div>
          </div>
        )
      })()}

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
    </div>
  )
}
