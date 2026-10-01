// Run recovery with the core marks loaded: dispatch is an envelope, not a
// second stored status, and a terminal transcript must be delivered before
// its envelope disappears.
import { assert, assertEquals } from '@std/assert'
import {
  type Bundle,
  type Comp,
  graph,
  identityEid,
  type Plugin,
} from '@yaks/graph'
import { storage } from '@yaks/sqlite'
import { mem } from '../sqlite/testing.ts'
import { effectDoc, effects, LEASE, leaseEid } from '@yaks/effects'
import { loadVocab, pick } from '@yaks/vocab'
import { kernelDoc } from '@yaks/kernel/vocab'
import { type Model, modelDoc, type Request } from '@yaks/model'
import { toolsDoc } from '@yaks/tools/vocab'
import { test } from '@yaks/testing'
import { sessionDoc } from './comp.ts'
import { sessions } from './plugin.ts'
import { transcript } from './react.ts'
import { kindOf, sessionDerived, statusOf } from './status.ts'
import { answers } from './providers.ts'
import { RUN, type Runner, settle } from './run.ts'

let vocab = loadVocab([
  sessionDoc,
  toolsDoc,
  modelDoc,
  effectDoc,
  pick(kernelDoc, ['admitted', 'waiting']),
])
let P = identityEid('provider', ['fake'])
let M = identityEid('model', ['fake-recovery'])

let fixture = (bundles: Bundle[], watch?: Plugin) => {
  let s = storage(mem(), vocab, { derived: sessionDerived(vocab) })
  s.install()
  graph({ storage: s, vocab }).apply([
    { entity: { eid: P }, provider: { name: 'fake' } },
    { entity: { eid: M }, model: { name: 'fake-recovery' } },
    { entity: { eid: 'root' }, session: { id: 'root' } },
    { entity: { eid: 'worker' }, session: { id: 'worker' } },
    { entity: { eid: 'old-worker' }, session: { id: 'old-worker' } },
    ...bundles,
  ], { trusted: true })
  let asked: Request[] = []
  let model: Model = (req) => {
    asked.push(req)
    return Promise.resolve({
      id: `response-${asked.length}`,
      model: req.model,
      items: [{ kind: 'assistant', text: 'done' }],
    })
  }
  let fx = effects(vocab, {
    owner: 'worker',
    write: (b) => g.apply(b, { trusted: true }),
  })
  let g = graph({
    storage: s,
    vocab,
    plugins: [sessions(), fx, ...watch ? [watch] : []],
  })
  let r: Runner = {
    holder: 'worker',
    model,
    answers: answers(g, {}, model),
    tools: [],
    maxChildren: 1,
  }
  return { g, r, asked }
}

let child = (eid: string, order?: number): Bundle[] => [
  {
    entity: { eid },
    session: { id: eid },
    spawned: { parent: 'root' },
    ...order == null ? {} : { dispatch: { order } },
  },
  {
    entity: { eid: `${eid}:input` },
    entry: { session: eid },
    content: { body: eid },
    using: { provider: P, model: M },
  },
]
let dispatch = (b: Bundle) => b.dispatch as Comp | undefined

let output = (eid: string): Bundle => ({
  entity: { eid: `${eid}:output` },
  entry: { session: eid },
  output: {},
  content: { body: 'already done' },
})

for (let mark of ['queued', 'admitted', 'waiting']) {
  test(`a terminal ${mark} marks-only child delivers before removing its envelope`, async () => {
    let observed: string[] = []
    let receipt = 'delivery:finished:finished:output'
    let p = fixture([
      ...child('finished', 7),
      ...mark == 'queued' ? [] : [{
        entity: { eid: 'finished' },
        [mark]: {},
      }],
      output('finished'),
    ], {
      name: 'receipt-order',
      hooks: {
        effect: async (bundles, tx) => {
          if (bundles.some((b) => b.entity.eid == receipt)) {
            let [child] = await tx.get(['finished'])
            assert(
              child?.dispatch,
              'receipt must commit while the envelope exists',
            )
            observed.push('receipt')
          }
          if (
            bundles.some((b) =>
              b.entity.eid == 'finished' && b.dispatch === null
            )
          ) {
            let [told] = await tx.get([receipt])
            assert(
              told?.entry,
              'removal must observe the committed parent receipt',
            )
            observed.push('removal')
          }
          return bundles
        },
      },
    })
    assertEquals(statusOf(await transcript(p.g, 'finished')), 'settled')
    await settle(p.g, 'finished', p.r)
    let [finished] = await p.g.get(['finished'])
    assertEquals(finished.dispatch, undefined)
    assertEquals(finished.admitted, undefined)
    assertEquals(finished.waiting, undefined)
    assertEquals(observed, ['receipt', 'removal'])
    assertEquals(p.asked.length, 0)
    let told = await transcript(p.g, 'root')
    assertEquals(told.map((b) => b.entity.eid), [receipt])
    assertEquals(told[0].content, {
      body: 'child finished settled\nalready done',
    })
    // A later sweep neither recreates the envelope nor duplicates delivery.
    await settle(p.g, 'finished', p.r)
    assertEquals((await p.g.get(['finished']))[0].dispatch, undefined)
    assertEquals((await transcript(p.g, 'root')).length, 1)
    assertEquals(observed, ['receipt', 'removal'])
  })
}

