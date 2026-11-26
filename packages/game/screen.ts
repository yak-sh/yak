let screenCss = new URL('./screen.css', import.meta.url)

/** Apply the viewport surface and safe-area HUD styles to a game page. */
export let screenStyle = (doc: Document): HTMLLinkElement => {
  let sheet = doc.createElement('link')
  sheet.rel = 'stylesheet'
  sheet.href = screenCss.href
  doc.head.append(sheet)
  return sheet
}

export type Fullscreen = {
  readonly on: boolean
  readonly busy: boolean
  toggle: () => Promise<void>
  dispose: () => void
}

/** Follow fullscreen changes from the browser, including Escape. */
export let fullscreen = (
  doc: Document,
  refused: (error: unknown) => void,
  changed: () => void,
): Fullscreen | null => {
  let root = doc.documentElement
  if (
    !doc.fullscreenEnabled || !root.requestFullscreen || !doc.exitFullscreen
  ) return null

  let busy = false
  doc.addEventListener('fullscreenchange', changed)
  return {
    get on() {
      return !!doc.fullscreenElement
    },
    get busy() {
      return busy
    },
    toggle: async () => {
      if (busy) return
      busy = true
      changed()
      try {
        if (doc.fullscreenElement) await doc.exitFullscreen()
        else await root.requestFullscreen()
      } catch (error) {
        refused(error)
      } finally {
        busy = false
        changed()
      }
    },
    dispose: () => doc.removeEventListener('fullscreenchange', changed),
  }
}

/** Attach the fullscreen control to a page's button. */
export let fullscreenButton = (
  button: HTMLButtonElement,
  refused: (error: unknown) => void,
): () => void => {
  let doc = button.ownerDocument
  let installedFullscreen = !doc.fullscreenElement &&
    doc.defaultView?.matchMedia?.('(display-mode: fullscreen)').matches
  if (installedFullscreen) {
    button.hidden = true
    return () => {}
  }
  let draw = () => {
    if (!screen) return
    button.disabled = screen.busy
    button.textContent = screen.on ? 'Exit fullscreen' : 'Enter fullscreen'
  }
  let screen = fullscreen(doc, refused, draw)
  button.hidden = !screen
  if (!screen) return () => {}
  draw()
  button.addEventListener('click', screen.toggle)
  return () => {
    screen.dispose()
    button.removeEventListener('click', screen.toggle)
    button.hidden = true
  }
}
