import { equal, test } from '@yaks/testing'
import { assertRejects } from '@std/assert'
import { portLink } from '@yaks/sync/port'
import { upkeepThread } from './upkeep_thread.ts'

let draining = await (async () => {
  let { port1, port2 } = new MessageChannel()
  let entered = Promise.withResolvers<unknown>()
  let finished = Promise.withResolvers<void>()
  let stopping = new AbortController()
  let ended = 0
  let errors: unknown[] = []
  let peer = portLink(port2, {
    receive: (method, value) => {
      if (method == 'stop') return finished.resolve()
      entered.resolve(value)
      return finished.promise
    },
  })
  let config = { db: 'graph.db', plugins: ['@yaks/journal'] }
  try {
    let running = upkeepThread(
      config,
      stopping.signal,
      (...e) => errors.push(e),
      () => Object.assign(port1, { terminate: () => ended++ }),
    )
    let sent = await entered.promise
    let before = ended
    await peer.request('analyze', 'disk failure')
    let failure = errors[0] as [Error, string]
    stopping.abort()
    await running
    return {
      sent,
      config,
      before,
      ended,
      failure: [failure[0].message, failure[1]],
    }
  } finally {
    peer.close()
    port1.close()
    port2.close()
  }
})()

test('file upkeep runs beside its caller and drains its write before ending', () => {
  equal(draining.sent, draining.config)
  equal([draining.before, draining.ended], [0, 1])
  equal(draining.failure, ['disk failure', 'analyze'])
})

let failing = await (async () => {
  let { port1, port2 } = new MessageChannel()
  let peer = portLink(port2, {
    receive: () => {
      throw new Error('cannot open')
    },
  })
  let ended = 0
  try {
    await assertRejects(
      () =>
        upkeepThread(
          {},
          new AbortController().signal,
          () => {},
          () =>
            Object.assign(port1, {
              terminate: () => ended++,
            }),
        ),
      Error,
      'cannot open',
    )
    return ended
  } finally {
    peer.close()
    port1.close()
    port2.close()
  }
})()

test('a failed upkeep thread rejects its duty and releases its transport', () => {
  equal(failing, 1)
})

test('stopped upkeep opens no connection', async () => {
  await upkeepThread({}, AbortSignal.abort(), () => {}, () => {
    throw new Error('opened after stop')
  })
})
