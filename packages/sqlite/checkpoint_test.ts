import { equal, test } from '@yaks/testing'
import { assertThrows } from '@std/assert'
import { checkpoint, pending, perform, type Request } from './checkpoint.ts'

let fixture = () => {
  let queued: Request[] = [], events: string[] = []
  let owner = checkpoint('graph.db', (request) => queued.push(request))
  let open = (path: string) => {
    events.push(`open ${path}`)
    return {
      checkpoint: () => events.push('checkpoint'),
      close: () => events.push('close checkpoint'),
    }
  }
  return { owner, queued, events, open }
}

test('closing cancels queued checkpoints before they can reopen a removed file', () => {
  let { owner, queued, events, open } = fixture()
  owner.run()
  owner.run()
  equal(queued.length, 1)
  owner.close(() => events.push('close database'))
  events.push('remove database')
  owner.run()
  perform(queued[0], open)
  equal(queued.length, 1)
  equal(events, ['close database', 'remove database'])
})

test('reopening the same path does not revive an old checkpoint request', () => {
  let old = fixture(), next = fixture()
  old.owner.run()
  old.owner.close(() => {})
  next.owner.run()
  perform(old.queued[0], next.open)
  perform(next.queued[0], next.open)
  equal(next.events, ['open graph.db', 'checkpoint', 'close checkpoint'])
  next.owner.close(() => {})
})

test('a checkpoint releases its file before accepting another request', () => {
  let { owner, queued, events, open } = fixture()
  owner.run()
  perform(queued[0], (path) => {
    let file = open(path)
    return {
      checkpoint: () => {
        owner.run()
        file.checkpoint()
      },
      close: () => {
        owner.run()
        file.close()
      },
    }
  })
  equal(queued.length, 1)
  equal(events, ['open graph.db', 'checkpoint', 'close checkpoint'])
  owner.run()
  equal(queued.length, 2)
  owner.close(() => {})
})

test('close releases the main handle before waiting for a running checkpoint', () => {
  let queued: Request[] = [], events: string[] = []
  let owner = checkpoint('graph.db', (request) => queued.push(request), () => {
    events.push('wait for checkpoint')
    throw new Error('parked')
  })
  owner.run()
  perform(queued[0], () => ({
    checkpoint: () => {
      assertThrows(
        () => owner.close(() => events.push('close database')),
        Error,
        'parked',
      )
      equal(events, ['close database', 'wait for checkpoint'])
    },
    close: () => events.push('close checkpoint'),
  }))
  owner.close(() => {})
  equal(events, ['close database', 'wait for checkpoint', 'close checkpoint'])
  owner.run()
  equal(queued.length, 1)
})

for (let failure of ['open', 'checkpoint', 'close']) {
  test(`a failed checkpoint ${failure} releases ownership`, () => {
    let { owner, queued, events } = fixture()
    let fail = (at: string) => {
      events.push(at)
      if (failure == at) throw new Error('failed')
    }
    owner.run()
    assertThrows(
      () =>
        perform(queued[0], () => {
          fail('open')
          return {
            checkpoint: () => fail('checkpoint'),
            close: () => fail('close'),
          }
        }),
      Error,
      'failed',
    )
    equal(
      events,
      failure == 'open' ? ['open'] : ['open', 'checkpoint', 'close'],
    )
    owner.run()
    equal(queued.length, 2)
    owner.close(() => {})
  })
}

test('a failed enqueue can be retried', () => {
  let attempts = 0
  let owner = checkpoint('graph.db', () => {
    if (!attempts++) throw new Error('unavailable')
  })
  assertThrows(owner.run, Error, 'unavailable')
  owner.run()
  equal(attempts, 2)
  owner.close(() => {})
})

test('a failed thread lets live owners retry without reviving closed owners', () => {
  let queued: Request[] = [], events: string[] = []
  let thread = pending((request) => queued.push(request))
  let old = checkpoint('graph.db', thread.send)
  let next = checkpoint('graph.db', thread.send)
  old.run()
  old.close(() => {})
  next.run()
  thread.done(queued[0].id)
  thread.failed()
  old.run()
  next.run()
  equal(queued.length, 3)
  perform(queued[0], () => {
    throw new Error('closed database reopened')
  })
  perform(queued[2], () => ({
    checkpoint: () => events.push('checkpoint'),
    close: () => events.push('close'),
  }))
  equal(events, ['checkpoint', 'close'])
  next.close(() => {})
})

test('a delayed reply does not forget a newer request from the same owner', () => {
  let queued: Request[] = []
  let thread = pending((request) => queued.push(request))
  let owner = checkpoint('graph.db', thread.send)
  owner.run()
  perform(queued[0], () => ({ checkpoint: () => {}, close: () => {} }))
  owner.run()
  thread.done(queued[0].id)
  thread.failed()
  owner.run()
  equal(queued.length, 3)
  owner.close(() => {})
})
