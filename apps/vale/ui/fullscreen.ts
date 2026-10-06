// Full screen as the browser has it, including leaving it with Escape: on or
// not, busy while a change is asked for, and a toggle that asks for one.
// `changed` hears every change; the tray draws it (hud.ts).
export let fullscreen = (
  doc: Document,
  refused: (error: unknown) => void,
  changed: () => void,
) => {
  if (!doc.fullscreenEnabled) return null
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
      busy = true
      changed()
      try {
        if (doc.fullscreenElement) await doc.exitFullscreen()
        else await doc.documentElement.requestFullscreen()
      } catch (error) {
        refused(error)
      } finally {
        busy = false
        changed()
      }
    },
  }
}
