/// <reference lib="deno.ns" />
import { equal, test, throws } from '@yaks/testing'
import { type Bundle, type Comp, graph, Refused } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { fake, req, shop } from './testing.ts'
import { api } from './route.ts'
import { saving } from './save.ts'
import { type Frame, subscriptions } from './subs.ts'

let fixture = (
  query = '!position | .updated.at<="1s ago"',
  extra: VocabDoc[] = [],
) => {
  let vocab = loadVocab([...shop.docs, ...extra, {
    $defs: {
      position: {
        component: true,
        type: 'object',
        sync: 'peers',
        durable: 'forever',
        save: query,
        properties: { x: { type: 'number' }, y: { type: 'number' } },
      },
      created: {
        component: true,
        extends: true,
        type: 'object',
        properties: { via: { type: 'string', stamped: true } },
      },
      updated: {
        component: true,
        extends: true,
        type: 'object',
        properties: { via: { type: 'string', stamped: true } },
      },
    },
  }])
  let at = Date.now()
  let g = graph({
    vocab,
    storage: ram(vocab),
    clock: () => new Date(at).toISOString(),
  })
  g.apply([{ entity: { eid: 'a' } }, { entity: { eid: 'b' } }])
  let timers = new Set<{ at: number; fn: () => void }>()
  let timer = (fn: () => void, after: number) => {
    let t = { at: at + after, fn }
    timers.add(t)
    return () => {
      timers.delete(t)
    }
  }
  let tick = (ms: number) => {
    at += ms
    for (let t of [...timers]) {
      if (t.at <= at) {
        timers.delete(t)
        t.fn()
      }
    }
  }
  let commits: Bundle[][] = []
  g.use({
    name: 'record',
    hooks: {
      effect: (b) => {
        commits.push(b)
        return b
      },
    },
  })
  let failures: unknown[] = []
  let saved = saving<string>(g, timer, (_, err) => {
    failures.push(err)
  }, () => at)
  let read = (id = 'a') => (g.get([id]) as Bundle[])[0]?.position
  let write = (
    x: number | null,
    id = 'a',
  ) => [{ entity: { eid: id }, position: x == null ? null : { x } }]
  return {
    g,
    timer,
    tick,
    saved,
    read,
    write,
    commits,
    failures,
    timers,
    now: () => at,
  }
}

test('peer saving merges latest patches once an interval and settles when quiet', () => {
  let f = fixture(), writer = { actor: { by: 'Ada', via: 'browser' } }
  f.saved.write('one', f.write(1), writer)
  equal(f.read(), { x: 1 })
  let updated = (f.g.get(['a']) as Bundle[])[0].updated as Comp
  equal([updated.by, updated.via], ['Ada', 'browser'])
  f.saved.write('one', f.write(2), writer)
  f.saved.write('one', [{ entity: { eid: 'a' }, position: { y: 3 } }], writer)
  equal(f.read(), { x: 1 })
  equal(f.commits.length, 1)
  f.tick(999)
  equal(f.read(), { x: 1 })
  f.tick(1)
  equal(f.read(), { x: 2, y: 3 })
  equal(f.commits.length, 2)
  equal(f.timers.size, 0)
  f.tick(10000)
  equal(f.commits.length, 2)
})

test('pending saves stay with the last writer after disconnect', () => {
  let f = fixture()
  f.saved.write('one', f.write(1))
  f.saved.write('one', f.write(2))
  f.saved.write('two', [{ entity: { eid: 'a' }, position: { y: 3 } }], {
    actor: { by: 'Bea' },
  })
  f.saved.write('one', f.write(4, 'b'))
  equal(f.read('b'), { x: 4 })
  f.saved.drop('one')
  equal(f.read(), { x: 1 })
  f.saved.drop('two')
  equal(f.read(), { x: 1 })
  f.tick(1000)
  equal(f.read(), { x: 2, y: 3 })
  equal(
    (f.g.get(['a']) as Bundle[])[0].updated &&
      ((f.g.get(['a']) as Bundle[])[0].updated as Comp).by,
    'Bea',
  )
  equal(f.timers.size, 0)
})

