import { useEffect, useRef, useState } from 'react'

export const fmtDur = (s) => {
  s = Math.max(0, Math.round(s || 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const MAX_SECONDS = 5 * 60

// ---------- recording voice notes ----------
export function useRecorder() {
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const rec = useRef(null)
  const chunks = useRef([])
  const stream = useRef(null)
  const timer = useRef(null)
  const started = useRef(0)
  const done = useRef(null)

  const supported = typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined'

  function cleanup() {
    clearInterval(timer.current)
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
    rec.current = null
    setRecording(false)
    setSeconds(0)
  }

  async function start() {
    stream.current = await navigator.mediaDevices.getUserMedia({ audio: true })
    const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'].find((m) => MediaRecorder.isTypeSupported?.(m)) || ''
    const r = new MediaRecorder(stream.current, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined)
    chunks.current = []
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data)
    r.onstop = () => {
      const type = r.mimeType || mime || 'audio/webm'
      const blob = new Blob(chunks.current, { type })
      const duration = (Date.now() - started.current) / 1000
      const cb = done.current
      done.current = null
      cleanup()
      cb?.({ blob, duration, type })
    }
    rec.current = r
    started.current = Date.now()
    r.start(250)
    setRecording(true)
    setSeconds(0)
    timer.current = setInterval(() => {
      const s = Math.floor((Date.now() - started.current) / 1000)
      setSeconds(s)
      if (s >= MAX_SECONDS) stop()
    }, 250)
  }

  // resolves with { blob, duration, type }
  function stop() {
    return new Promise((resolve) => {
      if (!rec.current) return resolve(null)
      done.current = resolve
      rec.current.stop()
    })
  }

  function cancel() {
    if (!rec.current) return
    done.current = null
    rec.current.onstop = null
    try { rec.current.stop() } catch { /* already stopped */ }
    cleanup()
  }

  useEffect(() => () => cancel(), [])

  return { supported, recording, seconds, start, stop, cancel }
}

// ---------- playing voice notes ----------
let current = null // only one voice note plays at a time

export function VoicePlayer({ src, duration, mine }) {
  const audio = useRef(null)
  const [playing, setPlaying] = useState(false)
  const [pos, setPos] = useState(0)
  const [len, setLen] = useState(duration || 0)
  const [rate, setRate] = useState(1)

  useEffect(() => () => { if (current === audio.current) current = null }, [])

  function toggle(e) {
    e.stopPropagation()
    const a = audio.current
    if (!a || !src) return
    if (a.paused) {
      if (current && current !== a) current.pause()
      current = a
      a.play().catch(() => {})
    } else a.pause()
  }

  function seek(e) {
    e.stopPropagation()
    const a = audio.current
    const v = Number(e.target.value)
    setPos(v)
    if (a) a.currentTime = v
  }

  function cycleRate(e) {
    e.stopPropagation()
    const next = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1
    setRate(next)
    if (audio.current) audio.current.playbackRate = next
  }

  return (
    <div className={'voice' + (mine ? ' mine' : '')} onClick={(e) => e.stopPropagation()}>
      <audio
        ref={audio}
        src={src || undefined}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setPos(0) }}
        onTimeUpdate={(e) => setPos(e.target.currentTime)}
        onLoadedMetadata={(e) => { if (isFinite(e.target.duration)) setLen(e.target.duration) }}
      />
      <button className="voice-play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'} disabled={!src}>
        {playing ? (
          <svg viewBox="0 0 24 24" width="26" height="26"><path fill="currentColor" d="M6 5h4v14H6zm8 0h4v14h-4z" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" width="26" height="26"><path fill="currentColor" d="M8 5v14l11-7z" /></svg>
        )}
      </button>
      <div className="voice-main">
        <input type="range" min="0" max={len || 1} step="0.05" value={Math.min(pos, len || 1)} onChange={seek} onClick={(e) => e.stopPropagation()} aria-label="Seek" style={{ '--p': `${((pos / (len || 1)) * 100).toFixed(1)}%` }} />
        <div className="voice-info">
          <span>{fmtDur(playing || pos ? pos : len)}</span>
          {playing && <button className="voice-rate" onClick={cycleRate}>{rate}×</button>}
        </div>
      </div>
      <span className="voice-mic" aria-hidden="true">🎤</span>
    </div>
  )
}

// ---------- speak-to-type (speech recognition) ----------
export function useDictation(lang, onText) {
  const Rec = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null
  const [listening, setListening] = useState(false)
  const rec = useRef(null)
  const cb = useRef(onText)
  cb.current = onText

  function start() {
    if (!Rec) return
    const r = new Rec()
    r.lang = lang
    r.continuous = true
    r.interimResults = false
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) cb.current(e.results[i][0].transcript.trim())
      }
    }
    r.onend = () => setListening(false)
    r.onerror = () => setListening(false)
    rec.current = r
    r.start()
    setListening(true)
  }

  function stop() {
    rec.current?.stop()
    setListening(false)
  }

  useEffect(() => () => rec.current?.abort?.(), [])

  return { supported: !!Rec, listening, toggle: () => (listening ? stop() : start()), stop }
}
