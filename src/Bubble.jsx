import { Fragment, useEffect, useRef, useState } from 'react'
import { signedUrl, timeOf } from './utils'
import { Ban, Down, Play, Ticks } from './icons'

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

export default function Bubble({ m, mine, first, status, reply, replyName, onMenu, onOpen, onJump, onRetry, onMediaLoad }) {
  const handlers = useLongPress(onMenu)

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
        {status === 'failed' && <button className="retry" onClick={onRetry}>Not sent. Tap to retry</button>}
      </div>
    </div>
  )
}

export function Media({ m, onOpen, onLoad }) {
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
  const tag = m.media_type === 'image' ? '📷 Photo' : m.media_type === 'video' ? '🎥 Video' : ''
  return [tag, m.content].filter(Boolean).join(' ').replace(/^📷 Photo (.)/, '📷 $1').replace(/^🎥 Video (.)/, '🎥 $1')
}
