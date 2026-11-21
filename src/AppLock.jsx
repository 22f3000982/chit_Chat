import { useEffect, useRef, useState } from 'react'
import { logout } from './push'
import { setLocal, sha256, useLocal } from './local'

// Locks the whole app with a PIN (stored only on this device).
export function useAppLock() {
  const [hash] = useLocal('appLock', null)
  const [delay] = useLocal('appLockDelay', 0) // seconds away before locking again
  const [locked, setLocked] = useState(() => !!hash)
  const hiddenAt = useRef(null)

  useEffect(() => {
    if (!hash) setLocked(false)
  }, [hash])

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden') hiddenAt.current = Date.now()
      else if (hash && hiddenAt.current && Date.now() - hiddenAt.current >= delay * 1000) setLocked(true)
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [hash, delay])

  return { locked: !!hash && locked, unlock: () => setLocked(false), hash }
}

export default function LockScreen({ hash, onUnlock }) {
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const [shake, setShake] = useState(false)
  const ref = useRef(null)

  useEffect(() => { ref.current?.focus() }, [])

  async function check(v) {
    if ((await sha256('app:' + v)) === hash) return onUnlock()
    setErr('Wrong PIN')
    setShake(true)
    setTimeout(() => setShake(false), 400)
    setPin('')
  }

  function onChange(e) {
    const v = e.target.value.replace(/\D/g, '').slice(0, 6)
    setPin(v)
    setErr('')
    if (v.length >= 4) sha256('app:' + v).then((h) => h === hash && onUnlock())
  }

  async function forgot() {
    if (!confirm('Log out and remove the app lock on this device?')) return
    setLocal('appLock', null)
    await logout()
  }

  return (
    <div className="lock-screen" onClick={() => ref.current?.focus()}>
      <img src="/icon.svg" alt="" width="64" height="64" />
      <h2>Chit Chat is locked</h2>
      <p>Enter your app lock PIN</p>
      <form className={shake ? 'shake' : ''} onSubmit={(e) => { e.preventDefault(); check(pin) }}>
        <input ref={ref} className="pass-input" type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={onChange} placeholder="PIN" aria-label="App lock PIN" />
        {err && <div className="error">{err}</div>}
        <button className="primary" disabled={pin.length < 4}>Unlock</button>
      </form>
      <button className="link" onClick={forgot}>Forgot PIN? Log out</button>
    </div>
  )
}
