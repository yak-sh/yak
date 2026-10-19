// Input enrichment survives replacement graph objects and keeps each input's
// own snapshot. Source races fail before any stale context can be dispatched.
import { equal, test } from '@yaks/testing'
import { type Bundle, graph } from '@yaks/graph'
import { Stale } from '@yaks/graph/errors'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { modelDoc } from '@yaks/model'
import { toolsDoc } from '@yaks/tools/vocab'
import { sessionDoc } from './comp.ts'
import { prepareInput } from './input_context.ts'
import { project } from './react.ts'

let vocab = loadVocab([kernelDoc, sessionDoc, modelDoc, toolsDoc], [
  kernelKeywords,
])
let input = (eid: string, seq: number): Bundle => ({
  entity: { eid },
  entry: { session: 'session', seq },
  content: { body: eid },
})
let fixture = async (entries: Bundle[]) => {
  let storage = ram(vocab)
  let open = () => graph({ storage, vocab })
  let g = open()
  await g.apply([{ entity: { eid: 'session' }, session: {} }, ...entries])
  return { g, open, entries }
}

let paired = await fixture([input('one', 1), input('two', 2)])

test('each new input keeps its own context beside its words', async () => {
  let { g, entries } = paired
  await prepareInput(g, 'session', entries, entries, (b) => [
    { kind: 'user', text: `earlier ${b.entity.eid}` },
  ])
  equal(project(entries, entries, new Map()), [
    { kind: 'user', text: 'one' },
    { kind: 'user', text: 'earlier one' },
    { kind: 'user', text: 'two' },
    { kind: 'user', text: 'earlier two' },
  ])
})

let empty = await fixture([input('one', 1)])

test('an empty snapshot is not researched again after reopening', async () => {
  let { g, open, entries } = empty
  await prepareInput(g, 'session', entries, entries, () => [])
  g = open()
  entries = await g.get(['one'])
  let called = false
  await prepareInput(g, 'session', entries, entries, () => {
    called = true
    return []
  })
  equal(called, false)
  equal(entries[0].input_context, { items: [] })
})

let submitted = await fixture([input('one', 1)])

test('already submitted inputs are not retroactively researched', async () => {
  let { g, entries } = submitted
  entries.push({
    entity: { eid: 'ask' },
    entry: { session: 'session', seq: 2 },
    ask: { through: 'one' },
  }, input('two', 3))
  await g.apply([entries[2]])
  let called: string[] = []
  await prepareInput(g, 'session', entries, entries, (b) => {
    called.push(b.entity.eid)
    return []
  })
  equal(called, ['two'])
})

let legacy = await fixture([input('one', 1)])

test('a legacy ask without a boundary still covers its older input', async () => {
  let { g, entries } = legacy
  entries.push({
    entity: { eid: 'ask' },
    entry: { session: 'session', seq: 2 },
    ask: {},
  })
  let called = false
  await prepareInput(g, 'session', entries, entries, () => {
    called = true
    return []
  })
  equal(called, false)
})

let fork = await fixture([input('own-input', 2)])

test('a fresh fork enriches its input without mutating inherited history', async () => {
  let parent = input('parent-input', 30)
  parent.entry = { session: 'parent', seq: 30 }
  let { g, entries } = fork
  await g.apply([{ entity: { eid: 'parent' }, session: {} }, parent])
  entries.unshift(parent, {
    entity: { eid: 'parent-ask' },
    entry: { session: 'parent', seq: 40 },
    ask: { through: 'parent-input' },
  })
  let called: string[] = []
  await prepareInput(g, 'session', entries, entries, (b) => {
    called.push(b.entity.eid)
    return []
  })
  equal(called, ['own-input'])
  equal((await g.get(['parent-input']))[0].input_context, undefined)
})

let prose = await fixture([input('one', 1), input('two', 3)])

test('a legacy prose response covers earlier inputs without a typed ask', async () => {
  let { g, entries } = prose
  entries.splice(1, 0, {
    entity: { eid: 'output' },
    entry: { session: 'session', seq: 2 },
    output: { source: 'session' },
    content: { body: 'answered' },
  })
  let called: string[] = []
  await prepareInput(g, 'session', entries, entries, (b) => {
    called.push(b.entity.eid)
    return []
  })
  equal(called, ['two'])
})

for (let moved of ['content', 'entry'] as const) {
  let raced = await fixture([input('one', 1)])
  await raced.g.apply([{ entity: { eid: 'other' }, session: {} }])
  test(`input context refuses a changed ${moved} source`, async () => {
    let { g, entries } = raced
    let failed: unknown
    try {
      await prepareInput(g, 'session', entries, entries, async () => {
        await g.apply([{
          entity: { eid: 'one' },
          ...moved == 'content'
            ? { content: { body: 'changed' } }
            : { entry: { session: 'other' } },
        }])
        return [{ kind: 'user', text: 'stale context' }]
      })
    } catch (error) {
      failed = error
    }
    equal(failed instanceof Stale, true)
    equal((await g.get(['one']))[0].input_context, undefined)
  })
}
