// Copy text from a click handler. navigator.clipboard is only there in a
// secure context, and the tailnet page is plain http, so where the modern door
// is shut the text goes through a selection instead.
export let copy = (text: string) => {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => {})
    return
  }
  let t = document.createElement('textarea')
  t.value = text
  t.style.position = 'fixed'
  t.style.opacity = '0'
  document.body.appendChild(t)
  t.select()
  document.execCommand('copy')
  t.remove()
}
