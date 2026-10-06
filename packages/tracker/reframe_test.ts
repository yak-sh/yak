// Catalog work crosses an async boundary. Groups and source text can move
// meanwhile, but the late resolver never writes against its old snapshot.

import { equal, ok, test } from '@yaks/testing'
import { fixture } from './fixture_test.ts'
import { enrichFrames } from './frames.ts'
import { group, reframe } from './group.ts'
import { comp } from './model.ts'
import { capture } from './report.ts'

let commit = 'a'.repeat(40)
let correct = crypto.randomUUID(),
  old = crypto.randomUUID(),
  next = crypto.randomUUID()
let winner = crypto.randomUUID(), late = crypto.randomUUID()

let occurrence = async () => {
  let g = fixture()
  let error = new Error('broken')
  error.stack = 'Error: broken\n at fail (file:///srv/a.ts:10:2)'
  await g.apply(capture(error, { sink: () => {}, eid: 'occurrence' }), {
    trusted: true,
  })
  await group(g, 'occurrence')
  return g
}
let linked = (symbol: string) =>
  enrichFrames((frames) =>
    Promise.resolve(frames.map((f) => ({ ...f, app: true, symbol })))
  )

test('group moves during catalog await link only its current group', async () => {
  let g = await occurrence()
  let [old] = await g.read('.bug *')
  await reframe(g, 'occurrence', async (row) => {
    await g.apply([
      { entity: { eid: 'current' }, bug: { fault: 'new', hits: 7 } },
      { entity: row.entity, error: { bug: 'current' } },
    ], { trusted: true })
    return linked(correct)(row)
  })
  let [before, current] = await g.get([old.entity.eid, 'current'])
  equal(comp(before, 'bug').culprit, undefined)
  equal(comp(before, 'bug').hits, 1)
  equal(comp(current, 'bug').culprit, correct)
  equal(comp(current, 'bug').hits, 7)
})

test('source and commit changed during catalog await are re-enriched', async () => {
  let g = await occurrence()
  let calls = 0
  await reframe(g, 'occurrence', async (row) => {
    calls++
    if (calls == 1) {
      await g.apply([{
        entity: row.entity,
        error: { commit },
        exception: {
          stack: 'Error: changed\n at next (file:///srv/b.ts:20:3)',
        },
      }], { trusted: true })
    }
    return linked(comp(row, 'error').commit ? next : old)(row)
  })
  let [row] = await g.get(['occurrence'])
  equal(calls, 2)
  equal(comp(row, 'error').commit, commit)
  let frames = comp(row, 'exception').frames as {
    file: string
    symbol: string
  }[]
  equal(frames[0].file, 'file:///srv/b.ts')
  equal(frames[0].symbol, next)
  equal(comp((await g.read('.bug *'))[0], 'bug').hits, 1)
})

test('a competing frame result is revalidated rather than overwritten stale', async () => {
  let g = await occurrence()
  let calls = 0
  await reframe(g, 'occurrence', async (row) => {
    calls++
    if (calls == 1) await reframe(g, 'occurrence', linked(winner))
    return linked(late)(row)
  })
  equal(calls, 2)
  let [bug] = await g.read('.bug *')
  equal(comp(bug, 'bug').culprit, winner)
  equal(comp(bug, 'bug').hits, 1)
})

test('frame resolver failures retain grouping and text without self enrichment', async () => {
  let g = fixture()
  let error = new TypeError('catalog refused')
  error.stack =
    'TypeError: catalog refused\n at get (file:///srv/source.ts:10:2)'
  await g.apply(
    capture(error, {
      sink: () => {},
      eid: 'failure',
      tags: { handler: 'error_frames' },
    }),
    { trusted: true },
  )
  await group(g, 'failure')
  await reframe(g, 'failure', () => {
    throw Error('must not call catalog')
  })
  let [row] = await g.get(['failure'])
  equal(comp(row, 'exception').stack, error.stack)
  equal(comp(row, 'exception').value, 'catalog refused')
  ok(comp(row, 'error').bug)
  equal(comp((await g.read('.bug *'))[0], 'bug').hits, 1)
})
