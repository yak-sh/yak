import { setClipboard } from './visual.ts'
/**
 * The entry point: take the terminal, mount the app, and give the terminal
 * back. Raw mode and the alt screen go up, the fake document is installed, a
 * dirty tree repaints on the next microtask (so a burst of keys costs one
 * paint), SIGWINCH is a resize and a full repaint, and every exit — a clean
 * quit, a Ctrl-C nobody took, or a throw — runs the restore exactly once.
 *
 * @module
 */

import { type ComponentType, h, render } from 'preact'
import { install, onPaint, touch } from './dom.ts'
import { ansiBackend, type Backend } from './paint.ts'
import { clearMouse, routeMouse } from './mouse.ts'
import type { Line } from './paint.ts'
import { feed } from './input.ts'
import { shutdown } from './shutdown.ts'
import { clear, measured, press, size } from './screen.ts'
import type { Sheet } from './theme.ts'

let stop = { fn: () => {} }

/** Ask the running app to exit; the terminal is restored on the way out. */
export let quit = (): void => stop.fn()

/**
 * Run an app until it quits. `backend` swaps the renderer (the ANSI painter by
 * default); `sheet` extends its theme; Ctrl-C quits unless a widget takes it.
 */
export let run = async (
  App: ComponentType,
  opts: {
    backend?: Backend
    sheet?: Sheet
    graphics?: 'kitty' | 'none'
    tmux?: boolean
    /** First interrupt drains; a second invokes force. Input stays open meanwhile. */
    shutdown?: () => Promise<unknown>
    force?: () => void
  } = {},
): Promise<void> => {
  let backend = opts.backend ??
    ansiBackend({
      sheet: opts.sheet,
      graphics: opts.graphics,
      tmux: opts.tmux,
    })
  let screen = install()
  let host = screen.root as unknown as Parameters<typeof render>[1]
  let cancelRead: (() => Promise<void>) | undefined
  let done = false
  let quitting = shutdown({ drain: opts.shutdown, force: opts.force })
  let interrupt = () => quitting.interrupt()
  let escapeTimer: ReturnType<typeof setTimeout> | undefined
  stop.fn = () => done = true

  let resize = () => {
    size.value = backend.size()
    painted = []
    backend.reset()
    touch()
  }
  let painted: Line[] = []
  let bye = () => {
    clearTimeout(escapeTimer)
    painted = []
    render(null, host)
    onPaint(() => {})
    clearMouse()
    clear()
    screen.free()
    try {
      Deno.removeSignalListener('SIGWINCH', resize)
      Deno.removeSignalListener('SIGINT', interrupt)
    } catch { /* never added */ }
    setClipboard()
    backend.stop()
    try {
      Deno.stdin.setRaw(false)
    } catch { /* not a tty */ }
  }

  try {
    Deno.stdin.setRaw(true)
    backend.start()
    setClipboard(backend.copy ? (text) => backend.copy!(text) : undefined)
    size.value = backend.size()
    Deno.addSignalListener('SIGWINCH', resize)
    Deno.addSignalListener('SIGINT', interrupt)
    onPaint(() => {
      let frame = backend.draw(screen.root)
      painted = frame.lines ?? []
      measured(frame.metrics)
    })
    render(h(App, {}), host)

    let keys = feed((body) => backend.control?.(body))
    let dispatch = (events: ReturnType<typeof keys>) => {
      for (let key of events) {
        if (key.name != 'mouse' && key.ctrl && key.text == 'c') {
          interrupt()
          continue
        }
        if (quitting.draining) continue
        if (key.name == 'mouse') {
          routeMouse(key, painted)
          continue
        }
        if (press(key)) continue
        if (key.ctrl && key.text == 'c') done = true
      }
    }
    let reader = Deno.stdin.readable.getReader()
    cancelRead = () => reader.cancel().catch(() => {})
    let dec = new TextDecoder()
    while (!done) {
      let n = await Promise.race([
        reader.read().then(({ value, done }) => done ? null : value),
        quitting.done.then(() => null),
      ])
      if (n == null) {
        if (!quitting.draining) {
          interrupt()
          await quitting.done
        }
        break
      }
      clearTimeout(escapeTimer)
      dispatch(keys(dec.decode(n, { stream: true })))
      escapeTimer = setTimeout(() => dispatch(keys.flush()), 25)
    }
    clearTimeout(escapeTimer)
  } finally {
    bye()
    // Cancel the pending read after restoring raw mode; it otherwise keeps
    // the process alive after an asynchronous drain completes.
    await cancelRead?.()
  }
}
