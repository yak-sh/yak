/**
 * The entry point: take the terminal, mount the app, and give the terminal
 * back. Raw mode and the alt screen go up, the fake document is installed, a
 * dirty tree repaints on the next microtask (so a burst of keys costs one
 * paint), SIGWINCH is a resize and a full repaint, and every exit — a clean
 * quit, an interrupt, a throw, an uncaught error or rejection anywhere, or a
 * Deno.exit — gives the terminal back exactly once.
 *
 * Ctrl-C is the process's interrupt, the same one a signal is
 * (@yaks/process/wind): the terminal holds the process open while it winds
 * down, so the first waits for what the mounted components are finishing and
 * a second forces them, and the process ends once the terminal is given back.
 *
 * @module
 */

import { type ComponentType, h, render } from 'preact'
import { useEffect } from 'preact/hooks'
import { type Hold, listen, wind } from '@yaks/process/wind'
import { install, onPaint, touch } from './dom.ts'
import { ansiBackend, type Backend } from './paint.ts'
import { clearMouse, routeMouse } from './mouse.ts'
import type { Line } from './paint.ts'
import { feed } from './input.ts'
import { clear, measured, press, size } from './screen.ts'
import type { Sheet } from './theme.ts'
import { setClipboard } from './visual.ts'

let stop = { fn: () => {} }

// What the mounted components are still finishing: an app that is one view
// among others holds the exit the same way.
let holds = new Set<Hold>()

/** Hold the exit open while this component finishes: the first interrupt
 * waits for `drain`, a second calls `force`. Let go when it unmounts. */
export let useHold = (
  drain: () => Promise<unknown>,
  force?: () => void,
): void =>
  useEffect(() => {
    let hold = { drain, force }
    holds.add(hold)
    return () => void holds.delete(hold)
  }, [drain, force])

let attempt = (fn: () => unknown) => {
  try {
    fn()
  } catch { /* the rest still runs */ }
}

let once = (fn: () => void) => {
  let done = false
  return () => {
    if (done) return
    done = true
    fn()
  }
}

/**
 * Call `release` when the process ends without unwinding: an uncaught error,
 * an unhandled rejection, or `unload` (Deno.exit, or the event loop running
 * dry). An event a listener prevented does not end the process, so it
 * releases nothing. Returns the function that stops listening.
 */
export let fatal = (target: EventTarget, release: () => void): () => void => {
  let on = (event: Event) => event.defaultPrevented || release()
  let types = ['error', 'unhandledrejection', 'unload']
  for (let type of types) target.addEventListener(type, on)
  return () => {
    for (let type of types) target.removeEventListener(type, on)
  }
}

/** Ask the running app to exit; the terminal is restored on the way out. */
export let quit = (): void => stop.fn()

/**
 * Run an app until it quits. `backend` swaps the renderer (the ANSI painter by
 * default); `sheet` extends the widgets' `base`, and as a function it is read
 * at every paint; Ctrl-C interrupts the process ({@link useHold}).
 */
export let run = async (
  App: ComponentType,
  opts: {
    screen?: ReturnType<typeof install>
    backend?: Backend
    sheet?: Sheet | (() => Sheet)
    graphics?: 'kitty' | 'none'
    tmux?: boolean
  } = {},
): Promise<void> => {
  let backend = opts.backend ??
    ansiBackend({
      sheet: opts.sheet,
      // What this terminal can do, unless the caller says: inside tmux, and
      // whether it draws kitty graphics (HARNESS_GRAPHICS=kitty).
      graphics: opts.graphics ??
        (Deno.env.get('HARNESS_GRAPHICS') == 'kitty' ? 'kitty' : 'none'),
      tmux: opts.tmux ?? !!Deno.env.get('TMUX'),
    })
  let screen = opts.screen ?? install()
  let host = screen.root as unknown as Parameters<typeof render>[1]
  let cancelRead: (() => Promise<void>) | undefined
  let done = false
  // The terminal's hold on the process: the input loop ends once the
  // components have drained, or been forced, and the hold is answered once
  // the terminal is given back. A drain that fails ends it too, and `run`
  // throws what it threw.
  let ending = Promise.withResolvers<void>()
  let given = Promise.withResolvers<void>()
  let failure: unknown
  let unhold = wind.hold({
    drain: async () => {
      try {
        await Promise.all([...holds].map((d) => d.drain()))
      } catch (error) {
        failure ??= error
      }
      ending.resolve()
      await given.promise
    },
    force: () => {
      for (let d of holds) d.force?.()
      ending.resolve()
      return given.promise
    },
  })
  let unlisten = listen()
  let interrupt = () => wind.interrupt(130)
  let escapeTimer: ReturnType<typeof setTimeout> | undefined
  stop.fn = () => {
    done = true
    ending.resolve()
  }

  let resize = () => {
    size.value = backend.size()
    painted = []
    backend.reset()
    touch()
  }
  let painted: Line[] = []
  // The terminal given back, once: every mode the backend turned on, then
  // cooked input. Each step runs even when one before it throws (a terminal
  // gone after SIGHUP refuses the write).
  let release = once(() => {
    attempt(() => setClipboard())
    attempt(() => backend.stop())
    attempt(() => Deno.stdin.setRaw(false))
  })
  // A throw nobody caught (a render that crashes), a rejection nobody
  // handled, or a Deno.exit from anywhere ends the process without reaching
  // the finally below: the terminal is given back on the way out all the same.
  let unguard = fatal(globalThis, release)
  let bye = () => {
    clearTimeout(escapeTimer)
    painted = []
    attempt(() => render(null, host))
    onPaint(() => {})
    clearMouse()
    clear()
    screen.free()
    try {
      Deno.removeSignalListener('SIGWINCH', resize)
    } catch { /* never added */ }
    release()
    unguard()
  }

  try {
    Deno.stdin.setRaw(true)
    backend.start()
    setClipboard(backend.copy ? (text) => backend.copy!(text) : undefined)
    size.value = backend.size()
    Deno.addSignalListener('SIGWINCH', resize)
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
        if (wind.draining) continue
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
        ending.promise.then(() => null),
      ])
      if (n == null) {
        // Input that ended is an interrupt nobody typed.
        if (!wind.draining) {
          interrupt()
          await ending.promise
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
    unlisten()
    unhold()
    // Cancel the pending read after restoring raw mode; it otherwise keeps
    // the process alive after an asynchronous drain completes.
    await cancelRead?.()
    given.resolve()
  }
  if (failure) throw failure
}
