// Both writers coexist until cutover: legacy transitions remain readable by
// the old server, while converted envelopes change only the two core marks.
import { assertEquals, assertRejects } from '@std/assert'
import { test } from '@yaks/testing'
import { type Bundle, type Comp, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { kernelDoc } from '@yaks/kernel/vocab'
import { loadVocab } from '@yaks/vocab'
import { sessionDoc } from './comp.ts'
import {
  active,
  admitNext,
  aside,
  dispatchStatus,
  queue,
  swap,
} from './admission.ts'

let store = () => {
  let vocab = loadVocab([kernelDoc, sessionDoc])
  return graph({ vocab, storage: ram(vocab) })
}

test('dispatch transitions preserve legacy authority and settle converted envelopes by removal', async () => {
  let g = store()
  await g.apply([
    {
      entity: { eid: 'old' },
      dispatch: { state: 'queued', order: 1, args: 'old' },
    },
    { entity: { eid: 'new' }, dispatch: { order: 2, args: 'new' } },
  ], { trusted: true })
  for (let eid of ['old', 'new']) {
    assertEquals(await swap(g, eid, 'queued', { state: 'active' }), true)
    let [b] = await g.get([eid])
    assertEquals(dispatchStatus(b), 'active')
    assertEquals(!!b.admitted, true)
    assertEquals((b.dispatch as Record<string, unknown>).args, eid)
    assertEquals(await swap(g, eid, 'active', { state: 'waiting' }), true)
    assertEquals(dispatchStatus((await g.get([eid]))[0]), 'waiting')
    assertEquals(await swap(g, eid, 'waiting', { state: 'queued' }), true)
    assertEquals(await swap(g, eid, 'queued', { state: 'settled' }), true)
    b = (await g.get([eid]))[0]
    assertEquals(dispatchStatus(b), eid == 'old' ? 'settled' : null)
    assertEquals(b.admitted, undefined)
    assertEquals(b.waiting, undefined)
  }
})

test('a terminal entry and settlement are one transaction even when the entry is refused', async () => {
  let g = store()
  await g.apply([{ entity: { eid: 'child' }, dispatch: { order: 1 } }], {
    trusted: true,
  })
  await assertRejects(() =>
    swap(g, 'child', 'queued', { state: 'settled' }, [{
      entity: { eid: 'stop' },
      undeclared: {},
    } as Bundle])
  )
  assertEquals(dispatchStatus((await g.get(['child']))[0]), 'queued')
  assertEquals(await g.get(['stop']), [])
  assertEquals(
    await swap(g, 'child', 'queued', { state: 'settled' }, [{
      entity: { eid: 'stop' },
      entry: { session: 'child' },
      stop: {},
    }]),
    true,
  )
  assertEquals(dispatchStatus((await g.get(['child']))[0]), null)
  assertEquals((await g.get(['stop']))[0].stop, {})
})

test('mixed children share the bound and a waiter keeps its queue order', async () => {
  let g = store()
  await g.apply([
    { entity: { eid: 'old' }, dispatch: { state: 'active', order: 1 } },
    { entity: { eid: 'new' }, dispatch: { order: 2 } },
  ], { trusted: true })
  await admitNext(g, { maxChildren: 1 })
  assertEquals(dispatchStatus((await g.get(['new']))[0]), 'queued')
  let back = await aside(g, 'old', { maxChildren: 1 })
  assertEquals(dispatchStatus((await g.get(['new']))[0]), 'active')
  assertEquals(((await g.get(['old']))[0].dispatch as Comp)?.order, 1)
  await swap(g, 'new', 'active', { state: 'settled' })
  await back()
  assertEquals(dispatchStatus((await g.get(['old']))[0]), 'active')
})

// RAM's vocabulary ladder alone does not implement the legacy state's
// precedence. Admission must use the same compatibility reader as transitions.
for (
  let [name, child, status] of [
    [
      'legacy active without marks',
      { dispatch: { state: 'active' } },
      'active',
    ],
    ['legacy queued with stale marks', {
      dispatch: { state: 'queued' },
      admitted: {},
      waiting: {},
    }, 'queued'],
    ['legacy active with stale waiting', {
      dispatch: { state: 'active' },
      waiting: {},
    }, 'active'],
    ['legacy empty string remains authoritative', {
      dispatch: { state: '' },
      admitted: {},
      waiting: {},
    }, ''],
  ] as const
) {
  test(`admission preserves ${name} in RAM without computed registration`, async () => {
    let g = store()
    await g.apply([{ entity: { eid: 'child' }, ...child }], { trusted: true })
    assertEquals(dispatchStatus((await g.get(['child']))[0]), status)
    assertEquals(await active(g), status == 'active' ? 1 : 0)
    assertEquals(
      (await queue(g)).map((b) => b.entity.eid),
      status == 'queued' ? ['child'] : [],
    )
  })
}

test('RAM admission retains legacy queue order and respects occupied places', async () => {
  let g = store()
  await g.apply([
    { entity: { eid: 'holder' }, dispatch: { state: 'active', order: 1 } },
    {
      entity: { eid: 'later' },
      dispatch: { state: 'queued', order: 3 },
      waiting: {},
    },
    {
      entity: { eid: 'first' },
      dispatch: { state: 'queued', order: 2 },
      admitted: {},
    },
    { entity: { eid: 'root' }, admitted: {}, waiting: {} },
  ], { trusted: true })
  assertEquals((await queue(g)).map((b) => b.entity.eid), ['first', 'later'])
  await admitNext(g, { maxChildren: 1 })
  assertEquals(await active(g), 1)
  assertEquals((await queue(g)).map((b) => b.entity.eid), ['first', 'later'])
  await swap(g, 'holder', 'active', { state: 'settled' })
  await admitNext(g, { maxChildren: 1 })
  assertEquals(dispatchStatus((await g.get(['first']))[0]), 'active')
  assertEquals((await queue(g)).map((b) => b.entity.eid), ['later'])
})
