let screenCss = new URL('./screen.css', import.meta.url)

/** Apply the viewport surface and safe-area HUD styles to a game page. */
export let screenStyle = (doc: Document): HTMLLinkElement => {
  let sheet = doc.createElement('link')
  sheet.rel = 'stylesheet'
  sheet.href = screenCss.href
  doc.head.append(sheet)
  return sheet
}

type Frames = Pick<
  typeof globalThis,
  | 'ResizeObserver'
  | 'requestAnimationFrame'
  | 'cancelAnimationFrame'
  | 'addEventListener'
  | 'removeEventListener'
  | 'document'
>

/** Run `fit` in the next frame whenever one of `boxes` resizes, the window
 * resizes or fullscreen changes, and once now; several changes in a frame fit
 * once. The fit runs in the frame, never inside the observer's callback: a fit
 * that resizes an observed box there (a canvas's size, an SVG whose `viewBox`
 * sets its height) leaves notifications undelivered, and the browser raises
 * "ResizeObserver loop completed with undelivered notifications". Returns a
 * function that stops it. */
export let fitting = (
  boxes: Element[],
  fit: () => void,
  win: Frames = globalThis,
): () => void => {
  let pending: number | null = null
  let soon = () => {
    pending ??= win.requestAnimationFrame(() => {
      pending = null
      fit()
    })
  }
  let sizes = new win.ResizeObserver(soon)
  for (let box of boxes) sizes.observe(box)
  win.addEventListener('resize', soon)
  win.document.addEventListener('fullscreenchange', soon)
  soon()
  return () => {
    sizes.disconnect()
    win.removeEventListener('resize', soon)
    win.document.removeEventListener('fullscreenchange', soon)
    if (pending != null) win.cancelAnimationFrame(pending)
    pending = null
  }
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
