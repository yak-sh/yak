import { equal, test } from '@yaks/testing'
import { warmed } from './launch.ts'

let pending = () => {
  let resolve!: () => void
  let promise = new Promise<void>((done) => resolve = done)
  return { promise, resolve }
}

// Independent callers share the same lock and published markers. A fill can
// be held or fail without relying on wall-clock timing or runtime downloads.
let cache = () => {
  let tail = Promise.resolve(), ready = new Set<string>()
  let fills: string[] = [], marks: string[] = []
  let filling = async (_path: string) => {}
  return {
    fills,
    marks,
    fillWith: (fn: typeof filling) => filling = fn,
    lock: async <T>(_root: string, work: () => Promise<T>) => {
      let before = tail, done = pending()
      tail = done.promise
      await before
      try {
        return await work()
      } finally {
        done.resolve()
      }
    },
    has: (path: string) => Promise.resolve(ready.has(path)),
    fill: async (path: string) => {
      fills.push(path)
      await filling(path)
    },
    mark: (path: string) => {
      marks.push(path)
      ready.add(path)
      return Promise.resolve()
    },
  }
}

test('sandbox CLI callers share an unfinished cache fill and reuse each release', async () => {
  let io = cache(), started = pending(), finish = pending()
  io.fillWith(() => {
    started.resolve()
    return finish.promise
  })
  let first = warmed('/cli/one', '/cli', io)
  await started.promise
  let second = warmed('/cli/one', '/cli', io)
  equal(io.marks, [])
  finish.resolve()
  await Promise.all([first, second])
  await warmed('/cli/one', '/cli', io)
  await warmed('/cli/two', '/cli', io)
  await warmed('/cli/one', '/cli', io)
  equal(io.fills, ['/cli/one', '/cli/two'])
  equal(io.marks, ['/cli/one.ready', '/cli/two.ready'])
})

test('sandbox CLI retries a failed fill without publishing readiness or holding the lock', async () => {
  let io = cache(), failed = new Error('download interrupted')
  io.fillWith(() => Promise.reject(failed))
  equal(await warmed('/cli/one', '/cli', io).catch((error) => error), failed)
  equal(io.marks, [])
  io.fillWith(() => Promise.resolve())
  await warmed('/cli/one', '/cli', io)
  await warmed('/cli/one', '/cli', io)
  equal(io.fills, ['/cli/one', '/cli/one'])
  equal(io.marks, ['/cli/one.ready'])
})
