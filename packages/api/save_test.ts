/// <reference lib="deno.ns" />
import { equal, test, throws } from '@yaks/testing'
import { type Bundle, type Comp, graph, Refused } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { fake, req, shop } from './testing.ts'
import { api } from './route.ts'
import { saving } from './save.ts'
import { type Frame, subscriptions } from './subs.ts'

let fixture = () => {
  let vocab = loadVocab([...shop.docs, {
    $defs: {
      position: {
        component: true,
        type: 'object',
        sync: 'peers',
        durable: 'forever',
        save: '1s',
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
  let g = graph({ vocab, storage: ram(vocab) })
  let at = 0
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
  return { g, timer, tick, saved, read, write, commits, failures, timers }
}

test('peer saving merges latest patches once an interval and settles when quiet', () => {
  let f = fixture(), writer = { actor: { by: 'Ada', via: 'browser' } }
  f.saved.write('one', f.write(1), writer)
  equal(f.read(), { x: 1 })
  let created = (f.g.get(['a']) as Bundle[])[0].created as Comp
  equal([created.by, created.via], ['Ada', 'browser'])
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

test('save clocks are per component and entity, and the last writer finishes them', () => {
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
  equal(f.read(), undefined)
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
  let subs = subscriptions(f.g, { timer: f.timer })
  let writer = (frame: Frame) => {
    refused.push(frame)
  }
  await subs.relay(writer, f.write(1))
  await subs.relay(writer, f.write(2))
  permit = false
  await subs.drop(writer)
  equal(f.read(), { x: 1 })
  equal(await subs.snapshot('.position'), [])
  equal(f.timers.size, 0)
  equal(refused[0].refused?.message, 'denied')
})

test('live peer queries use held values while ordinary graph reads retain the save', async () => {
  let f = fixture(), frames: Frame[] = []
  let subs = subscriptions(f.g, { timer: f.timer }), writer = () => {}
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
  let subs = subscriptions(f.g, { timer: f.timer }), writer = () => {}
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
  equal(writes.map((rows) => rows[0].$actor), [{ by: 'Ada', via: 'browser' }, {
    by: 'Ada',
    via: 'browser',
  }])
  equal(writes.map((rows) => rows[0].$speaks), [{ garden: 1 }, { garden: 1 }])
  socket.emit('close')
})
