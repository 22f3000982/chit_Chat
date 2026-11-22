import { useEffect, useState } from 'react'
import { initials, signedUrl } from './utils'
import { supabase } from './supabase'

// Round profile picture, or the first letter of the name if there is no photo
export default function Avatar({ person, className = '', onClick, title }) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    if (!person?.avatar_path) return setUrl(null)
    let alive = true
    signedUrl(person.avatar_path).then((u) => alive && setUrl(u)).catch(() => alive && setUrl(null))
    return () => { alive = false }
  }, [person?.avatar_path])
  return (
    <span className={'avatar ' + className} onClick={onClick} role={onClick ? 'button' : undefined} title={title}>
      {url ? <img src={url} alt="" /> : initials(person?.name)}
    </span>
  )
}

// Square-crop, shrink and upload a new profile photo; returns the updated profile fields
export async function uploadAvatar(me, file) {
  const bmp = await createImageBitmap(file)
  const side = Math.min(bmp.width, bmp.height)
  const size = Math.min(640, side)
  const c = document.createElement('canvas')
  c.width = c.height = size
  c.getContext('2d').drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size)
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85))
  const path = `${me.id}/avatar-${Date.now()}.jpg`
  const up = await supabase.storage.from('media').upload(path, blob, { contentType: 'image/jpeg' })
  if (up.error) throw up.error
  const { error } = await supabase.from('profiles').update({ avatar_path: path }).eq('id', me.id)
  if (error) {
    supabase.storage.from('media').remove([path])
    throw new Error(/column|schema cache/.test(error.message) ? 'Run update_6_profile_photo.sql in Supabase first' : error.message)
  }
  if (me.avatar_path) supabase.storage.from('media').remove([me.avatar_path])
  return { avatar_path: path }
}

export async function removeAvatar(me) {
  const { error } = await supabase.from('profiles').update({ avatar_path: null }).eq('id', me.id)
  if (error) throw error
  if (me.avatar_path) supabase.storage.from('media').remove([me.avatar_path])
  return { avatar_path: null }
}
