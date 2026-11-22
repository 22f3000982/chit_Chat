import { useEffect, useState } from 'react'
import { supabase } from './supabase'

const FREE_BYTES = 1024 ** 3 // Supabase free plan: 1 GB of file storage

export const fmtBytes = (b) => {
  if (!b) return '0 KB'
  const u = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(u.length - 1, Math.floor(Math.log(b) / Math.log(1024)))
  return `${(b / 1024 ** i).toFixed(i >= 2 ? 1 : 0)} ${u[i]}`
}

const typeOf = (f) => {
  const t = f.metadata?.mimetype || ''
  if (t.startsWith('video/')) return 'video'
  if (t.startsWith('audio/')) return 'audio'
  if (f.name.startsWith('sticker') || t === 'image/webp') return 'sticker'
  if (t.startsWith('image/')) return 'image'
  return 'other'
}
const LABEL = { image: '📷 Photos', video: '🎥 Videos', audio: '🎤 Voice notes', sticker: '💟 Stickers', other: '📄 Other' }
const COLOR = { image: '#25d366', video: '#53bdeb', audio: '#ffb300', sticker: '#ec407a', other: '#8696a0' }

async function listAll(folder) {
  const out = []
  for (let offset = 0; offset < 20000; offset += 1000) {
    const { data, error } = await supabase.storage.from('media').list(folder, { limit: 1000, offset, sortBy: { column: 'created_at', order: 'desc' } })
    if (error) throw error
    out.push(...(data || []).filter((f) => f.id).map((f) => ({ ...f, folder, path: `${folder}/${f.name}` })))
    if (!data || data.length < 1000) break
  }
  return out
}

export default function StorageSheet({ me, friends, onClose, flash }) {
  const [files, setFiles] = useState(null)
  const [busy, setBusy] = useState(null)

  async function load() {
    try {
      const lists = await Promise.all([me, ...friends].map((p) => listAll(p.id)))
      setFiles(lists.flat())
    } catch (e) {
      flash('Could not read storage: ' + e.message)
      setFiles([])
    }
  }
  useEffect(() => { load() }, [])

  // delete one of my files for everyone (frees space)
  async function remove(f) {
    if (!confirm('Delete this file for everyone? The message will show "This message was deleted".')) return
    setBusy(f.path)
    const id = f.name.replace(/\.[^.]+$/, '')
    await supabase.storage.from('media').remove([f.path])
    await supabase.from('messages').update({ deleted_for_everyone: true, content: null, media_path: null, media_type: null }).eq('id', id)
    setFiles((l) => l.filter((x) => x.path !== f.path))
    setBusy(null)
    flash('Deleted, ' + fmtBytes(f.metadata?.size) + ' freed')
  }

  const total = (files || []).reduce((n, f) => n + (f.metadata?.size || 0), 0)
  const byType = {}
  const byPerson = {}
  for (const f of files || []) {
    const t = typeOf(f)
    byType[t] = (byType[t] || 0) + (f.metadata?.size || 0)
    byPerson[f.folder] = (byPerson[f.folder] || 0) + (f.metadata?.size || 0)
  }
  const pct = Math.min(100, (total / FREE_BYTES) * 100)
  const mineBig = (files || []).filter((f) => f.folder === me.id).sort((a, b) => (b.metadata?.size || 0) - (a.metadata?.size || 0)).slice(0, 15)
  const name = (id) => (id === me.id ? 'You' : friends.find((f) => f.id === id)?.name || 'Friend')

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet storage-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-title">📊 Storage</div>
        {!files ? (
          <div className="center-fill pad"><div className="spinner" /></div>
        ) : (
          <>
            <div className="storage-head">
              <b>{fmtBytes(total)}</b> <span>of 1 GB free space used</span>
              <div className="storage-bar">
                {Object.entries(byType).map(([t, b]) => (
                  <i key={t} style={{ width: `${(b / FREE_BYTES) * 100}%`, background: COLOR[t] }} title={LABEL[t]} />
                ))}
              </div>
              <small className={pct > 80 ? 'warn' : ''}>{pct.toFixed(1)}% used · {fmtBytes(Math.max(0, FREE_BYTES - total))} left</small>
            </div>

            <div className="storage-rows">
              {Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([t, b]) => (
                <div key={t}><span><i style={{ background: COLOR[t] }} />{LABEL[t]}</span><b>{fmtBytes(b)}</b></div>
              ))}
              {Object.entries(byPerson).map(([id, b]) => (
                <div key={id} className="by-person"><span>Sent by {name(id)}</span><b>{fmtBytes(b)}</b></div>
              ))}
            </div>

            {mineBig.length > 0 && (
              <>
                <div className="sheet-title small">Your biggest files</div>
                {mineBig.map((f) => (
                  <div key={f.path} className="big-file">
                    <span className="bf-type">{LABEL[typeOf(f)].split(' ')[0]}</span>
                    <div><b>{fmtBytes(f.metadata?.size)}</b><small>{new Date(f.created_at).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}</small></div>
                    <button className="link danger-text" disabled={busy === f.path} onClick={() => remove(f)}>{busy === f.path ? '…' : 'Delete'}</button>
                  </div>
                ))}
              </>
            )}
            <p className="sheet-note">Text messages take almost no space. Photos, videos and voice notes use this 1 GB. Turning on disappearing messages clears old files automatically.</p>
          </>
        )}
      </div>
    </div>
  )
}
