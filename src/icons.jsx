const I = (props) => <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true" {...props} />

export const Send = () => (
  <I><path d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12.6 2-12.6 2z" /></I>
)
export const Clip = () => (
  <I><path d="M16.5 6v11.5a4 4 0 0 1-8 0V5a2.5 2.5 0 0 1 5 0v10.5a1 1 0 0 1-2 0V6H10v9.5a2.5 2.5 0 0 0 5 0V5a4 4 0 0 0-8 0v12.5a5.5 5.5 0 0 0 11 0V6z" /></I>
)
export const Smile = () => (
  <I><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm-3.5-9A1.5 1.5 0 1 0 8.5 8a1.5 1.5 0 0 0 0 3zm7 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM12 17.5c2.3 0 4.3-1.4 5.1-3.5H6.9c.8 2.1 2.8 3.5 5.1 3.5z" /></I>
)
export const Dots = () => (
  <I><path d="M12 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" /></I>
)
export const Close = () => (
  <I><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6z" /></I>
)
export const Back = () => (
  <I><path d="M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z" /></I>
)
export const Down = () => (
  <I><path d="M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z" /></I>
)
export const Download = () => (
  <I><path d="M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z" /></I>
)
export const Ban = () => (
  <I width="16" height="16"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM4 12a8 8 0 0 1 12.9-6.3L5.7 16.9A8 8 0 0 1 4 12zm8 8a8 8 0 0 1-4.9-1.7L18.3 7.1A8 8 0 0 1 12 20z" /></I>
)
export const Play = () => (
  <I width="48" height="48"><circle cx="12" cy="12" r="11" fill="rgba(0,0,0,.45)" /><path d="M10 8v8l6-4z" fill="#fff" /></I>
)

// Message status: clock (sending), ✓ sent, ✓✓ delivered, blue ✓✓ read, ! failed
export function Ticks({ status }) {
  if (status === 'sending')
    return (
      <svg className="tick" viewBox="0 0 16 16" width="15" height="15"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M8 4.5V8l2.5 1.5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
    )
  if (status === 'failed') return <span className="tick failed">!</span>
  if (status === 'sent')
    return (
      <svg className="tick" viewBox="0 0 16 15" width="16" height="15"><path fill="currentColor" d="M10.9 3.3 10.4 2.9a.4.4 0 0 0-.5.1L4.8 9.4 2.4 7.2a.4.4 0 0 0-.5 0l-.5.5a.4.4 0 0 0 0 .5l3.2 3.1a.4.4 0 0 0 .5 0l5.8-7.4a.4.4 0 0 0 0-.6z" /></svg>
    )
  return (
    <svg className={'tick' + (status === 'read' ? ' read' : '')} viewBox="0 0 16 15" width="16" height="15">
      <path fill="currentColor" d="M15 3.3 14.6 2.9a.4.4 0 0 0-.5.1L8 9.4 7.3 8.7l-.9 1.1 1.4 1.5a.4.4 0 0 0 .5 0L15 3.9a.4.4 0 0 0 0-.6zM10.9 3.3 10.4 2.9a.4.4 0 0 0-.5.1L4.8 9.4 2.4 7.2a.4.4 0 0 0-.5 0l-.5.5a.4.4 0 0 0 0 .5l3.2 3.1a.4.4 0 0 0 .5 0l5.8-7.4a.4.4 0 0 0 0-.6z" />
    </svg>
  )
}
