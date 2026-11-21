import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase'
import { MAX_VIDEO_MB } from './config'
import { compressImage, dayKey, dayLabel, EMOJIS, initials, lastSeenText, signedUrl, timeOf } from './utils'
import { Back, Check, Clip, Close, Dots, Down, Download, Send, Smile } from './icons'
import Bubble, { previewOf } from './Bubble'
import { useDictation, useRecorder, fmtDur } from './Voice'
import { StickerPicker, photoToSticker } from './Stickers'
import { useLocal, wallpaperStyle } from './local'
import { WallpaperPicker } from './Settings'

const QUICK = ['👍', '❤️', '😂', '😮', '😢', '🙏']
const EDIT_MINUTES = 15
const DISAPPEAR = [
  [0, 'Off'],
  [86400, '24 hours'],
  [604800, '7 days'],
  [7776000, '90 days'],
]
const disappearLabel = (s) => (DISAPPEAR.find(([v]) => v === s) || [0, `${Math.round(s / 3600)} hours`])[1]

const Mic = () => (
  <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1a7 7 0 0 0 6-6.9h-2z" /></svg>
)
const SearchIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>
)

// One conversation. Shared data (messages, presence, prefs) lives in Home.
export default function Chat({
  me, friend, messages, setMessages, hasMore, loadOlder, online, typing, sendTyping,
  visible, pref, updatePref, onBack, chatActions, flash, mergeMessages,
}) {
  const myId = me.id
  const fid = friend.id
  const pair = `and(sender_id.eq.${myId},receiver_id.eq.${fid}),and(sender_id.eq.${fid},receiver_id.eq.${myId})`

  const [text, setText] = useState('')
  const [replyTo, setReplyTo] = useState(null)
  const [showEmoji, setShowEmoji] = useState(false)
  const [emojiTab, setEmojiTab] = useState('emoji')
  const [menu, setMenu] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [picked, setPicked] = useState(null)
  const [caption, setCaption] = useState('')
  const [viewer, setViewer] = useState(null)
  const [newCount, setNewCount] = useState(0)
  const [showDown, setShowDown] = useState(false)
  const [editing, setEditing] = useState(null)
  const [reactInfo, setReactInfo] = useState(null)
  const [moreEmoji, setMoreEmoji] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [headerMenu, setHeaderMenu] = useState(false)
  const [panel, setPanel] = useState(null) // 'media' | 'starred'
  const [panelItems, setPanelItems] = useState(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQ, setSearchQ] = useState('')
  const [searchRes, setSearchRes] = useState(null)
  const [hit, setHit] = useState(null)
  const [disappearOpen, setDisappearOpen] = useState(false)
  const [wallOpen, setWallOpen] = useState(false)
  const [starred, setStarred] = useState(new Set())
  const [pinnedFetched, setPinnedFetched] = useState([])
  const [pinIdx, setPinIdx] = useState(0)
  const [sysFetched, setSysFetched] = useState(null)

  const [wall] = useLocal('wallpaper', { type: 'default' })
  const [speechLang] = useLocal('speechLang', 'hi-IN')

  const listRef = useRef(null)
  const atBottom = useRef(true)
  const prependFrom = useRef(null)
  const lastId = useRef(null)
  const marking = useRef(false)
  const fileInput = useRef(null)
  const textRef = useRef(null)
  const pendingJump = useRef(null)

  const recorder = useRecorder()
  const dictation = useDictation(speechLang, (t) => {
    setText((prev) => (prev && !prev.endsWith(' ') ? prev + ' ' : prev) + t)
    sendTyping(fid)
  })

  // ---------- per-chat extras: stars, pinned, disappearing setting ----------
  useEffect(() => {
    supabase.from('starred').select('message_id').then(({ data }) => data && setStarred(new Set(data.map((r) => r.message_id))))
    supabase.from('messages').select('*').or(pair).not('pinned_at', 'is', null).order('pinned_at', { ascending: false }).limit(10)
      .then(({ data }) => data && setPinnedFetched(data))
    supabase.from('messages').select('*').or(pair).eq('media_type', 'system').order('created_at', { ascending: false }).limit(1)
      .then(({ data }) => data?.[0] && setSysFetched(data[0]))
  }, [fid])

  const disappearSecs = useMemo(() => {
    const sys = [sysFetched, ...messages.filter((m) => m.media_type === 'system')].filter(Boolean)
    sys.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    return sys[0]?.meta?.disappear || 0
  }, [messages, sysFetched])

  const pinned = useMemo(() => {
    const map = new Map(pinnedFetched.map((m) => [m.id, m]))
    for (const m of messages) if (map.has(m.id) || m.pinned_at) map.set(m.id, m)
    return [...map.values()].filter((m) => m.pinned_at && !m.deleted_for_everyone && !(m.deleted_for || []).includes(myId))
      .sort((a, b) => new Date(b.pinned_at) - new Date(a.pinned_at))
  }, [pinnedFetched, messages, myId])
  const pinShown = pinned.length ? pinned[pinIdx % pinned.length] : null

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
    if (pendingJump.current) {
      const id = pendingJump.current
      if (document.getElementById('m-' + id)) { pendingJump.current = null; jumpTo(id) }
    }
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

  function jumpTo(id) {
    const el = document.getElementById('m-' + id)
    if (!el) return false
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setHit(id)
    setTimeout(() => setHit((h) => (h === id ? null : h)), 1600)
    return true
  }

  // jump to any message, loading the older ones in between if needed
  async function goTo(m) {
    if (!m) return
    if (jumpTo(m.id)) return
    const oldest = messages[0]?.created_at || new Date().toISOString()
    const { data, error } = await supabase.from('messages').select('*').or(pair).gte('created_at', m.created_at).lt('created_at', oldest).order('created_at').limit(2000)
    if (error || !data?.length) return flash('Could not find that message')
    pendingJump.current = m.id
    prependFrom.current = null
    setMessages((prev) => mergeMessages(prev, data))
  }

  // ---------- sending ----------
  const expiry = () => (disappearSecs ? new Date(Date.now() + disappearSecs * 1000).toISOString() : null)

  function addOptimistic(row, local = {}) {
    atBottom.current = true
    setMessages((prev) => [...prev, { reactions: {}, meta: {}, ...row, created_at: new Date().toISOString(), delivered_at: null, read_at: null, deleted_for: [], deleted_for_everyone: false, _status: 'sending', ...local }])
  }
  const markFailed = (id) => setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, _status: 'failed' } : m)))

  async function insertRow(row) {
    const { data, error } = await supabase.from('messages').insert(row).select().single()
    if (error) {
      if (/column|schema cache/.test(error.message)) flash('Run update_3_more_features.sql in Supabase first')
      return markFailed(row.id)
    }
    setMessages((prev) => mergeMessages(prev, [data]))
  }

  async function sendText() {
    if (editing) return saveEdit()
    const content = text.trim()
    if (!content) return
    if (dictation.listening) dictation.stop()
    const row = { id: crypto.randomUUID(), sender_id: myId, receiver_id: fid, content, reply_to: replyTo?.id || null }
    const exp = expiry()
    if (exp) row.expires_at = exp
    setText('')
    if (textRef.current) textRef.current.style.height = 'auto'
    setReplyTo(null)
    setShowEmoji(false)
    textRef.current?.focus()
    addOptimistic(row)
    await insertRow(row)
  }

  async function uploadAndSend(file, row, local) {
    addOptimistic(row, local)
    const ext = (file.name?.split('.').pop() || file.type.split('/')[1] || 'bin').replace(/;.*/, '').toLowerCase().slice(0, 5)
    const path = `${myId}/${row.id}.${ext}`
    const up = await supabase.storage.from('media').upload(path, file, { contentType: file.type, upsert: false })
    if (up.error) { flash('Upload failed: ' + up.error.message); return markFailed(row.id) }
    await insertRow({ ...row, media_path: path })
  }

  function baseRow(extra) {
    const row = { id: crypto.randomUUID(), sender_id: myId, receiver_id: fid, reply_to: replyTo?.id || null, ...extra }
    const exp = expiry()
    if (exp) row.expires_at = exp
    setReplyTo(null)
    return row
  }

  // ---------- voice notes ----------
  async function startRecording() {
    if (!recorder.supported) return flash('Voice recording is not supported in this browser')
    try {
      await recorder.start()
      navigator.vibrate?.(20)
    } catch {
      flash('Allow microphone access to record voice messages')
    }
  }

  async function sendRecording() {
    const res = await recorder.stop()
    if (!res || res.duration < 0.8) return flash('Hold on, that was too short')
    const ext = res.type.includes('mp4') ? 'm4a' : res.type.includes('ogg') ? 'ogg' : 'webm'
    const file = new File([res.blob], `voice.${ext}`, { type: res.type.split(';')[0] })
    const row = baseRow({ media_type: 'audio', meta: { duration: Math.round(res.duration * 10) / 10 } })
    await uploadAndSend(file, row, { _localUrl: URL.createObjectURL(res.blob) })
  }

  // ---------- stickers ----------
  async function sendSticker(id) {
    setShowEmoji(false)
    const row = baseRow({ media_type: 'sticker', meta: { sticker: id } })
    addOptimistic(row)
    await insertRow(row)
  }

  async function sendPhotoSticker(f) {
    setShowEmoji(false)
    try {
      const file = await photoToSticker(f)
      const row = baseRow({ media_type: 'sticker', meta: {} })
      await uploadAndSend(file, row, { _localUrl: URL.createObjectURL(file) })
    } catch {
      flash('Could not make a sticker from that photo')
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
    setPicked({ file, kind, url: URL.createObjectURL(file), viewOnce: false })
  }

  async function sendMedia() {
    if (!picked) return
    const { kind, url, viewOnce } = picked
    let file = picked.file
    setPicked(null)
    const row = baseRow({ content: viewOnce ? null : caption.trim() || null, media_type: kind, view_once: viewOnce })
    setCaption('')
    setText('')
    if (kind === 'image') file = await compressImage(file)
    await uploadAndSend(file, row, { _localUrl: url })
  }

  function retry(m) {
    setMessages((prev) => prev.filter((x) => x.id !== m.id))
    if (!m.media_type) { setText(m.content || ''); textRef.current?.focus() } else flash('Please send it again')
  }

  // ---------- view once ----------
  async function openViewOnce(m) {
    try {
      const url = await signedUrl(m.media_path)
      setViewer({ url, kind: m.media_type, viewOnce: m })
    } catch {
      flash('Could not open')
    }
  }

  async function closeViewer() {
    const v = viewer
    setViewer(null)
    if (!v?.viewOnce) return
    const m = v.viewOnce
    const now = new Date().toISOString()
    setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, viewed_at: now, media_path: null } : x)))
    await supabase.from('messages').update({ viewed_at: now, media_path: null }).eq('id', m.id)
    supabase.storage.from('media').remove([m.media_path])
  }

  // ---------- edit ----------
  const canEdit = (m) =>
    m.sender_id === myId && !m.deleted_for_everyone && !m._status && !m.view_once &&
    ['image', 'video', undefined, null].includes(m.media_type) && Date.now() - new Date(m.created_at) < EDIT_MINUTES * 60000

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
    const next = current === emoji ? null : emoji
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

  // ---------- star & pin ----------
  async function toggleStar(m) {
    setMenu(null)
    const on = !starred.has(m.id)
    setStarred((s) => { const n = new Set(s); on ? n.add(m.id) : n.delete(m.id); return n })
    const { error } = on
      ? await supabase.from('starred').insert({ user_id: myId, message_id: m.id })
      : await supabase.from('starred').delete().eq('user_id', myId).eq('message_id', m.id)
    if (error) {
      setStarred((s) => { const n = new Set(s); on ? n.delete(m.id) : n.add(m.id); return n })
      return flash('Run update_3_more_features.sql in Supabase first')
    }
    flash(on ? '⭐ Starred' : 'Unstarred')
  }

  async function togglePin(m) {
    setMenu(null)
    const pinned_at = m.pinned_at ? null : new Date().toISOString()
    setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, pinned_at } : x)))
    setPinnedFetched((list) => (pinned_at ? [{ ...m, pinned_at }, ...list] : list.map((x) => (x.id === m.id ? { ...x, pinned_at } : x))))
    setPinIdx(0)
    const { error } = await supabase.from('messages').update({ pinned_at }).eq('id', m.id)
    if (error) return flash('Run update_3_more_features.sql in Supabase first')
    flash(pinned_at ? '📌 Pinned for both of you' : 'Unpinned')
  }

  // ---------- disappearing messages ----------
  async function setDisappear(secs) {
    setDisappearOpen(false)
    if (secs === disappearSecs) return
    const content = secs
      ? `${me.name} turned on disappearing messages. New messages will disappear ${disappearLabel(secs)} after they're sent.`
      : `${me.name} turned off disappearing messages.`
    const row = { id: crypto.randomUUID(), sender_id: myId, receiver_id: fid, media_type: 'system', content, meta: { disappear: secs } }
    addOptimistic(row)
    await insertRow(row)
    setSysFetched({ ...row, created_at: new Date().toISOString() })
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

  // ---------- search, media gallery, starred list ----------
  useEffect(() => {
    if (!searchOpen) return
    const q = searchQ.trim()
    if (q.length < 2) return setSearchRes(null)
    const t = setTimeout(async () => {
      const { data } = await supabase.from('messages').select('*').or(pair).ilike('content', `%${q.replace(/[%_]/g, '\\$&')}%`)
        .neq('media_type', 'system').order('created_at', { ascending: false }).limit(60)
      setSearchRes((data || []).filter((m) => !(m.deleted_for || []).includes(myId) && !m.deleted_for_everyone))
    }, 350)
    return () => clearTimeout(t)
  }, [searchQ, searchOpen])

  async function openPanel(kind) {
    setHeaderMenu(false)
    setPanel(kind)
    setPanelItems(null)
    let q = supabase.from('messages').select('*').or(pair).eq('deleted_for_everyone', false)
    if (kind === 'media') q = q.in('media_type', ['image', 'video']).eq('view_once', false).not('media_path', 'is', null).order('created_at', { ascending: false }).limit(300)
    else q = q.in('id', [...starred].slice(0, 300)).order('created_at', { ascending: false })
    const { data, error } = await q
    if (error) { setPanelItems([]); return flash('Run update_3_more_features.sql in Supabase first') }
    setPanelItems((data || []).filter((m) => !(m.deleted_for || []).includes(myId)))
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

  const openViewer = async (m) => {
    try {
      const url = m._localUrl || (await signedUrl(m.media_path))
      setViewer({ url, kind: m.media_type, name: m.media_path?.split('/').pop() || 'media' })
    } catch {
      flash('Could not open file')
    }
  }

  const canReact = (m) => !m.deleted_for_everyone && !m._status && m.media_type !== 'system'
  const showMic = !text.trim() && !editing

  let prevDay = null
  let prevSender = null

  return (
    <div
      className={'chat' + (wall?.type && wall.type !== 'default' ? ' custom-wall' : '')}
      style={wallpaperStyle(wall)}
      onDragOver={(e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); setDragging(true) } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false) }}
      onDrop={onDrop}
    >
      {dragging && <div className="drop-hint">Drop photo or video to send</div>}

      {searchOpen ? (
        <header className="chat-header search-header">
          <button className="icon-btn" onClick={() => { setSearchOpen(false); setSearchQ(''); setSearchRes(null) }} aria-label="Close search"><Back /></button>
          <input autoFocus placeholder={`Search in chat with ${friend.name}`} value={searchQ} onChange={(e) => setSearchQ(e.target.value)} />
        </header>
      ) : (
        <header className="chat-header">
          <button className="icon-btn back-btn" onClick={onBack} aria-label="Back to chats"><Back /></button>
          <span className="avatar">{initials(friend.name)}</span>
          <div className="who-info">
            <div className="who-name">
              {friend.name} {pref?.locked && <span title="Locked chat">🔒</span>} {disappearSecs > 0 && <span title={'Disappearing: ' + disappearLabel(disappearSecs)}>⏳</span>}
            </div>
            <div className={'who-status' + (typing ? ' typing' : '')}>{headerStatus}</div>
          </div>
          <button className="icon-btn" onClick={() => setSearchOpen(true)} aria-label="Search in chat"><SearchIcon /></button>
          <button className="icon-btn" onClick={() => setHeaderMenu(true)} aria-label="Chat options"><Dots /></button>
        </header>
      )}

      {searchOpen && searchRes && (
        <div className="search-results">
          {!searchRes.length && <p className="list-empty">No messages found</p>}
          {searchRes.map((m) => (
            <button key={m.id} onClick={() => { setSearchOpen(false); setSearchRes(null); setSearchQ(''); goTo(m) }}>
              <small>{m.sender_id === myId ? 'You' : friend.name} · {dayLabel(m.created_at)} {timeOf(m.created_at)}</small>
              <span><Highlight text={m.content} q={searchQ.trim()} /></span>
            </button>
          ))}
        </div>
      )}

      {pinShown && !searchOpen && (
        <button className="pin-banner" onClick={() => { goTo(pinShown); setPinIdx((i) => i + 1) }}>
          <span className="pin-bar">{pinned.length > 1 && pinned.map((p) => <i key={p.id} className={p.id === pinShown.id ? 'on' : ''} />)}</span>
          <span className="pin-text">📌 {previewOf(pinShown)}</span>
        </button>
      )}

      <main className="messages" ref={listRef} onScroll={onScroll} onClick={() => setShowEmoji(false)}>
        {hasMore && <div className="load-more">Scroll up for older messages</div>}
        <div className="empty-note">🔒 Only you and {friend.name} can read this chat.</div>
        {messages.map((m) => {
          const k = dayKey(m.created_at)
          const showDay = k !== prevDay
          const mine = m.sender_id === myId
          const first = showDay || prevSender !== m.sender_id || m.media_type === 'system'
          prevDay = k
          prevSender = m.media_type === 'system' ? null : m.sender_id
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
                starred={starred.has(m.id)}
                highlight={hit === m.id}
                onMenu={() => setMenu(m)}
                onReply={() => { if (editing) cancelEdit(); setReplyTo(m); textRef.current?.focus() }}
                onReactions={() => setReactInfo(m)}
                onOpen={() => openViewer(m)}
                onViewOnce={() => openViewOnce(m)}
                onJump={() => (reply ? goTo(reply) : flash('Original message not loaded'))}
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
        <div className="emoji-wrap">
          <div className="emoji-tabs">
            <button className={emojiTab === 'emoji' ? 'on' : ''} onClick={() => setEmojiTab('emoji')}>😊 Emoji</button>
            <button className={emojiTab === 'stickers' ? 'on' : ''} onClick={() => setEmojiTab('stickers')}>💟 Stickers</button>
          </div>
          {emojiTab === 'emoji' ? (
            <div className="emoji-panel">
              {EMOJIS.map((e) => (
                <button key={e} onClick={() => { setText((t) => t + e); textRef.current?.focus() }}>{e}</button>
              ))}
            </div>
          ) : (
            <StickerPicker onPick={sendSticker} onPhoto={sendPhotoSticker} />
          )}
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
        {recorder.recording ? (
          <div className="composer-row">
            <div className="input-box recording">
              <button className="icon-btn dark" onClick={recorder.cancel} aria-label="Cancel recording">🗑️</button>
              <span className="rec-dot" />
              <span className="rec-time">{fmtDur(recorder.seconds)}</span>
              <span className="rec-label">Recording…</span>
            </div>
            <button className="send-btn" onClick={sendRecording} aria-label="Send voice message"><Send /></button>
          </div>
        ) : (
          <div className="composer-row">
            <div className="input-box">
              <button className="icon-btn dark" onClick={() => setShowEmoji((s) => !s)} aria-label="Emoji and stickers"><Smile /></button>
              <textarea
                ref={textRef}
                rows={1}
                placeholder={dictation.listening ? 'Listening… speak now' : 'Message'}
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
              {dictation.supported && (
                <button className={'icon-btn dark speak' + (dictation.listening ? ' on' : '')} onClick={dictation.toggle} aria-label={dictation.listening ? 'Stop voice typing' : 'Voice typing'} title="Speak to type">🗣️</button>
              )}
              {!editing && <button className="icon-btn dark" onClick={() => fileInput.current?.click()} aria-label="Attach photo or video"><Clip /></button>}
              <input ref={fileInput} type="file" accept="image/*,video/*" hidden onChange={pickFile} />
            </div>
            {showMic ? (
              <button className="send-btn" onClick={startRecording} aria-label="Record voice message"><Mic /></button>
            ) : (
              <button className="send-btn" onClick={sendText} disabled={!text.trim() && !editing?.media_type} aria-label={editing ? 'Save edit' : 'Send'}>{editing ? <Check /> : <Send />}</button>
            )}
          </div>
        )}
      </footer>

      {/* chat options (⋮) */}
      {headerMenu && (
        <div className="overlay" onClick={() => setHeaderMenu(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-title">{friend.name}</div>
            <button onClick={() => { setHeaderMenu(false); setSearchOpen(true) }}>🔍 Search</button>
            <button onClick={() => openPanel('media')}>🖼️ Media</button>
            <button onClick={() => openPanel('starred')}>⭐ Starred messages</button>
            <button onClick={() => { setHeaderMenu(false); setDisappearOpen(true) }}>⏳ Disappearing messages <small className="sheet-side">{disappearLabel(disappearSecs)}</small></button>
            <button onClick={() => { setHeaderMenu(false); setWallOpen(true) }}>🎨 Wallpaper</button>
            {chatActions.map((a) => <button key={a.label} onClick={() => { setHeaderMenu(false); a.run() }}>{a.label}</button>)}
          </div>
        </div>
      )}

      {disappearOpen && (
        <div className="overlay" onClick={() => setDisappearOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-title">⏳ Disappearing messages</div>
            <p className="sheet-note">New messages in this chat will disappear for both of you after the chosen time.</p>
            {DISAPPEAR.map(([v, l]) => (
              <button key={v} className="radio-row" onClick={() => setDisappear(v)}>
                <span className={'radio' + (disappearSecs === v ? ' on' : '')} /> {l}
              </button>
            ))}
          </div>
        </div>
      )}

      {wallOpen && <WallpaperPicker onClose={() => setWallOpen(false)} flash={flash} />}

      {panel && (
        <div className="side-panel">
          <header className="chat-header">
            <button className="icon-btn" onClick={() => setPanel(null)} aria-label="Back"><Back /></button>
            <div className="who-name">{panel === 'media' ? 'Media' : 'Starred messages'}</div>
          </header>
          {!panelItems ? (
            <div className="center-fill"><div className="spinner" /></div>
          ) : !panelItems.length ? (
            <p className="list-empty">{panel === 'media' ? 'No photos or videos yet' : 'No starred messages. Long-press a message → ⭐ Star.'}</p>
          ) : panel === 'media' ? (
            <div className="gallery">
              {panelItems.map((m) => <GalleryItem key={m.id} m={m} onOpen={() => openViewer(m)} />)}
            </div>
          ) : (
            <div className="star-list">
              {panelItems.map((m) => (
                <button key={m.id} onClick={() => { setPanel(null); goTo(m) }}>
                  <small>{m.sender_id === myId ? 'You' : friend.name} · {dayLabel(m.created_at)} {timeOf(m.created_at)}</small>
                  <span>★ {previewOf(m)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {menu && (
        <div className="overlay" onClick={() => setMenu(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            {canReact(menu) && (
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
            {canEdit(menu) && <button onClick={() => { const m = menu; setMenu(null); startEdit(m) }}>✏️ Edit</button>}
            {menu.content && !menu.deleted_for_everyone && (
              <button onClick={() => { navigator.clipboard?.writeText(menu.content); setMenu(null); flash('Copied') }}>📋 Copy</button>
            )}
            {canReact(menu) && <button onClick={() => toggleStar(menu)}>{starred.has(menu.id) ? '☆ Unstar' : '⭐ Star'}</button>}
            {canReact(menu) && <button onClick={() => togglePin(menu)}>{menu.pinned_at ? '📌 Unpin' : '📌 Pin'}</button>}
            {menu.media_path && !menu.view_once && ['image', 'video'].includes(menu.media_type) && (
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
            <input
              placeholder={picked.viewOnce ? 'View once: no caption' : 'Add a caption…'}
              value={picked.viewOnce ? '' : caption}
              disabled={picked.viewOnce}
              onChange={(e) => setCaption(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendMedia()}
              autoFocus
            />
            <button
              className={'vo-toggle' + (picked.viewOnce ? ' on' : '')}
              onClick={() => { setPicked((p) => ({ ...p, viewOnce: !p.viewOnce })); flash(picked.viewOnce ? 'View once off' : 'View once on: can be opened only one time') }}
              aria-label="View once"
              title="View once"
            >①</button>
            <button className="send-btn" onClick={sendMedia} aria-label="Send"><Send /></button>
          </div>
        </div>
      )}

      {viewer && (
        <div className="preview" onClick={closeViewer}>
          <div className="preview-top" onClick={(e) => e.stopPropagation()}>
            <button className="icon-btn" onClick={closeViewer} aria-label="Close"><Back /></button>
            {viewer.viewOnce ? (
              <span className="vo-note">① View once</span>
            ) : (
              <a className="icon-btn" href={viewer.url} download={viewer.name} target="_blank" rel="noreferrer" aria-label="Download"><Download /></a>
            )}
          </div>
          <div className="preview-media" onClick={(e) => e.stopPropagation()} onContextMenu={(e) => viewer.viewOnce && e.preventDefault()}>
            {viewer.kind === 'image' ? <img src={viewer.url} alt="" draggable={!viewer.viewOnce} /> : <video src={viewer.url} controls autoPlay playsInline controlsList={viewer.viewOnce ? 'nodownload' : undefined} />}
          </div>
        </div>
      )}
    </div>
  )
}

function Highlight({ text = '', q }) {
  if (!q) return text
  const i = text.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0) return text
  const start = Math.max(0, i - 30)
  return (
    <>
      {start > 0 && '…'}{text.slice(start, i)}<mark>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}
    </>
  )
}

function GalleryItem({ m, onOpen }) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    let alive = true
    signedUrl(m.media_path).then((u) => alive && setUrl(u)).catch(() => {})
    return () => { alive = false }
  }, [m.media_path])
  return (
    <button className="gallery-item" onClick={onOpen}>
      {!url ? <div className="spinner small" /> : m.media_type === 'image' ? <img src={url} alt="" loading="lazy" /> : (
        <>
          <video src={url + '#t=0.1'} preload="metadata" muted playsInline />
          <span className="gallery-play">▶</span>
        </>
      )}
    </button>
  )
}
