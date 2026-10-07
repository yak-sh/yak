// No-call conversion keeps every output, its content and attempt provenance,
// and serves the same choice after adopting frozen binding fingerprints.
import { equal, test } from '@yaks/testing'
import { type Binding, type Bundle, type Comp, graph } from '@yaks/graph'
import { keyed, keyEid, keys } from '@yaks/key'
import { storage } from '@yaks/sqlite'
import { toolEid } from '@yaks/tools'
import { mem } from '../sqlite/testing.ts'
import { choosing } from './choice.ts'
import { outputOf } from './build.ts'
import { frozenMove, takeMove } from './takes.ts'
import { inputKey } from './key.ts'
import { workshop } from './testing.ts'
import { derived } from './vocab.ts'

let binding: Binding = {
  entities: ['source'],
  vars: { description: 'a turtle' },
}
let oldBinding: Binding = {
  entities: ['source'],
  vars: { description: 'a sheep' },
}

let fixture = async () => {
  let vocab = workshop()
  let db = storage(mem(), vocab, { derived: derived(vocab) })
  db.install()
  let g = graph({
    storage: db,
    vocab,
    plugins: [keys(vocab), {
      name: 'choices',
      hooks: { precondition: choosing },
    }],
  })
  await g.apply([
    { entity: { eid: toolEid('no-call') }, tool: { name: 'no-call' } },
    {
      entity: { eid: 'builder' },
      builder: { query: '$s .doc', to: toolEid('no-call') },
    },
    { entity: { eid: 'source' }, doc: { body: 'gameplay changed this row' } },
    {
      entity: { eid: 'build' },
      build: {
        builder: 'builder',
        match: '["source"]',
        variant: 'main',
        call: 'new-call',
        key: 'keep-attempt',
        inputs: 'old-whole-entity-key',
      },
    },
    ...[['new-call', binding], ['old-call', oldBinding]].map((
      [eid, binding],
    ) => ({
      entity: { eid: String(eid) },
      call: {
        to: toolEid('no-call'),
        source: 'build',
        args: { binding, key: eid },
      },
      completed: {},
    })),
    {
      entity: { eid: 'new-output' },
      built: {
        build: 'build',
        call: 'new-call',
        slot: 'kind',
        key: 'keep-attempt',
        inputs: 'old-whole-entity-key',
        definition: 'kept-definition',
      },
      doc: { body: 'kept turtle design' },
    },
    {
      entity: { eid: 'old-output' },
      built: {
        build: 'build',
        call: 'old-call',
        slot: 'kind',
        key: 'earlier-attempt',
        inputs: 'old-history-key',
        definition: 'earlier-definition',
      },
      doc: { body: 'kept sheep design' },
    },
    keyed('output_of', 'new-output', 'build/kind'),
    keyed('output_of', 'old-output', outputOf('build', 'kind', 'old-call')),
  ] as Bundle[], { trusted: true })
  return g
}

let convert = async (g: Awaited<ReturnType<typeof fixture>>) => {
  let rows = await g.read('*')
  let byId = new Map(rows.map((row) => [row.entity.eid, row]))
  let writes = rows.flatMap((row) =>
    row.build
      ? frozenMove(row, byId.get(String((row.build as Comp).call)))
      : row.built
      ? takeMove(row, rows)
      : []
  )
  await g.apply(writes, { trusted: true })
  return writes
}

test('take conversion retains ids, content, attempts and calls and moves once', async () => {
  let g = await fixture()
  let before = await g.get(['new-output', 'old-output', 'new-call', 'old-call'])
  let writes = await convert(g)
  equal(writes.some((row) => row.$delete), false)
  let after = await g.get(['new-output', 'old-output', 'new-call', 'old-call'])
  equal(after.map((row) => row.doc), before.map((row) => row.doc))
  equal(after.slice(2), before.slice(2))
  equal(after.slice(0, 2).map((row) => (row.built as Comp).key), [
    'keep-attempt',
    'earlier-attempt',
  ])
  equal(after.slice(0, 2).map((row) => (row.built as Comp).inputs), [
    inputKey(binding),
    inputKey(oldBinding),
  ])
  let [run] = await g.get(['build'])
  equal([(run.build as Comp).key, (run.build as Comp).call], [
    'keep-attempt',
    'new-call',
  ])
  equal((run.build as Comp).inputs, inputKey(binding))
  equal((await g.read('.built.current=true')).map((r) => r.entity.eid), [
    'new-output',
  ])
  let [locator] = await g.get([
    keyEid('output_of', outputOf('build', 'kind', 'new-call')),
  ])
  equal((locator.key as Comp).of, 'new-output')
  equal((await g.read('.output_of')).length, 2)
  equal(await convert(g), [])
})

test('conversion preserves an earlier chosen take during an unchanged reroll', async () => {
  let g = await fixture()
  // The writer retained a chosen earlier take while the newest call is pending.
  await g.apply([
    { entity: { eid: 'old-call' }, call: { args: { binding } } },
    { entity: { eid: 'old-output' }, chosen: {} },
    { entity: { eid: 'build' }, build: { key: 'pending-attempt' } },
  ], { trusted: true })
  await convert(g)
  equal((await g.read('.chosen')).map((r) => r.entity.eid), ['old-output'])
  equal((await g.read('.built.current=true')).map((r) => r.entity.eid), [
    'old-output',
  ])
  equal((await g.read('.built')).length, 2)
  equal((await g.read('.call')).length, 2)
})

test('missing call evidence fails before changing any rows', async () => {
  let g = await fixture()
  let [row] = await g.get(['new-output'])
  let failed = false
  try {
    takeMove(row, [])
  } catch {
    failed = true
  }
  equal(failed, true)
  equal((await g.get(['new-output']))[0], row)
})
