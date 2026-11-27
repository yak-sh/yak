import { equal, test } from '@yaks/testing'
import { pageLoop } from './pace.ts'

// A page with one pending frame at a time, a clock and its events.
let page = () => {
  type Listener = (event: { persisted?: boolean }) => void
  let on = new Map<string, Listener>()
  let listen = (name: string, fn: Listener) => on.set(name, fn)
  let unlisten = (name: string) => on.delete(name)
  let queued: FrameRequestCallback | null = null
  let win = {
    now: 0,
    document: {
      hidden: false,
      addEventListener: listen,
      removeEventListener: unlisten,
    },
    performance: { now: () => win.now },
    requestAnimationFrame: (f: FrameRequestCallback) => {
      queued = f
      return 1
    },
    cancelAnimationFrame: () => queued = null,
    addEventListener: listen,
    removeEventListener: unlisten,
    // Run the pending frame at `at` milliseconds.
    tick: (at: number) => {
      let f = queued
      queued = null
      f?.(win.now = at)
    },
    fire: (name: string, persisted?: boolean) => on.get(name)?.({ persisted }),
    on,
  }
  return win
}

test('a page loop rests while hidden, so its first frame back is not one long frame', () => {
  let win = page()
  let frames: number[] = []
  pageLoop((_, dt) => frames.push(dt), () => {}, win as never)
  win.tick(20)
  win.document.hidden = true
  win.fire('visibilitychange')
  win.tick(5000)
  win.now = 9000
  win.document.hidden = false
  win.fire('visibilitychange')
  win.tick(9010)
  equal(frames, [0.02, 0.01])
})

test('a page loop disposes once when the page is left, not when it is cached', () => {
  let win = page()
  let disposed = 0
  pageLoop(() => {}, () => disposed++, win as never)
  win.fire('pagehide', true)
  win.fire('pageshow', true)
  equal(disposed, 0)
  win.fire('pagehide', false)
  win.fire('pagehide', false)
  equal([disposed, win.on.size], [1, 0])
})
