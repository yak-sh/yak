// When a message was sent, in a few quiet words (operator-view.ts `stamp`):
// how long ago while it is under a day old, else its day. The server says it
// in UTC as it draws the page; the chat page says it again in the person's
// own time, and again each minute (operator-page.ts `chatScript`). Served as
// it is written, like redraw.js.

let dated = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' })
let yeared = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

/**
 * @param {string} iso
 * @param {number} [now]
 */
export function when(iso, now = Date.now()) {
  let at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  let minutes = Math.floor((now - at.getTime()) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  let hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return (at.getFullYear() == new Date(now).getFullYear() ? dated : yeared)
    .format(at)
}

let full = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'full',
  timeStyle: 'short',
})

/**
 * When a message was sent in full, the tooltip over `when`: its day, date and
 * time.
 *
 * @param {string} iso
 */
export function pretty(iso) {
  let at = new Date(iso)
  return Number.isNaN(at.getTime()) ? '' : full.format(at)
}
