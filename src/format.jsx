// WhatsApp-style text formatting:
//   *bold*  _italic_  __underline__  ~strike~  `inline code`  ```code block```  ||spoiler||  + clickable links
import { Fragment, useState } from 'react'

const INLINE = /(https?:\/\/[^\s<]+)|`([^`\n]+)`|\|\|([^\n]+?)\|\||(^|[\s([{"'|])__(?!\s)([^\n]*?[^\s])__(?=$|[\s)\]}.,!?;:"'|])|(^|[\s([{"'|])([*_~])(?!\s)([^\n]*?[^\s])\7(?=$|[\s)\]}.,!?;:"'|])/

const TAGS = { '*': 'strong', _: 'em', '~': 's' }

function Spoiler({ children }) {
  const [shown, setShown] = useState(false)
  return (
    <span
      className={'spoiler' + (shown ? ' shown' : '')}
      onClick={(e) => { e.stopPropagation(); setShown((s) => !s) }}
      title={shown ? 'Tap to hide' : 'Tap to reveal'}
    >{children}</span>
  )
}

function inline(text, keyBase = 'k') {
  const out = []
  let rest = text
  let i = 0
  while (rest) {
    const m = INLINE.exec(rest)
    if (!m) { out.push(rest); break }
    if (m.index) out.push(rest.slice(0, m.index))
    const key = `${keyBase}-${i++}`
    if (m[1]) {
      const url = m[1].replace(/[.,!?;:)]+$/, '') // trailing punctuation is not part of the link
      out.push(<a key={key} href={url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{url}</a>)
      out.push(m[1].slice(url.length))
    } else if (m[2] !== undefined) {
      out.push(<code key={key} className="inline-code">{m[2]}</code>)
    } else if (m[3] !== undefined) {
      out.push(<Spoiler key={key}>{inline(m[3], key)}</Spoiler>)
    } else if (m[5] !== undefined) {
      if (m[4]) out.push(m[4])
      out.push(<u key={key}>{inline(m[5], key)}</u>)
    } else {
      if (m[6]) out.push(m[6])
      const Tag = TAGS[m[7]]
      out.push(<Tag key={key}>{inline(m[8], key)}</Tag>)
    }
    rest = rest.slice(m.index + m[0].length)
  }
  return out
}

export function Rich({ text }) {
  if (!text) return null
  const parts = text.split(/```([\s\S]+?)```/)
  return parts.map((p, i) =>
    i % 2 ? <code key={i} className="code-block">{p.replace(/^\n|\n$/g, '')}</code> : <Fragment key={i}>{inline(p, 'p' + i)}</Fragment>
  )
}

// Plain text with the markers removed; spoilers stay hidden (chat list, reply previews)
export function stripFormat(text = '') {
  let t = text
    .replace(/```([\s\S]+?)```/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\|\|([^\n]+?)\|\|/g, '▒▒▒▒')
  // nested markers (*_like this_*) need a few passes
  for (let i = 0; i < 4; i++) {
    const next = t
      .replace(/(^|[\s([{"'|*_~])__(?!\s)([^\n]*?[^\s])__(?=$|[\s)\]}.,!?;:"'|*_~])/g, '$1$2')
      .replace(/(^|[\s([{"'|*_~])([*_~])(?!\s)([^\n]*?[^\s])\2(?=$|[\s)\]}.,!?;:"'|*_~])/g, '$1$3')
    if (next === t) break
    t = next
  }
  return t
}

// Wrap the selected text in a textarea with a marker (Ctrl+B etc.). Returns the new value + selection.
export function wrapSelection(el, marker) {
  const { selectionStart: a, selectionEnd: b, value } = el
  const sel = value.slice(a, b)
  const [open, close] = Array.isArray(marker) ? marker : [marker, marker]
  // already wrapped → unwrap
  if (value.slice(a - open.length, a) === open && value.slice(b, b + close.length) === close) {
    return { value: value.slice(0, a - open.length) + sel + value.slice(b + close.length), start: a - open.length, end: b - open.length }
  }
  const before = value.slice(0, a)
  const after = value.slice(b)
  if (!sel) return { value: before + open + close + after, start: a + open.length, end: a + open.length }
  // keep spaces outside the markers
  const lead = sel.match(/^\s*/)[0]
  const trail = sel.match(/\s*$/)[0]
  const core = sel.slice(lead.length, sel.length - trail.length)
  return {
    value: before + lead + open + core + close + trail + after,
    start: a + lead.length + open.length,
    end: a + lead.length + open.length + core.length,
  }
}
