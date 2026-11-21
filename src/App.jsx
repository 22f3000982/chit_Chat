import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { SUPABASE_ANON_KEY } from './config'
import Login from './Login'
import Chat from './Chat'

export default function App() {
  const [session, setSession] = useState(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  if (SUPABASE_ANON_KEY.startsWith('PASTE_')) {
    return (
      <div className="center-screen">
        <p>Setup not finished: add the Supabase anon key in <code>src/config.js</code>.</p>
      </div>
    )
  }
  if (session === undefined) return <div className="center-screen"><div className="spinner" /></div>
  if (!session) return <Login />
  return <Chat session={session} />
}
