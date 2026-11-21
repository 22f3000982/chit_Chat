import { useState } from 'react'
import { supabase } from './supabase'
import { initials } from './utils'
import { Back } from './icons'

export default function Settings({ me, onClose, onChange, flash, hasLock, onChangeLockCode }) {
  const [pass, setPass] = useState('')
  const [saving, setSaving] = useState(false)

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

      <h3>Chat lock</h3>
      <button className="setting as-btn" onClick={onChangeLockCode}>
        <div>
          <b>{hasLock ? 'Change secret code' : 'Set secret code'}</b>
          <small>Used to open locked chats. Type it in the search bar to see hidden chats.</small>
        </div>
        <span className="chev">›</span>
      </button>

      <h3>Security</h3>
      <div className="setting">
        <input className="pin-field" type="password" autoCapitalize="none" placeholder="New password (min 6)" value={pass} onChange={(e) => setPass(e.target.value)} />
        <button className="primary small" onClick={changePassword} disabled={saving}>Change password</button>
      </div>

      <button className="logout" onClick={() => supabase.auth.signOut()}>Log out</button>
    </aside>
  )
}
