import { equal, test } from '@yaks/testing'
import { detached } from '@yaks/graph/storage'
import { docDoc } from '@yaks/doc'
import { compose } from './host.ts'
import type { Facets, Load } from '@yaks/host'

let load: Load = <F extends keyof Facets>(_plugin: string, facet: F) =>
  Promise.resolve(
    (facet == 'vocab' ? { docs: [docDoc] } : null) as Facets[F] | null,
  )

let reads = await (async () => {
  let host = await compose(
    { db: ':memory:', plugins: ['fixture'] },
    ['graph'],
    load,
    {
      process: false,
      reader: {
        read: () => [],
        rows: () => [],
        get: () => [],
        storage: {
          read: () => [],
          rows: () => [],
          get: () => [{
            entity: { eid: 'x' },
            doc: { title: 'committed reader' },
          }],
        },
      },
    },
  )
  try {
    return {
      outside: await detached(host.storage).get(['x']),
      transaction: await host.storage.tx((tx) => tx.get(['x'])),
    }
  } finally {
    await host.close()
  }
})()

test('direct host storage reads use the committed reader while transactions retain their owner', () => {
  equal(reads.outside, [{
    entity: { eid: 'x' },
    doc: { title: 'committed reader' },
  }])
  equal(reads.transaction, [])
})
