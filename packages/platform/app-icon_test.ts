import { equal, test, throws } from '@yaks/testing'
import { ensureIcon } from './app-icon.ts'

test('a retry after recording fails reuses the generated artwork', async () => {
  let at = {
    space: { store: 'space' },
    app: { eid: 'notes', slug: 'notes', title: 'Notes' },
  }
  let objects = new Map<string, Uint8Array>()
  let drawn = 0
  let recorded = 0
  let run = () =>
    ensureIcon({
      live: () => Promise.resolve(at),
      authored: () => Promise.resolve(false),
      has: (key) => Promise.resolve(objects.has(key)),
      draw: () => Promise.resolve(new Uint8Array([++drawn])),
      put: (key, bytes) => {
        objects.set(key, bytes)
        return Promise.resolve()
      },
      record: () =>
        ++recorded == 1
          ? Promise.reject(new Error('interrupted'))
          : Promise.resolve(),
    })
  await throws(run, /interrupted/)
  await run()
  equal([drawn, recorded, objects.size], [1, 2, 1])
})
