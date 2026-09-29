// One browser worker answers completed item pictures by request number. Only
// canvas painting crosses the thread; page rendering keeps its own cache.
import type { Thing } from './items.ts'
import type { Answer } from './sprite-worker.ts'

let worker: Worker | undefined
let count = 0
let pending = new Map<number, {
  done: (blob: Blob) => void
  fail: (error: Error) => void
}>()

let stop = (error: Error) => {
  for (let asked of pending.values()) asked.fail(error)
  pending.clear()
  worker?.terminate()
  worker = undefined
}

let start = () => {
  if (worker) return worker
  let w = new Worker(new URL('./sprite-worker.ts', import.meta.url), {
    type: 'module',
  })
  w.onmessage = ({ data }: MessageEvent<Answer>) => {
    let asked = pending.get(data.n)
    pending.delete(data.n)
    if (!asked) return
    if (data.blob) asked.done(data.blob)
    else asked.fail(new Error(data.error ?? 'Sprite worker returned no image'))
  }
  w.onerror = (event) => {
    event.preventDefault()
    stop(new Error(event.message || 'Sprite worker failed'))
  }
  return worker = w
}

/** A completed PNG, without blocking the page while it is painted. */
export let painted = (item: Thing): Promise<Blob> =>
  new Promise((done, fail) => {
    let n = count++
    pending.set(n, { done, fail })
    try {
      start().postMessage({ n, item })
    } catch (error) {
      pending.delete(n)
      fail(error instanceof Error ? error : new Error(String(error)))
    }
  })
