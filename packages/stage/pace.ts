// When to paint the world: keep its simulation on the screen's clock while
// limiting expensive scene draws to the rate the player chose.
/** Draw at most `rate` frames each second, without drifting behind the screen.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let draw = pace()
 * assertEquals([0, 8, 17, 25, 34].filter((t) => draw(t, 60)), [0, 17, 34])
 * let slower = pace()
 * assertEquals([0, 17, 34, 50, 67].filter((t) => slower(t, 30)), [0, 34, 67])
 * ```
 */
export let pace = (): (now: number, rate: number) => boolean => {
  let next = 0
  return (now: number, rate: number): boolean => {
    if (now + 1 < next) return false
    let step = 1000 / rate
    next = Math.max(next + step, now + step / 2)
    return true
  }
}

/** An animation callback with elapsed time and a bounded simulation step.
 * Scheduling is handed in, so the page owns starting and stopping it. */
export let frameLoop = (
  frame: (now: number, dt: number, elapsed: number) => void,
  then: number,
  schedule: (frame: FrameRequestCallback) => unknown = requestAnimationFrame,
): FrameRequestCallback => {
  let loop = (now: number) => {
    schedule(loop)
    let elapsed = Math.max(0, now - then) / 1000
    then = Math.max(then, now)
    frame(now, Math.min(0.05, elapsed), elapsed)
  }
  return loop
}

type Page = Pick<
  typeof globalThis,
  | 'requestAnimationFrame'
  | 'cancelAnimationFrame'
  | 'addEventListener'
  | 'removeEventListener'
  | 'document'
  | 'performance'
>

/** Run `frame` through {@link frameLoop} while the page is shown. The loop
 * rests while the page is hidden, so its first frame back is not timed as one
 * long frame, and `dispose` runs once when the page is left for good (a
 * `pagehide` not kept in the back/forward cache). Answers a function that
 * stops the loop and disposes now. */
export let pageLoop = (
  frame: (now: number, dt: number, elapsed: number) => void,
  dispose: () => void,
  win: Page = globalThis,
): () => void => {
  let pending = 0
  let schedule = (next: FrameRequestCallback) =>
    pending = win.requestAnimationFrame(next)
  let start = () => {
    if (!pending) schedule(frameLoop(frame, win.performance.now(), schedule))
  }
  let stop = () => {
    win.cancelAnimationFrame(pending)
    pending = 0
  }
  let shown = () => win.document.hidden ? stop() : start()
  let back = (event: PageTransitionEvent) => {
    if (event.persisted) start()
  }
  let hide = (event: PageTransitionEvent) => event.persisted ? stop() : leave()
  let leave = () => {
    stop()
    win.removeEventListener('pagehide', hide)
    win.removeEventListener('pageshow', back)
    win.document.removeEventListener('visibilitychange', shown)
    dispose()
  }
  win.addEventListener('pagehide', hide)
  win.addEventListener('pageshow', back)
  win.document.addEventListener('visibilitychange', shown)
  start()
  return leave
}
