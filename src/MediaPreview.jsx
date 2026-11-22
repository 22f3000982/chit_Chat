import { useEffect, useRef, useState } from 'react'
import { Close, Send } from './icons'
import { useLocal } from './local'

// Preview before sending: many photos/videos, a caption for each, HD and view-once options
export default function MediaPreview({ items, initialCaption = '', onCancel, onSend, flash, maxItems = 30 }) {
  const [list, setList] = useState(() => items.map((it, i) => ({ ...it, caption: i === 0 ? initialCaption : '' })))
  const [index, setIndex] = useState(0)
  const [viewOnce, setViewOnce] = useState(false)
  const [hd, setHd] = useLocal('hdPhotos', false)
  const addInput = useRef(null)

  useEffect(() => { if (index >= list.length) setIndex(Math.max(0, list.length - 1)) }, [list.length, index])
  useEffect(() => { if (list.length > 1 && viewOnce) setViewOnce(false) }, [list.length, viewOnce])

  const cur = list[index]
  if (!cur) return null

  function addFiles(files) {
    const next = []
    for (const file of files) {
      const kind = file.type.startsWith('video/') ? 'video' : file.type.startsWith('image/') ? 'image' : null
      if (!kind) continue
      next.push({ file, kind, url: URL.createObjectURL(file), caption: '' })
    }
    if (list.length + next.length > maxItems) flash?.(`You can send up to ${maxItems} at once`)
    setList((l) => [...l, ...next].slice(0, maxItems))
  }

  function remove(i) {
    URL.revokeObjectURL(list[i].url)
    const next = list.filter((_, j) => j !== i)
    if (!next.length) return onCancel()
    setList(next)
    if (index >= i && index > 0) setIndex(index - 1)
  }

  function cancel() {
    list.forEach((it) => URL.revokeObjectURL(it.url))
    onCancel()
  }

  const hasImage = list.some((it) => it.kind === 'image')

  return (
    <div className="preview">
      <div className="preview-top">
        <button className="icon-btn" onClick={cancel} aria-label="Cancel"><Close /></button>
        <div className="preview-tools">
          {hasImage && (
            <button
              className={'hd-toggle' + (hd ? ' on' : '')}
              onClick={() => { setHd(!hd); flash?.(!hd ? 'HD quality: bigger file, sharper photo' : 'Standard quality: smaller, faster') }}
              title="Photo quality"
            >HD</button>
          )}
        </div>
      </div>

      <div className="preview-media">
        {cur.kind === 'image' ? <img src={cur.url} alt="" /> : <video key={cur.url} src={cur.url} controls playsInline />}
      </div>

      <div className="preview-strip">
        {list.map((it, i) => (
          <div key={it.url} className={'thumb' + (i === index ? ' on' : '')} onClick={() => setIndex(i)}>
            {it.kind === 'image' ? <img src={it.url} alt="" /> : <video src={it.url} muted />}
            {it.kind === 'video' && <span className="thumb-vid">▶</span>}
            {i === index && list.length > 1 && (
              <button className="thumb-x" onClick={(e) => { e.stopPropagation(); remove(i) }} aria-label="Remove">✕</button>
            )}
          </div>
        ))}
        {list.length < maxItems && (
          <button className="thumb add" onClick={() => addInput.current?.click()} aria-label="Add more">＋</button>
        )}
        <input ref={addInput} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { addFiles([...(e.target.files || [])]); e.target.value = '' }} />
      </div>

      <div className="preview-bottom">
        <input
          placeholder={viewOnce ? 'View once: no caption' : 'Add a caption…'}
          value={viewOnce ? '' : cur.caption}
          disabled={viewOnce}
          onChange={(e) => setList((l) => l.map((it, i) => (i === index ? { ...it, caption: e.target.value } : it)))}
          onKeyDown={(e) => e.key === 'Enter' && onSend(list, { viewOnce, hd })}
          autoFocus
        />
        {list.length === 1 && (
          <button
            className={'vo-toggle' + (viewOnce ? ' on' : '')}
            onClick={() => { setViewOnce(!viewOnce); flash?.(viewOnce ? 'View once off' : 'View once on: can be opened only one time') }}
            aria-label="View once"
            title="View once"
          >①</button>
        )}
        <button className="send-btn" onClick={() => onSend(list, { viewOnce, hd })} aria-label="Send">
          <Send />
          {list.length > 1 && <span className="send-count">{list.length}</span>}
        </button>
      </div>
    </div>
  )
}
