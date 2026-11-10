import { equal, test } from '@yaks/testing'
import { assertRejects } from '@std/assert'
import { portLink } from '@yaks/sync/port'
import { copyErrors, type CopyPage, copyThread } from './copy_thread.ts'
import { CallError, Interrupted } from '@yaks/tools/errors'

let options = () => ({
  spaces: [{ eid: 'store', slug: 'ada' }],
  to: '.scratch/copies',
  stopping: new AbortController().signal,
  page: () => Promise.resolve({ rows: [[1, 'hello']], last: 1 }),
  out: (_line: string) => {},
})

test('copying delegates file work and answers its pages and progress', async () => {
  let { port1, port2 } = new MessageChannel()
  let ended = 0, said: string[] = [], asked: CopyPage[] = []
  let o = options()
  let peer = portLink(port2, {
    ...copyErrors,
    receive: async (method, value) => {
      equal(method, 'run')
      equal(value, { spaces: o.spaces, to: o.to })
      let page = await peer.request('page', {
        space: 'store',
        asked: { table: 'note', after: 0 },
      })
      equal(page, await o.page())
      await peer.request('out', 'ada  1 tables, 1 rows')
    },
  })
  try {
    await copyThread({
      ...o,
      page: (space, query) => {
        asked.push({ space, asked: query })
        return o.page()
      },
      out: (line) => void said.push(line),
    }, () => Object.assign(port1, { terminate: () => ended++ }))
    equal(asked, [{ space: 'store', asked: { table: 'note', after: 0 } }])
    equal(said, ['ada  1 tables, 1 rows'])
    equal(ended, 1)
  } finally {
    peer.close()
    port1.close()
    port2.close()
  }
})

test('stopping a copy lets its worker release the file before ending', async () => {
  let { port1, port2 } = new MessageChannel()
  let entered = Promise.withResolvers<void>()
  let released = Promise.withResolvers<void>()
  let stopping = new AbortController()
  let ended = 0
  let peer = portLink(port2, {
    ...copyErrors,
    receive: (method) => {
      if (method == 'stop') return released.resolve()
      entered.resolve()
      return released.promise
    },
  })
  try {
    let running = copyThread(
      { ...options(), stopping: stopping.signal },
      () => Object.assign(port1, { terminate: () => ended++ }),
    )
    await entered.promise
    stopping.abort()
    equal(ended, 0)
    await running
    equal(ended, 1)
  } finally {
    peer.close()
    port1.close()
    port2.close()
  }
})

test('a failed copy reports the failure and releases its worker', async () => {
  let { port1, port2 } = new MessageChannel()
  let ended = 0
  let peer = portLink(port2, {
    ...copyErrors,
    receive: () => {
      throw new Error('disk full')
    },
  })
  try {
    await assertRejects(
      () =>
        copyThread(
          options(),
          () => Object.assign(port1, { terminate: () => ended++ }),
        ),
      Error,
      'disk full',
    )
    equal(ended, 1)
  } finally {
    peer.close()
    port1.close()
    port2.close()
  }
})

for (
  let failure of [new Interrupted('stopped'), new CallError('access', 'denied')]
) {
  test(`copy preserves ${failure.name} through both message directions`, async () => {
    let { port1, port2 } = new MessageChannel()
    let peer = portLink(port2, {
      ...copyErrors,
      receive: () => peer.request('page', { space: 'store', asked: {} }),
    })
    try {
      await assertRejects(
        () =>
          copyThread({
            ...options(),
            page: () => Promise.reject(failure),
          }, () => Object.assign(port1, { terminate: () => {} })),
        failure.constructor as typeof Error,
        failure.message,
      )
    } finally {
      peer.close()
      port1.close()
      port2.close()
    }
  })
}
