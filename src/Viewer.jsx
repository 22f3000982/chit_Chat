import { useEffect, useRef, useState } from 'react'
import { Back, Download } from './icons'
import { signedUrl } from './utils'

// Full-screen photo/video viewer. Swipe (phone) or arrows (laptop) to move through an album.
export default function Viewer({ items, index: start = 0, viewOnce = false, onClose }) {
  const [index, setIndex] = useState(start)
  const [urls, setUrls] = useState({})
  const touch = useRef(null)
  const it = items[index]

  // resolve signed links lazily
  useEffect(() => {
    for (const i of [index - 1, index, index + 1]) {
      const x = items[i]
      if (!x || urls[i] || !(x.url || x.path)) continue
      if (x.url) setUrls((u) => ({ ...u, [i]: x.url }))
      else signedUrl(x.path).then((url) => setUrls((u) => ({ ...u, [i]: url }))).catch(() => {})
    }
  }, [index, items])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') setIndex((i) => Math.min(items.length - 1, i + 1))
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [items.length, onClose])

  const url = urls[index]
  const many = items.length > 1

  return (
    <div className="preview" onClick={onClose}>
      <div className="preview-top" onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn" onClick={onClose} aria-label="Close"><Back /></button>
        {many && <span className="viewer-count">{index + 1} / {items.length}</span>}
        {viewOnce ? (
          <span className="vo-note">① View once</span>
        ) : url ? (
          <a className="icon-btn" href={url} download={it.name || 'media'} target="_blank" rel="noreferrer" aria-label="Download"><Download /></a>
        ) : <span />}
      </div>
      <div
        className="preview-media"
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => viewOnce && e.preventDefault()}
        onTouchStart={(e) => { touch.current = e.touches[0].clientX }}
        onTouchEnd={(e) => {
          if (touch.current == null) return
          const dx = e.changedTouches[0].clientX - touch.current
          touch.current = null
          if (dx < -50) setIndex((i) => Math.min(items.length - 1, i + 1))
          if (dx > 50) setIndex((i) => Math.max(0, i - 1))
        }}
      >
        {!url ? <div className="spinner" /> : it.kind === 'image' ? (
          <img src={url} alt="" draggable={!viewOnce} />
        ) : (
          <video key={url} src={url} controls autoPlay playsInline controlsList={viewOnce ? 'nodownload' : undefined} />
        )}
        {many && index > 0 && <button className="nav prev" onClick={() => setIndex(index - 1)} aria-label="Previous">‹</button>}
        {many && index < items.length - 1 && <button className="nav next" onClick={() => setIndex(index + 1)} aria-label="Next">›</button>}
      </div>
    </div>
  )
}
