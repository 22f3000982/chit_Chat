import { Fragment, useEffect, useRef, useState } from 'react'
import { signedUrl, timeOf } from './utils'
import { Ban, Down, Play, Ticks } from './icons'
import { VoicePlayer, fmtDur } from './Voice'
import { StickerArt } from './Stickers'

// Right-click on desktop, long-press on phone
export function useLongPress(onLong) {
  const press = useRef(null)
  return {
    onContextMenu: (e) => { e.preventDefault(); onLong() },
    onTouchStart: () => { press.current = setTimeout(() => { press.current = 'fired'; navigator.vibrate?.(20); onLong() }, 450) },
    onTouchEnd: () => { if (press.current !== 'fired') clearTimeout(press.current) },
    onTouchMove: () => { if (press.current !== 'fired') clearTimeout(press.current) },
    onClickCapture: (e) => { if (press.current === 'fired') { e.stopPropagation(); e.preventDefault(); press.current = null } },
  }
}

// signed link for a private file (or the local preview while uploading)
function useFileUrl(m) {
  const [url, setUrl] = useState(m._localUrl || null)
  const [err, setErr] = useState(false)
  useEffect(() => {
    if (m._localUrl) return setUrl(m._localUrl)
    if (!m.media_path) return setUrl(null)
    let alive = true
    signedUrl(m.media_path).then((u) => alive && setUrl(u)).catch(() => alive && setErr(true))
    return () => { alive = false }
  }, [m.media_path, m._localUrl])
  return [url, err]
}

export default function Bubble({
  m, mine, first, status, reply, replyName, starred, highlight,
  onMenu, onReply, onReactions, onOpen, onViewOnce, onJump, onRetry, onMediaLoad,
}) {
  const lp = useLongPress(onMenu)
  // swipe right on a message to reply (like WhatsApp)
  const rowRef = useRef(null)
  const swipe = useRef(null)
  const canReply = !m.deleted_for_everyone && !m._status
  const setX = (x) => {
    const el = rowRef.current
    if (!el) return
    el.style.transform = x ? `translateX(${x}px)` : ''
    el.style.setProperty('--reply-o', Math.min(x / 60, 1))
  }
  const handlers = {
    ...lp,
    onTouchStart: (e) => {
      lp.onTouchStart(e)
      const t = e.touches[0]
      swipe.current = { x: t.clientX, y: t.clientY, dx: 0, dir: null }
    },
    onTouchMove: (e) => {
      const s = swipe.current
      if (!s || !canReply) return lp.onTouchMove(e)
      const t = e.touches[0]
      const dx = t.clientX - s.x
      const dy = t.clientY - s.y
      if (!s.dir && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) s.dir = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
      lp.onTouchMove(e)
      if (s.dir !== 'x') return
      s.dx = Math.max(0, Math.min(dx, 80))
      if (rowRef.current) rowRef.current.style.transition = 'none'
      setX(s.dx)
    },
    onTouchEnd: (e) => {
      lp.onTouchEnd(e)
      const s = swipe.current
      swipe.current = null
      if (!s || s.dir !== 'x') return
      if (rowRef.current) rowRef.current.style.transition = 'transform .2s'
      setX(0)
      if (s.dx > 55) { navigator.vibrate?.(15); onReply?.() }
    },
    onTouchCancel: () => {
      swipe.current = null
      if (rowRef.current) rowRef.current.style.transition = 'transform .2s'
      setX(0)
    },
  }

  // system notes (e.g. disappearing messages turned on)
  if (m.media_type === 'system') {
    return (
      <div id={'m-' + m.id} className="system-note"><span>{m.content}</span></div>
    )
  }

  const meta = (
    <span className="meta">
      {starred && <span className="star" title="Starred">★</span>}
      {m.edited_at && !m.deleted_for_everyone && <span className="edited">Edited</span>}
      {timeOf(m.created_at)}
      {mine && !m.deleted_for_everyone && <Ticks status={status} />}
    </span>
  )

  const rowClass = `row ${mine ? 'mine' : 'theirs'}${first ? ' first' : ''}${highlight ? ' hit' : ''}`

  if (m.deleted_for_everyone) {
    return (
      <div id={'m-' + m.id} className={rowClass}>
        <div className="bubble deleted" {...lp}>
          <Ban /> <i>{mine ? 'You deleted this message' : 'This message was deleted'}</i>
          {meta}
        </div>
      </div>
    )
  }

  const reacts = Object.values(m.reactions || {})
  const uniq = [...new Set(reacts)]
  const isSticker = m.media_type === 'sticker'
  const isVoice = m.media_type === 'audio'
  const isMedia = m.media_type === 'image' || m.media_type === 'video'

  return (
    <div id={'m-' + m.id} ref={rowRef} className={rowClass + (reacts.length ? ' has-reacts' : '')}>
      <span className="swipe-reply" aria-hidden="true">↩</span>
      <div
        className={'bubble' + (isMedia && !m.view_once ? ' has-media' : '') + (isSticker ? ' sticker' : '') + (isVoice ? ' voice-bubble' : '')}
        {...handlers}
        onDoubleClick={() => canReply && onReply?.()}
      >
        <button className="bubble-menu" onClick={(e) => { e.stopPropagation(); onMenu() }} aria-label="Message options"><Down /></button>
        {m.reply_to && (
          <div className="quote in-bubble" onClick={onJump}>
            <b>{reply ? replyName : ''}</b>
            <span>{!reply ? 'Message' : previewOf(reply)}</span>
          </div>
        )}
        {m.view_once ? (
          <ViewOnce m={m} mine={mine} onOpen={onViewOnce} />
        ) : isSticker ? (
          <StickerBody m={m} onLoad={onMediaLoad} />
        ) : isVoice ? (
          <VoiceBody m={m} mine={mine} />
        ) : isMedia ? (
          <Media m={m} onOpen={onOpen} onLoad={onMediaLoad} />
        ) : null}
        {m.content && <span className="text"><Linkify text={m.content} /></span>}
        {meta}
        {status === 'failed' && <button className="retry" onClick={onRetry}>Not sent. Tap to retry</button>}
        {reacts.length > 0 && (
          <button className="reacts" onClick={(e) => { e.stopPropagation(); onReactions?.() }} aria-label="Reactions">
            {uniq.join('')}{reacts.length > 1 && <span>{reacts.length}</span>}
          </button>
        )}
      </div>
    </div>
  )
}

