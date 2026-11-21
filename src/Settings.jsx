import { useState } from 'react'
import { supabase } from './supabase'
import { initials, compressImage } from './utils'
import { Back } from './icons'
import { setLocal, sha256, useLocal, WALL_COLORS, wallpaperStyle } from './local'

export default function Settings({ me, onClose, onChange, flash, hasLock, onChangeLockCode }) {
  const [pass, setPass] = useState('')
  const [saving, setSaving] = useState(false)
  const [theme, setTheme] = useLocal('theme', 'light')
  const [appLock] = useLocal('appLock', null)
  const [lockDelay, setLockDelay] = useLocal('appLockDelay', 0)
  const [speechLang, setSpeechLang] = useLocal('speechLang', 'hi-IN')
  const [wallOpen, setWallOpen] = useState(false)
  const [pinDialog, setPinDialog] = useState(false)

  async function changePassword() {
    if (pass.length < 6) return flash('Password must be at least 6 characters')
    setSaving(true)
    const { error } = await supabase.auth.updateUser({ password: pass })
    setSaving(false)
    if (error) return flash(error.message)
    setPass('')
    flash('Password changed ✔')
  }

  return (
    <aside className="settings">
      <header className="chat-header">
        <button className="icon-btn" onClick={onClose} aria-label="Back"><Back /></button>
        <div className="who-name">Settings</div>
      </header>
      <div className="settings-me">
        <span className="avatar big">{initials(me.name)}</span>
        <div><b>{me.name}</b><small>Logged in</small></div>
      </div>

      <h3>Appearance</h3>
      <div className="setting">
        <div><b>Theme</b></div>
        <div className="seg">
          {[['light', '☀️ Light'], ['dark', '🌙 Dark'], ['system', 'Auto']].map(([v, l]) => (
            <button key={v} className={theme === v ? 'on' : ''} onClick={() => setTheme(v)}>{l}</button>
          ))}
        </div>
      </div>
      <button className="setting as-btn" onClick={() => setWallOpen(true)}>
        <div><b>Chat wallpaper</b><small>Colour or your own photo (this device)</small></div>
        <span className="chev">›</span>
      </button>

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

      <h3>App lock</h3>
      <label className="setting">
        <div>
          <b>Lock app with PIN</b>
          <small>Asks for a PIN every time you open the app (this device).</small>
        </div>
        <input
          type="checkbox"
          className="switch"
          checked={!!appLock}
          onChange={(e) => (e.target.checked ? setPinDialog(true) : (setLocal('appLock', null), flash('App lock turned off')))}
        />
      </label>
      {appLock && (
        <div className="setting">
          <div><b>Lock after</b></div>
          <div className="seg">
            {[[0, 'Immediately'], [60, '1 min'], [300, '5 min']].map(([v, l]) => (
              <button key={v} className={lockDelay === v ? 'on' : ''} onClick={() => setLockDelay(v)}>{l}</button>
            ))}
          </div>
        </div>
      )}

      <h3>Chat lock</h3>
      <button className="setting as-btn" onClick={onChangeLockCode}>
        <div>
          <b>{hasLock ? 'Change secret code' : 'Set secret code'}</b>
          <small>Used to open locked chats. Type it in the search bar to see hidden chats.</small>
        </div>
        <span className="chev">›</span>
      </button>

      <h3>Voice typing</h3>
      <div className="setting">
        <div><b>Language</b><small>For the 🗣️ speak-to-type button</small></div>
        <div className="seg">
          {[['hi-IN', 'हिन्दी'], ['en-IN', 'English']].map(([v, l]) => (
            <button key={v} className={speechLang === v ? 'on' : ''} onClick={() => setSpeechLang(v)}>{l}</button>
          ))}
        </div>
      </div>

      <h3>Security</h3>
      <div className="setting">
        <input className="pin-field" type="password" autoCapitalize="none" placeholder="New password (min 6)" value={pass} onChange={(e) => setPass(e.target.value)} />
        <button className="primary small" onClick={changePassword} disabled={saving}>Change password</button>
      </div>

      <button className="logout" onClick={() => supabase.auth.signOut()}>Log out</button>

      {wallOpen && <WallpaperPicker onClose={() => setWallOpen(false)} flash={flash} />}
      {pinDialog && <AppPinDialog onClose={() => setPinDialog(false)} flash={flash} />}
    </aside>
  )
}

export function WallpaperPicker({ onClose, flash }) {
  const [wall, setWall] = useLocal('wallpaper', { type: 'default' })
  const [busy, setBusy] = useState(false)

  async function pickPhoto(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    const small = await compressImage(file, 1280, 0.75)
    const url = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(small) })
    setBusy(false)
    if (url.length > 3_500_000) return flash('Photo is too big, try another one')
    setWall({ type: 'image', value: url })
    flash('Wallpaper set ✔')
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet wall-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-title">Chat wallpaper</div>
        <div className="wall-grid">
          <button className={'wall-opt default' + (wall.type === 'default' ? ' on' : '')} onClick={() => setWall({ type: 'default' })}>Default</button>
          {WALL_COLORS.map((c) => (
            <button key={c} className={'wall-opt' + (wall.type === 'color' && wall.value === c ? ' on' : '')} style={{ background: c }} onClick={() => setWall({ type: 'color', value: c })} aria-label={'Colour ' + c} />
          ))}
          <label className={'wall-opt photo' + (wall.type === 'image' ? ' on' : '')} style={wall.type === 'image' ? wallpaperStyle(wall) : undefined}>
            <input type="file" accept="image/*" hidden onChange={pickPhoto} />
            {busy ? '…' : wall.type === 'image' ? '' : '🖼️ Photo'}
          </label>
        </div>
        <button onClick={onClose}>Done</button>
      </div>
    </div>
  )
}

function AppPinDialog({ onClose, flash }) {
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [err, setErr] = useState('')
  async function save(e) {
    e.preventDefault()
    if (!/^\d{4,6}$/.test(a)) return setErr('PIN must be 4 to 6 digits')
    if (a !== b) return setErr("PINs don't match")
    setLocal('appLock', await sha256('app:' + a))
    flash('App lock is on 🔒')
    onClose()
  }
  const clean = (v) => v.replace(/\D/g, '').slice(0, 6)
  return (
    <div className="overlay" onClick={onClose}>
      <form className="dialog code-dialog" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <div className="lock-big">📱</div>
        <p>Set app lock PIN</p>
        <small>4–6 digits. If you forget it, you can log out and log in again.</small>
        <input type="password" inputMode="numeric" autoFocus placeholder="PIN" value={a} onChange={(e) => { setA(clean(e.target.value)); setErr('') }} />
        <input type="password" inputMode="numeric" placeholder="Type it again" value={b} onChange={(e) => { setB(clean(e.target.value)); setErr('') }} />
        {err && <div className="error">{err}</div>}
        <div className="dialog-actions row">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit">Save</button>
        </div>
      </form>
    </div>
  )
}
