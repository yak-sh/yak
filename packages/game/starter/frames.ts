import { frameLoop } from '@yaks/stage/render'

// The loop rests while the page is hidden, so its first frame back is not
// timed as one long frame.
export let frames = (
  draw: Parameters<typeof frameLoop>[0],
  dispose: () => void,
): void => {
  let pending = 0
  let schedule = (next: FrameRequestCallback) =>
    pending = requestAnimationFrame(next)
  let start = () => {
    if (!pending) schedule(frameLoop(draw, performance.now(), schedule))
  }
  let stop = () => {
    cancelAnimationFrame(pending)
    pending = 0
  }
  addEventListener('pagehide', (event) => {
    stop()
    if (!event.persisted) dispose()
  })
  addEventListener('pageshow', (event) => {
    if (event.persisted) start()
  })
  document.addEventListener(
    'visibilitychange',
    () => document.hidden ? stop() : start(),
  )
  start()
}
