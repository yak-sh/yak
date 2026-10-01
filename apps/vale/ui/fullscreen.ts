// A tray button follows the browser, including leaving full screen with Escape.
export let fullscreen = (
  doc: Document,
  refused: (error: unknown) => void,
) => {
  if (!doc.fullscreenEnabled) return null
  let button = doc.createElement('button')
  button.className = 'Orb Fullscreen'
  button.type = 'button'
  let paint = () => {
    let on = !!doc.fullscreenElement
    let name = on ? 'Leave full screen' : 'Full screen'
    button.title = name
    button.setAttribute('aria-label', name)
    button.setAttribute('aria-pressed', String(on))
    button.classList.toggle('Orb-on', on)
    let path = on
      ? 'M8 3v5H3m18 0h-5V3M3 16h5v5m8 0v-5h5'
      : 'M8 3H3v5m18 0V3h-5M3 16v5h5m8 0h5v-5'
    button.innerHTML = `<svg class="Fullscreen_Icon" viewBox="0 0 24 24"
      aria-hidden="true"><path d="${path}"/></svg>`
  }
  button.addEventListener('click', async () => {
    button.disabled = true
    try {
      if (doc.fullscreenElement) await doc.exitFullscreen()
      else await doc.documentElement.requestFullscreen()
    } catch (error) {
      refused(error)
    } finally {
      button.disabled = false
      paint()
    }
  })
  doc.addEventListener('fullscreenchange', paint)
  paint()
  return button
}
