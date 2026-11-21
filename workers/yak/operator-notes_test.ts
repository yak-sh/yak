import { equal, test } from '@yaks/testing'
import type { Bundle, Comp } from '@yaks/graph'
import { noteBackfill, NOTES } from '@yaks/platform/operator-notes'
import { operatorMemory } from './operator-testing.ts'

let session = crypto.randomUUID()
let note = (source: string, scope = 'local'): Bundle => ({
  entity: { eid: crypto.randomUUID() },
  entry: { session },
  prompt: { scope, source },
  content: { body: source },
})

test('recall and decision notes kept as local prompts become turn notes, once', async () => {
  let store = operatorMemory()
  let held = new Map<string, string>()
  let marks = {
    get: (k: string) => held.get(k),
    set: (k: string, v: string) => void held.set(k, v),
  }
  await store.g.apply([{ entity: { eid: session }, session: {} }], {
    trusted: true,
  })
  let rows = [
    note('operator:earlier'),
    note('operator:decisions'),
    note('harness:fork'),
    note('operator:reads', 'turn'),
  ]
  await store.g.apply(rows, { trusted: true })
  equal(await noteBackfill({ g: store.g, marks }), false)
  let scopes = async () =>
    (await store.g.get(rows.map((b) => b.entity.eid), ['prompt']))
      .map((b) => (b.prompt as Comp).scope)
  equal(await scopes(), ['turn', 'turn', 'local', 'turn'])
  equal(held.get(NOTES), 'done')
  await store.g.apply([note('operator:earlier')], { trusted: true })
  equal(await noteBackfill({ g: store.g, marks }), false)
  equal(await noteBackfill({ g: store.g }), false)
})