test('a clear removes the saved value and its pending timer', () => {
  let f = fixture()
  f.saved.write('one', f.write(1))
  f.saved.write('one', f.write(2))
  f.saved.write('one', f.write(null))
  equal(f.read(), { x: 1 })
  f.tick(1000)
  f.saved.drop('one')
  equal(f.read(), undefined)
  equal(f.timers.size, 0)
})

test('a refused takeover cannot poison a legitimate pending save', () => {
  let f = fixture(), writer = { actor: { by: 'Ada' } }
  f.g.use({
    name: 'ownership',
    hooks: {
      precondition: (b) => {
        if (b.some((row) => row.$actor?.by != 'Ada')) throw new Error('denied')
        return b
      },
    },
  })
  f.saved.write('one', f.write(1), writer)
  f.saved.write('one', f.write(2), writer)
  throws(() => f.saved.write('two', f.write(9), { actor: { by: 'Bea' } }))
  f.tick(1000)
  equal(f.read(), { x: 2 })
  equal(f.failures, [])
})

test('a refusal at save time is reported to its writer and can finish on close', () => {
  let f = fixture(), permit = true
  f.g.use({
    name: 'permission',
    hooks: {
      precondition: (b) => {
        if (!permit) throw new Error('denied')
        return b
      },
    },
  })
  f.saved.write('one', f.write(1))
  f.saved.write('one', f.write(2))
  permit = false
  f.tick(1000)
  equal(f.failures.length, 1)
  equal(f.read(), { x: 1 })
  permit = true
  f.saved.drop('one')
  equal(f.read(), { x: 2 })
})

test('a refused final save still releases the connection and its timers', async () => {
  let f = fixture(), permit = true, refused: Frame[] = []
  f.g.use({
    name: 'permission',
    hooks: {
      precondition: (b) => {
        if (!permit) throw new Refused('denied')
        return b
      },
    },
  })
  let subs = subscriptions(f.g, { timer: f.timer, now: f.now })
  let writer = (frame: Frame) => {
    refused.push(frame)
  }
  await subs.relay(writer, f.write(1))
  await subs.relay(writer, f.write(2))
  permit = false
  f.tick(1000)
  await subs.drop(writer)
  equal(f.read(), { x: 1 })
  equal(await subs.snapshot('.position'), [])
  equal(f.timers.size, 0)
  equal(refused[0].refused?.message, 'denied')
})

test('live peer queries use held values while ordinary graph reads retain the save', async () => {
  let f = fixture(), frames: Frame[] = []
  let subs = subscriptions(f.g, { timer: f.timer, now: f.now }),
    writer = () => {}
  await subs.relay(writer, f.write(1), { actor: { by: 'Ada' } })
  await subs.relay(writer, f.write(2), { actor: { by: 'Ada' } })
  equal(f.read(), { x: 1 })
  equal((await subs.snapshot('.position') as Bundle[])[0].position, { x: 2 })
  subs.open(
    (frame) => {
      frames.push(frame)
    },
    'negative',
    '.entity&!position',
  )
  await subs.drop(writer)
  f.tick(1000)
  equal(f.read(), { x: 2 })
  equal(await subs.snapshot('.position'), [])
  equal(
    (await subs.snapshot('.entity.eid=a&!position') as Bundle[]).map((b) =>
      b.entity.eid
    ),
    ['a'],
  )
  equal(
    frames.some((frame) => frame.bundles?.some((b) => b.entity.eid == 'a')),
    true,
  )
})

