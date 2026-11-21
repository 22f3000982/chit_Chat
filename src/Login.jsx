import { useRef, useState } from 'react'
import { supabase } from './supabase'
import { USERS } from './config'
import { initials } from './utils'

export default function Login() {
  const [user, setUser] = useState(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)

  async function submit(value = pin) {
    if (!user || value.length !== 6 || busy) return
    setBusy(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email: user.email, password: value })
    setBusy(false)
    if (error) {
      setError(error.status === 429 ? 'Too many tries. Wait a few minutes.' : 'Wrong PIN. Try again.')
      setPin('')
      inputRef.current?.focus()
    }
  }

  function onPin(e) {
    const v = e.target.value.replace(/\D/g, '').slice(0, 6)
    setPin(v)
    setError('')
    if (v.length === 6) submit(v)
  }

  return (
    <div className="login">
      <div className="login-top">
        <img src="/icon.svg" alt="" width="64" height="64" />
        <h1>Chit Chat</h1>
        <p>Just the two of us. No distractions.</p>
      </div>

      <div className="login-card">
        {!user ? (
          <>
            <h2>Who are you?</h2>
            <div className="who">
              {USERS.map((u) => (
                <button key={u.email} className="who-btn" onClick={() => { setUser(u); setTimeout(() => inputRef.current?.focus(), 50) }}>
                  <span className="avatar big">{initials(u.name)}</span>
                  {u.name}
                </button>
              ))}
            </div>
          </>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); submit() }}>
            <button type="button" className="link" onClick={() => { setUser(null); setPin(''); setError('') }}>← Not {user.name}?</button>
            <h2>Hi {user.name}, enter your PIN</h2>
            <label className="pin-wrap" onClick={() => inputRef.current?.focus()}>
              <input
                ref={inputRef}
                className="pin-input"
                type="password"
                inputMode="numeric"
                autoComplete="current-password"
                value={pin}
                onChange={onPin}
                maxLength={6}
                aria-label="6-digit PIN"
              />
              {Array.from({ length: 6 }).map((_, i) => (
                <span key={i} className={'pin-dot' + (i < pin.length ? ' on' : '')} />
              ))}
            </label>
            {error && <p className="error">{error}</p>}
            <button className="primary" disabled={pin.length !== 6 || busy}>{busy ? 'Opening…' : 'Open chat'}</button>
          </form>
        )}
      </div>
    </div>
  )
}
