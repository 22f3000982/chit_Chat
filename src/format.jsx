// WhatsApp-style text formatting:
//   *bold*  _italic_  ~strike~  `inline code`  ```code block```   + clickable links
import { Fragment } from 'react'

const INLINE = /(https?:\/\/[^\s<]+)|`([^`\n]+)`|(^|[\s([{"'])([*_~])(?!\s)([^\n]*?[^\s])\4(?=$|[\s)\]}.,!?;:"'])/

const TAGS = { '*': 'strong', _: 'em', '~': 's' }

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
      // trailing punctuation is not part of the link
      const url = m[1].replace(/[.,!?;:)]+$/, '')
      out.push(<a key={key} href={url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{url}</a>)
      out.push(m[1].slice(url.length))
    } else if (m[2] !== undefined) {
      out.push(<code key={key} className="inline-code">{m[2]}</code>)
    } else {
      if (m[3]) out.push(m[3])
      const Tag = TAGS[m[4]]
      out.push(<Tag key={key}>{inline(m[5], key)}</Tag>)
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

// Plain text with the markers removed (for chat list previews and notifications)
export function stripFormat(text = '') {
  return text.replace(/```([\s\S]+?)```/g, '$1').replace(/`([^`\n]+)`/g, '$1')
    .replace(/(^|[\s([{"'])([*_~])(?!\s)([^\n]*?[^\s])\2(?=$|[\s)\]}.,!?;:"'])/g, '$1$3')
}
