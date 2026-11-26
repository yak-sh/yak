import { frameLoop } from '@yaks/stage/render'

export let frames = (
  draw: Parameters<typeof frameLoop>[0],
  dispose: () => void,
): void => {
  let pending: number
  let schedule = (next: FrameRequestCallback) =>
    pending = requestAnimationFrame(next)
  let start = () => schedule(frameLoop(draw, performance.now(), schedule))
  addEventListener('pagehide', (event) => {
    cancelAnimationFrame(pending)
    if (!event.persisted) dispose()
  })
  addEventListener('pageshow', (event) => {
    if (event.persisted) start()
  })
  start()
}
