import { assertEquals } from '@std/assert'
import { detached } from '@yaks/graph'
import { effects } from './mod.ts'
import { blog, blogGraph } from './harness.ts'
import type { Event } from './mod.ts'

let birth: Event = {
  kind: 'created',
  entity: { eid: 'p' },
  name: 'post',
  comp: { title: 'one' },
}

Deno.test('consumer ownership applies to plugin, external dispatch, attempt and relay', async () => {
  let heard: string[] = []
  let fx = effects(blog, { want: (w) => w == 'serve' })
  for (let where of ['do', 'serve']) {
    fx.on('post', {
      where,
      created: () => heard.push(where),
      sweep: { pending: where },
    })
  }
  let g = blogGraph([fx])
  await g.apply([{ entity: { eid: 'p' }, post: { title: 'one' } }])
  await fx.dispatch([birth])
  assertEquals(
    await fx.attempt('post.created', birth, detached(g.storage)),
    false,
  )
  let asked: string[] = []
  await fx.relay((_comp, pending) => {
    asked.push(pending)
    return [{ eid: 'p' }]
  })
  assertEquals(heard, ['serve', 'serve', 'serve'])
  assertEquals(asked, ['serve'])
  await fx.dispatch([birth], undefined, { want: (w) => w == 'do' })
  assertEquals(heard.at(-1), 'do')
})

Deno.test('pending sweeps fire once, isolate fetch/row failures, and skip settled work', async () => {
  let pending = new Set(['sync-bad', 'async-bad', 'good', 'other'])
  let ran: string[] = [], failed: string[] = []
  let fx = effects(blog, {
    report: (_e, job) => {
      failed.push(job.handler)
    },
  })
  fx.on('broken', { created: () => {}, sweep: { pending: 'broken' } })
  fx.on('post', {
    sweep: { pending: 'unacted' },
    created: (e) => {
      let id = e.entity.eid
      ran.push(id)
      pending.delete(id)
      if (id == 'sync-bad') throw Error('sync')
      if (id == 'async-bad') return Promise.reject(Error('async'))
    },
  })
  fx.on('post', { created: () => ran.push('no sweep') })
  let rows = (comp: string) => {
    if (comp == 'broken') throw Error('fetch')
    return [...pending].map((eid) => ({ eid }))
  }
  let first = fx.relay(rows)
  assertEquals(
    ran,
    ['sync-bad', 'async-bad', 'good', 'other'],
    'sync fetch starts every row eagerly',
  )
  assertEquals((await first).length, 4)
  assertEquals((await fx.relay(rows)).length, 0)
  assertEquals(failed, [
    'broken.created',
    'post.created',
    'post.created',
    'broken.created',
  ])
})

Deno.test('failing reporters cannot break a batch, consumer or sibling', async () => {
  let ran = 0
  let fx = effects(blog, {
    report: () => {
      throw Error('telemetry unavailable')
    },
  })
  fx.created('post', () => {
    throw Error('sync')
  })
  fx.created('post', () => Promise.reject(Error('async')))
  fx.created('post', () => {
    ran++
  })
  await blogGraph([fx]).apply([{ entity: { eid: 'p' }, post: {} }])
  await fx.dispatch([birth], undefined, {
    report: () => {
      throw Error('override unavailable')
    },
  })
  assertEquals(ran, 2)
})

Deno.test('grouped registration introspection and wants come from its slots', () => {
  let fx = effects(blog)
  let asked = [{ eids: ['subscriber'] }]
  let calls = 0
  fx.on('post', {
    created: () => {},
    changed: { title: () => {} },
    removed: () => {},
    sweep: { pending: 'unacted' },
    doc: 'notify',
    wants: () => {
      calls++
      return asked
    },
  })
  assertEquals(fx.docs(), [{
    comp: 'post',
    hooks: ['created', 'changed(title)', 'removed'],
    sweep: 'unacted',
    doc: 'notify',
  }])
  assertEquals(fx.wants!([]).slice(-1), asked)
  assertEquals(calls, 1, 'one gather declaration for the grouped hooks')
})

Deno.test('external journal handlers write through apply; no implicit transaction reads', async () => {
  let failures: string[] = []
  let g = blogGraph()
  let fx = effects(blog, {
    write: (b) => g.apply(b),
    report: (e) => {
      failures.push(String(e))
    },
  })
  fx.created(
    'post',
    (_e, _tx, write) =>
      write([{ entity: { eid: 'receipt' }, post: { title: 'receipt' } }]),
  )
  fx.created('post', (_e, tx) => tx.get(['p']))
  await fx.dispatch([birth])
  assertEquals((await g.read('.post.title=receipt')).length, 1)
  assertEquals(failures.length, 1)
  await fx.dispatch([birth], detached(g.storage))
  assertEquals(failures.length, 1)
})

Deno.test('an asynchronous sweep reader cannot hold up another declaration', async () => {
  let release!: (rows: Record<string, unknown>[]) => void
  let slow = new Promise<Record<string, unknown>[]>((resolve) =>
    release = resolve
  )
  let ran: string[] = []
  let fx = effects(blog)
  fx.created('slow', (e) => ran.push(e.entity.eid), {
    sweep: { pending: 'unacted' },
  })
  fx.created('fast', (e) => ran.push(e.entity.eid), {
    sweep: { pending: 'unacted' },
  })
  let done = fx.relay((comp) => comp == 'slow' ? slow : [{ eid: 'fast' }])
  assertEquals(ran, ['fast'])
  release([{ eid: 'slow' }])
  assertEquals((await done).length, 2)
  assertEquals(ran, ['fast', 'slow'])
})
