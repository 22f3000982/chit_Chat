// Built-in sticker pack (our own designs: big emoji + a word)
export const STICKERS = [
  ['hi', '🙋', 'Hiii', '#ff7eb6'],
  ['gm', '☀️', 'Good morning', '#ffb300'],
  ['gn', '🌙', 'Good night', '#5c6bc0'],
  ['love', '❤️', 'Love you', '#e53935'],
  ['miss', '🥺', 'Miss you', '#ab47bc'],
  ['lol', '😂', 'LOL', '#fb8c00'],
  ['ok', '👌', 'Okay', '#43a047'],
  ['ty', '🙏', 'Thank you', '#00897b'],
  ['sorry', '🙇', 'Sorry', '#8d6e63'],
  ['wait', '⏳', 'Wait', '#546e7a'],
  ['busy', '📚', 'Busy', '#3949ab'],
  ['omg', '😱', 'OMG', '#d81b60'],
  ['yay', '🥳', 'Yayy', '#f4511e'],
  ['hug', '🤗', 'Hugs', '#ec407a'],
  ['hmph', '😤', 'Hmph', '#c62828'],
  ['sleepy', '😴', 'Sleepy', '#7e57c2'],
  ['hungry', '🍕', 'Hungry', '#ef6c00'],
  ['coffee', '☕', 'Coffee?', '#6d4c41'],
  ['call', '📞', 'Call me', '#1e88e5'],
  ['brb', '🏃', 'BRB', '#00acc1'],
  ['cool', '😎', 'Cool', '#039be5'],
  ['nope', '🙅', 'Nope', '#e53935'],
  ['yes', '✅', 'Yes!', '#2e7d32'],
  ['bye', '👋', 'Bye bye', '#8e24aa'],
].map(([id, emoji, text, color]) => ({ id, emoji, text, color }))

const byId = Object.fromEntries(STICKERS.map((s) => [s.id, s]))

export function StickerArt({ id, size = 130 }) {
  const s = byId[id]
  if (!s) return <div className="sticker-art" style={{ width: size, height: size }}>💟</div>
  return (
    <div className="sticker-art" style={{ width: size, height: size, '--c': s.color }}>
      <span className="sticker-emoji" style={{ fontSize: size * 0.5 }}>{s.emoji}</span>
      <span className="sticker-text" style={{ fontSize: Math.max(13, size * 0.14) }}>{s.text}</span>
    </div>
  )
}

export function StickerPicker({ onPick, onPhoto }) {
  return (
    <div className="sticker-grid">
      <label className="sticker-make" title="Make a sticker from a photo">
        <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; f && onPhoto(f) }} />
        <span>➕</span>
        <small>From photo</small>
      </label>
      {STICKERS.map((s) => (
        <button key={s.id} onClick={() => onPick(s.id)} aria-label={s.text}>
          <StickerArt id={s.id} size={76} />
        </button>
      ))}
    </div>
  )
}

// Make a square sticker image (max 512px) from a photo
export async function photoToSticker(file) {
  const bmp = await createImageBitmap(file)
  const side = Math.min(bmp.width, bmp.height)
  const size = Math.min(512, side)
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')
  ctx.beginPath()
  const r = size * 0.18
  ctx.roundRect ? ctx.roundRect(0, 0, size, size, r) : ctx.rect(0, 0, size, size)
  ctx.clip()
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size)
  const blob = await new Promise((res) => c.toBlob(res, 'image/webp', 0.85))
  const type = blob?.type === 'image/webp' ? 'image/webp' : 'image/png'
  const out = blob?.type === 'image/webp' ? blob : await new Promise((res) => c.toBlob(res, 'image/png'))
  return new File([out], 'sticker.' + (type === 'image/webp' ? 'webp' : 'png'), { type })
}
