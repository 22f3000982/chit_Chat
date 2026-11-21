import { useRef, useState } from 'react'
import { supabase } from './supabase'
import { USERS } from './config'
import { initials } from './utils'

export default function Login() {
  const [user, setUser] = useState(null)
  const [pin, setPin] = useState('') // password
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)

  async function submit(value = pin) {
    if (!user || !value || busy) return
    setBusy(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email: user.email, password: value })
    setBusy(false)
    if (error) {
      setError(error.status === 429 ? 'Too many tries. Wait a few minutes.' : 'Wrong password. Try again.')
      setPin('')
      inputRef.current?.focus()
    }
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
            <h2>Hi {user.name}, enter your password</h2>
            <input
              ref={inputRef}
              className="pass-input"
              type="password"
              autoComplete="current-password"
              autoCapitalize="none"
              value={pin}
              onChange={(e) => { setPin(e.target.value); setError('') }}
              placeholder="Password"
              aria-label="Password"
            />
            {error && <p className="error">{error}</p>}
            <button className="primary" disabled={!pin || busy}>{busy ? 'Opening…' : 'Open chat'}</button>
          </form>
        )}
      </div>
    </div>
  )
}
