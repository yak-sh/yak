import { assertEquals } from '@std/assert'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { modelDoc } from '@yaks/model'
import { effects } from '@yaks/effects'
import { runner, toolEid } from '@yaks/tools'
import type { Bundle, Graph } from '@yaks/graph'
import { toolsDoc } from '@yaks/tools/vocab'
import { sessionDoc } from './comp.ts'
import { sessions } from './plugin.ts'

let T = toolEid('echo')

// One tool, answering the words it was told to, at the entity a call names.
let saying = (g: Graph, say: () => unknown) =>
  runner(g, {
    tools: [{
      name: 'echo',
      description: 'say it back',
      run: async (call): Promise<Bundle[]> => [{
        entity: { eid: '$said' },
        content: { body: String(await say()) },
        output: { source: call.entity.eid },
      }],
    }],
  })

Deno.test('result membership is joined before sequence allocation and observers', async () => {
  const vocab = loadVocab([sessionDoc, toolsDoc, modelDoc])
  const fx = effects(vocab)
  const g = graph({ vocab, storage: ram(vocab), plugins: [sessions(), fx] })
  const observed: unknown[] = []
  fx.created('result', (e) => {
    observed.push(e.entity.eid)
  })
  await g.apply([
    { entity: { eid: 's' }, session: {} },
    { entity: { eid: T }, tool: { name: 'echo' } },
    {
      entity: { eid: 'c' },
      entry: { session: 's' },
      call: { to: T, args: {} },
    },
  ])
  await saying(g, () => 'hello').run('c')
  const [result] = await g.read('.result&*')
  assertEquals(result.entry, { session: 's', seq: 2 })
  assertEquals(observed, [result.entity.eid])
  // Updating an existing result must not append a second transcript position.
  await g.apply([{ entity: result.entity, result: { call: 'c', ms: 50 } }])
  assertEquals((await g.read('.result&*'))[0].entry, result.entry)
})

Deno.test('same-batch call/result join respects the absence gate and detached calls', async () => {
  const vocab = loadVocab([sessionDoc, toolsDoc, modelDoc])
  const g = graph({ vocab, storage: ram(vocab), plugins: [sessions()] })
  await g.apply([
    { entity: { eid: 's' }, session: {} },
    { entity: { eid: T }, tool: { name: 'echo' } },
    { entity: { eid: 'c' }, entry: { session: 's' }, call: { to: T } },
    { entity: { eid: 'r' }, result: { call: 'c' }, content: { body: 'ok' } },
    {
      entity: { eid: 'explicit' },
      entry: { session: 's' },
      result: { call: 'c' },
    },
    { entity: { eid: 'detached' }, call: { to: T } },
    { entity: { eid: 'detached-r' }, result: { call: 'detached' } },
  ])
  const rows = await g.read('.result&*')
  assertEquals(rows.find((b) => b.entity.eid == 'r')?.entry, {
    session: 's',
    seq: 2,
  })
  assertEquals(rows.find((b) => b.entity.eid == 'explicit')?.entry, {
    session: 's',
    seq: 3,
  })
  assertEquals(rows.find((b) => b.entity.eid == 'detached-r')?.entry, undefined)
})

Deno.test('independent callers can complete out of order without losing transcript association', async () => {
  const vocab = loadVocab([sessionDoc, toolsDoc, modelDoc])
  const g = graph({ vocab, storage: ram(vocab), plugins: [sessions()] })
  await g.apply([
    { entity: { eid: 's' }, session: {} },
    { entity: { eid: T }, tool: { name: 'echo' } },
    {
      entity: { eid: 'a' },
      entry: { session: 's' },
      call: { to: T, args: {} },
    },
    {
      entity: { eid: 'b' },
      entry: { session: 's' },
      call: { to: T, args: {} },
    },
  ])
  let release!: () => void
  const gate = new Promise<void>((resolve) => release = resolve)
  const slow = saying(g, async () => {
    await gate
    return 'a'
  }).run('a')
  await saying(g, () => 'b').run('b')
  release()
  await slow
  const results = await g.read('.result .order=entry.seq&*')
  assertEquals(results.map((b) => b.result), [
    { call: 'b', ms: (results[0].result as { ms: number }).ms },
    { call: 'a', ms: (results[1].result as { ms: number }).ms },
  ])
  assertEquals(results.map((b) => b.entry), [
    { session: 's', seq: 3 },
    { session: 's', seq: 4 },
  ])
})