test('an expired run lease requeues a waiting child in order under the child bound', async () => {
  let active: number[] = []
  let p = fixture([
    ...child('blocker', 1),
    { entity: { eid: 'blocker' }, admitted: {} },
    output('blocker'),
    ...child('older', 2),
    ...child('recovered', 3),
    { entity: { eid: 'recovered' }, waiting: {} },
    ...child('newer', 4),
    {
      entity: { eid: leaseEid(`${RUN}/recovered`) },
      [LEASE]: {
        name: `${RUN}/recovered`,
        holder: 'old-worker',
        until: '2000-01-01T00:00:00.000Z',
      },
    },
  ], {
    name: 'admission-bound',
    hooks: {
      effect: async (bundles, tx) => {
        active.push((await tx.read('.dispatch.status=active')).length)
        return bundles
      },
    },
  })
  await settle(p.g, 'recovered', p.r)
  let [recovered] = await p.g.get(['recovered'])
  assertEquals(recovered.waiting, undefined)
  assertEquals(recovered.admitted, undefined)
  assertEquals(dispatch(recovered)?.order, 3)
  assertEquals(dispatch(recovered)?.state, null)
  assertEquals(dispatch(recovered)?.args, null)
  assertEquals(
    (await p.g.read('.dispatch.status=queued')).map((b) => b.entity.eid).sort(),
    ['newer', 'older', 'recovered'],
  )
  assertEquals(p.asked.length, 0)
  await settle(p.g, 'newer', p.r)
  assertEquals(p.asked.length, 0)
  // Releasing the occupied slot admits only the oldest queued child.
  await settle(p.g, 'blocker', p.r)
  assertEquals(
    (await p.g.read('.dispatch.status=active')).map((b) => b.entity.eid),
    ['older'],
  )
  await settle(p.g, 'recovered', p.r)
  assertEquals(p.asked.length, 0)
  await settle(p.g, 'older', p.r)
  assertEquals(
    (await p.g.read('.dispatch.status=active')).map((b) => b.entity.eid),
    ['recovered'],
  )
  assertEquals(dispatch((await p.g.get(['recovered']))[0])?.order, 3)
  await settle(p.g, 'newer', p.r)
  assertEquals(p.asked.length, 1)
  await settle(p.g, 'recovered', p.r)
  await settle(p.g, 'newer', p.r)
  assertEquals(p.asked.length, 3)
  assert(active.length > 0)
  assert(active.every((n) => n <= 1), `active children: ${active}`)
  for (let eid of ['older', 'recovered', 'newer']) {
    assertEquals(statusOf(await transcript(p.g, eid)), 'settled')
    assertEquals((await p.g.get([eid]))[0].dispatch, undefined)
  }
})

for (let canonical of [false, true]) {
  test(`an imported spawned child with ${canonical ? 'canonical imported' : 'external'} input and no dispatch stays unmanaged`, async () => {
    let p = fixture([
      ...child('occupant', 1),
      { entity: { eid: 'occupant' }, admitted: {} },
      ...child('imported').map((b) =>
        b.entity.eid == 'imported:input'
          ? {
            ...b,
            entity: { eid: canonical ? 'imported:input' : 'external:message' },
            imported: { source: 'external-transcript', line: 1 },
          }
          : b
      ),
    ])
    await settle(p.g, 'imported', p.r)
    assertEquals(p.asked.length, 1)
    assertEquals((await transcript(p.g, 'imported')).map(kindOf), [
      'input',
      'ask',
      'output',
    ])
    assertEquals(statusOf(await transcript(p.g, 'imported')), 'settled')
    let [imported] = await p.g.get(['imported'])
    assertEquals(imported.dispatch, undefined)
    assertEquals(imported.admitted, undefined)
    assertEquals(imported.waiting, undefined)
    assertEquals(
      (await p.g.read('.dispatch.status=active')).map((b) => b.entity.eid),
      ['occupant'],
    )
    assertEquals((await transcript(p.g, 'root')).length, 1)
  })
}