test('durable updates keep newer held positions and respect field projections', async () => {
  let f = fixture(),
    frames: Frame[] = [],
    projected: Frame[] = [],
    raw: Frame[] = []
  let subs = subscriptions(f.g, { timer: f.timer, now: f.now }),
    writer = () => {}
  await subs.relay(writer, [{ entity: { eid: 'a' }, position: { x: 1, y: 3 } }])
  await subs.relay(writer, f.write(2))
  await subs.open(
    (frame) => {
      frames.push(frame)
    },
    'all',
    '.entity.eid=a&*',
  )
  equal(frames.shift()?.bundles?.[0].position, { x: 1, y: 3 })
  await subs.open(
    (frame) => {
      projected.push(frame)
    },
    'x',
    '.entity.eid=a&.fields=position.x',
  )
  projected.length = 0
  await subs.open(
    (frame) => {
      raw.push(frame)
    },
    'raw',
    true,
  )
  await f.g.apply([{ entity: { eid: 'a' }, position: { x: 0, y: 9 } }])
  // Drain the registry's ordered delivery before examining what was sent.
  await subs.snapshot('.entity.eid=a')
  equal(frames.at(-1)?.bundles?.[0].position, { x: 2, y: 3 })
  equal(projected.at(-1)?.bundles?.[0].position, { x: 2 })
  equal(raw.at(-1)?.bundles?.[0].position, { x: 0, y: 9 })
  await subs.drop(writer)
})

test('the socket saves with its authenticated actor and vocabulary versions', async () => {
  let f = fixture(), socket = fake(), writes: Bundle[][] = []
  f.g.use({ name: 'dialect', requests: ['$speaks'] })
  let g = {
    ...f.g,
    apply: (bundles: Bundle[], opts?: Parameters<typeof f.g.apply>[1]) => {
      writes.push(bundles)
      return f.g.apply(bundles, opts)
    },
  }
  let handler = api({
    graph: g,
    authenticate: () => ({ by: 'Ada', via: 'browser' }),
    read: () => ({ speaks: { garden: 1 } }),
    upgrade: () => ({ socket, response: new Response(null, { status: 101 }) }),
  })
  await handler(req('/ws', { headers: { upgrade: 'websocket' } }))
  socket.emit(
    'message',
    JSON.stringify({ relay: [{ ...f.write(1)[0], $actor: { by: 'thief' } }] }),
  )
  equal(socket.taken().map((f) => f.refused), [])
  equal(f.read(), { x: 1 })
  equal(writes.map((rows) => rows[0].$actor), [{ by: 'Ada', via: 'browser' }])
  equal(writes.map((rows) => rows[0].$speaks), [{ garden: 1 }])
  socket.emit('close')
})

test('save queries select stored entities, never the incoming value', () => {
  let f = fixture('.book.status=shelved')
  f.g.apply([{ entity: { eid: 'a' }, book: { status: 'draft' } }])
  f.saved.write('one', f.write(7))
  f.saved.drop('one')
  f.tick(1000)
  equal(f.read(), undefined)
  f.g.apply([{ entity: { eid: 'a' }, book: { status: 'shelved' } }])
  f.tick(1000)
  equal(f.read(), { x: 7 })
  equal(f.timers.size, 0)
})

test('a query that never matches never saves, including clears and disconnect', () => {
  let f = fixture('.book.status=shelved')
  f.saved.write('one', f.write(8))
  f.saved.write('one', f.write(null))
  f.saved.drop('one')
  f.tick(1000)
  equal(f.read(), undefined)
  equal(f.commits.length, 0)
})

test('disconnecting an ineligible timed save settles until storage can change eligibility', () => {
  let f = fixture('.book (!position | .updated.at<="1s ago")')
  let reads = 0
  let read = f.g.read.bind(f.g)
  f.g.read = (...args) => {
    reads++
    return read(...args)
  }
  f.saved.write('wildlife', f.write(7))
  f.saved.drop('wildlife')
  f.tick(1000)
  equal(f.timers.size, 0)
  let settled = reads
  for (let i = 0; i < 60; i++) f.tick(1000)
  equal(reads, settled)
  equal(f.commits.length, 0)
  f.g.apply([{ entity: { eid: 'b' }, book: { status: 'draft' } }])
  equal(f.timers.size, 0)
  equal(reads, settled)
  // The pending admitted value is not thrown away: eligibility is a stored
  // fact, and a commit making it true must wake it without clock polling.
  f.g.apply([{ entity: { eid: 'a' }, book: { status: 'draft' } }])
  f.tick(0)
  equal(f.read(), { x: 7 })
  equal(f.timers.size, 0)
})

