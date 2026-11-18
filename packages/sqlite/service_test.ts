// One cache failure is reported without stopping the other configured caches.
import { equal, test } from '@yaks/testing'
import { service } from './service.ts'

test('cache service reports each failure and continues its pass', async () => {
  let called: string[] = []
  let told: unknown[] = []
  let error = new Error('locked')
  let cache = { most: 100, tables: { entries: 'source' } }
  await service(
    { report: (...args) => told.push(args) },
    {
      caches: { '/first': cache, '/second': cache },
    },
    AbortSignal.abort(),
    (path, options) => {
      called.push(path)
      equal(options, cache)
      return path == '/first' ? Promise.reject(error) : Promise.resolve(0)
    },
  )
  equal(called, ['/first', '/second'])
  equal(told, [[error, { tags: { step: 'cache trim', path: '/first' } }]])
})