test('a recovered waiting child with a free slot runs in the lease recovery pass', async () => {
  let p = fixture([
    ...child('recovered', 8),
    { entity: { eid: 'recovered' }, waiting: {} },
    {
      entity: { eid: leaseEid(`${RUN}/recovered`) },
      [LEASE]: {
        name: `${RUN}/recovered`,
        holder: 'old-worker',
        until: '2000-01-01T00:00:00.000Z',
      },
    },
  ])
  await settle(p.g, 'recovered', p.r)
  assertEquals(p.asked.length, 1)
  assertEquals(statusOf(await transcript(p.g, 'recovered')), 'settled')
  let [recovered] = await p.g.get(['recovered'])
  assertEquals(recovered.dispatch, undefined)
  assertEquals(recovered.waiting, undefined)
  assertEquals(recovered.admitted, undefined)
})

test('a native continuation without dispatch rejoins the tail under a full bound without preparing again', async () => {
  let p = fixture([
    ...child('occupied', 3),
    { entity: { eid: 'occupied' }, admitted: {} },
    output('occupied'),
    ...child('ahead', 10),
    ...child('native'),
    output('native'),
    {
      entity: { eid: 'native:continue' },
      entry: { session: 'native' },
      content: { body: 'continue' },
      using: { provider: P, model: M },
    },
  ])
  let prepared = 0
  p.r.prepareChild = () => {
    prepared++
    return Promise.resolve({})
  }
  await settle(p.g, 'native', p.r)
  let [native] = await p.g.get(['native'])
  assertEquals(dispatch(native)?.state, 'queued')
  assertEquals(dispatch(native)?.order, 11)
  assertEquals(dispatch(native)?.args, null)
  assertEquals(native.admitted, undefined)
  assertEquals(p.asked.length, 0)
  assertEquals(prepared, 0)
  await settle(p.g, 'occupied', p.r)
  await settle(p.g, 'native', p.r)
  assertEquals(p.asked.length, 0)
  assertEquals(dispatch((await p.g.get(['native']))[0])?.state, 'queued')
  assertEquals(dispatch((await p.g.get(['native']))[0])?.order, 11)
  await settle(p.g, 'ahead', p.r)
  assertEquals(p.asked.length, 1)
  await settle(p.g, 'native', p.r)
  assertEquals(p.asked.length, 2)
  assertEquals(prepared, 0)
  assertEquals(statusOf(await transcript(p.g, 'native')), 'settled')
  assertEquals(dispatch((await p.g.get(['native']))[0])?.state, 'settled')
  assertEquals(dispatch((await p.g.get(['native']))[0])?.order, 11)
})

test('a native continuation whose input becomes imported before requeue loses admission without side effects', async () => {
  let p = fixture([
    ...child('occupied', 3),
    { entity: { eid: 'occupied' }, admitted: {} },
    ...child('native'),
  ])
  let apply = p.g.apply
  let raced = false
  p.g.apply = async (bundles, opts) => {
    if (
      !raced &&
      bundles.some((b) =>
        b.entity.eid == 'native' && dispatch(b)?.state == 'queued'
      )
    ) {
      raced = true
      await apply([{
        entity: { eid: 'native:input' },
        imported: { source: 'external-transcript', line: 1 },
      }], { trusted: true })
    }
    return apply(bundles, opts)
  }
  let prepared = 0
  p.r.prepareChild = () => {
    prepared++
    return Promise.resolve({})
  }
  let reported: unknown[] = []
  p.r.report = (err) => reported.push(err)
  await settle(p.g, 'native', p.r)
  assert(
    raced,
    'the provenance change must land after the read, before requeue',
  )
  let [native, input] = await p.g.get(['native', 'native:input'])
  assertEquals(native.dispatch, undefined)
  assertEquals(native.admitted, undefined)
  assertEquals(input.imported, { source: 'external-transcript', line: 1 })
  assertEquals(input.content, { body: 'native' })
  assertEquals(p.asked.length, 0)
  assertEquals(prepared, 0)
  assertEquals(reported, [])
})