test('save queries without a clock wake on relevant commits, not periodic reads', () => {
  let f = fixture('.book.status=shelved')
  f.g.apply([{ entity: { eid: 'a' }, book: { status: 'draft' } }])
  f.saved.write('one', f.write(7))
  f.saved.drop('one')
  equal(f.timers.size, 0)
  f.g.apply([{ entity: { eid: 'a' }, book: { status: 'shelved' } }])
  equal(f.timers.size, 1)
  f.tick(0)
  equal(f.read(), { x: 7 })
  equal(f.timers.size, 0)
})

test('a relevant commit during an asynchronous eligibility read is rechecked', async () => {
  let f = fixture('.book.status=shelved')
  f.g.apply([{ entity: { eid: 'a' }, book: { status: 'draft' } }])
  let read = f.g.read.bind(f.g), release!: () => void, first = true
  f.g.read = (...args) => {
    let rows = read(...args)
    if (!first) return rows
    first = false
    return new Promise<Bundle[]>((resolve) =>
      release = () => resolve(rows as Bundle[])
    )
  }
  let writing = f.saved.write('one', f.write(7))
  f.g.apply([{ entity: { eid: 'a' }, book: { status: 'shelved' } }])
  release()
  await writing
  f.tick(0)
  equal(f.read(), { x: 7 })
  equal(f.timers.size, 0)
})

test('a negated association time condition can become eligible without a commit', () => {
  let f = fixture('.book .reviews!.created.at>"1s ago"')
  f.g.apply([{ entity: { eid: 'a' }, book: { status: 'draft' } }, {
    entity: { eid: 'review' },
    review: { book: 'a' },
  }])
  f.saved.write('one', f.write(7))
  f.saved.drop('one')
  equal(f.read(), undefined)
  equal(f.timers.size, 1)
  f.tick(1001)
  equal(f.read(), { x: 7 })
  equal(f.timers.size, 0)
})

test('computed eligibility wakes on its referenced dependency', () => {
  let f = fixture('.book.ready=1', [{
    $defs: {
      book: {
        component: true,
        extends: true,
        type: 'object',
        properties: {
          ready: { type: 'number', computed: true, reads: ['review.book'] },
        },
      },
    },
  }])
  let read = f.g.read.bind(f.g)
  // Stand in only for computing the property; dependency metadata and the
  // real save boundary decide whether a referenced commit wakes the value.
  f.g.read = (q, opts) =>
    JSON.stringify(q).includes('ready')
      ? (read('.review.book=a', opts) as Bundle[]).length
        ? read('.entity.eid=a', opts)
        : []
      : read(q, opts)
  f.g.apply([{ entity: { eid: 'a' }, book: { status: 'draft' } }])
  f.saved.write('one', f.write(7))
  f.saved.drop('one')
  equal(f.timers.size, 0)
  f.g.apply([{ entity: { eid: 'review' }, review: { book: 'a' } }])
  f.tick(0)
  equal(f.read(), { x: 7 })
  equal(f.timers.size, 0)
})

test('a failed eligibility read can wake again on a relevant stored change', async () => {
  let f = fixture('.book.status=shelved')
  f.g.apply([{ entity: { eid: 'a' }, book: { status: 'draft' } }])
  f.saved.write('one', f.write(7))
  let read = f.g.read.bind(f.g), broken = true
  f.g.read = (...args) =>
    broken ? Promise.reject(new Error('read failed')) : read(...args)
  f.g.apply([{ entity: { eid: 'a' }, book: { price: 3 } }])
  f.tick(0)
  await Promise.resolve()
  await Promise.resolve()
  broken = false
  f.g.apply([{ entity: { eid: 'a' }, book: { status: 'shelved' } }])
  f.tick(0)
  equal(f.read(), { x: 7 })
  equal(f.timers.size, 0)
})