function VoiceBody({ m, mine }) {
  const [url] = useFileUrl(m)
  return <VoicePlayer src={url} duration={m.meta?.duration} mine={mine} />
}

function StickerBody({ m, onLoad }) {
  const [url, err] = useFileUrl(m)
  if (m.meta?.sticker) return <StickerArt id={m.meta.sticker} />
  if (err) return <div className="media-missing">Sticker not available</div>
  return url ? <img className="sticker-img" src={url} alt="Sticker" onLoad={onLoad} /> : <div className="sticker-img"><div className="spinner small" /></div>
}

function ViewOnce({ m, mine, onOpen }) {
  const kind = m.media_type === 'video' ? 'Video' : 'Photo'
  const opened = !!m.viewed_at
  const canOpen = !mine && !opened && m.media_path
  return (
    <button className={'view-once' + (opened ? ' opened' : '')} onClick={(e) => { e.stopPropagation(); canOpen && onOpen?.() }} disabled={!canOpen}>
      <span className="vo-icon">{opened ? '◌' : '①'}</span>
      <span>
        {opened ? 'Opened' : kind}
        {!opened && <small>{mine ? 'View once' : m._status ? 'Sending…' : 'Tap to view once'}</small>}
      </span>
    </button>
  )
}

export function Media({ m, onOpen, onLoad }) {
  const [url, err] = useFileUrl(m)
  const uploading = m._status === 'sending'
  return (
    <div className="media" onClick={() => !uploading && url && onOpen?.()}>
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

export function Linkify({ text }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g)
  return parts.map((p, i) =>
    /^https?:\/\//.test(p) ? <a key={i} href={p} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{p}</a> : <Fragment key={i}>{p}</Fragment>
  )
}

// Short text for chat list previews and reply bars
export function previewOf(m) {
  if (!m) return ''
  if (m.deleted_for_everyone) return '🚫 This message was deleted'
  if (m.media_type === 'system') return m.content || ''
  if (m.view_once) return `① ${m.media_type === 'video' ? 'Video' : 'Photo'}`
  if (m.media_type === 'audio') return `🎤 Voice message (${fmtDur(m.meta?.duration)})`
  if (m.media_type === 'sticker') return '💟 Sticker'
  const tag = m.media_type === 'image' ? '📷' : m.media_type === 'video' ? '🎥' : ''
  if (tag && !m.content) return `${tag} ${m.media_type === 'image' ? 'Photo' : 'Video'}`
  return [tag, m.content].filter(Boolean).join(' ')
}
