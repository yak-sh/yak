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
import { feed } from './input.ts'
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
  opts: { backend?: Backend; sheet?: Sheet } = {},
): Promise<void> => {
  let backend = opts.backend ?? ansiBackend({ sheet: opts.sheet })
  let screen = install()
  let host = screen.root as unknown as Parameters<typeof render>[1]
  let done = false
  stop.fn = () => done = true

  let resize = () => {
    size.value = backend.size()
    backend.reset()
    touch()
  }
  let bye = () => {
    render(null, host)
    onPaint(() => {})
    clear()
    screen.free()
    try {
      Deno.removeSignalListener('SIGWINCH', resize)
    } catch { /* never added */ }
    backend.stop()
    try {
      Deno.stdin.setRaw(false)
    } catch { /* not a tty */ }
  }

  Deno.stdin.setRaw(true)
  backend.start()
  size.value = backend.size()
  Deno.addSignalListener('SIGWINCH', resize)
  onPaint(() => measured(backend.draw(screen.root).metrics))
  render(h(App, {}), host)

  let keys = feed()
  let buf = new Uint8Array(4096)
  let dec = new TextDecoder()
  try {
    while (!done) {
      let n = await Deno.stdin.read(buf)
      if (n == null) break
      for (let key of keys(dec.decode(buf.subarray(0, n)))) {
        if (press(key)) continue
        if (key.ctrl && key.text == 'c') done = true
      }
    }
  } finally {
    bye()
  }
}
