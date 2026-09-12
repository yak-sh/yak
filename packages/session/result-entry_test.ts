import { assertEquals } from '@std/assert'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { modelDoc } from '@yaks/model'
import { effects } from '@yaks/effects'
import { executeCall } from '@yaks/tools'
import { sessionDoc } from './comp.ts'
import { sessions } from './plugin.ts'

Deno.test('result membership is joined before sequence allocation and observers', async () => {
  const vocab = loadVocab([sessionDoc, modelDoc])
  const fx = effects(vocab)
  const g = graph({ vocab, storage: ram(vocab), plugins: [sessions(), fx] })
  const observed: unknown[] = []
  fx.created('result', (e) => {
    observed.push(e.entity.eid)
  })
  await g.apply([
    { entity: { eid: 's' }, session: {} },
    { entity: { eid: 't' }, tool: { name: 'echo' } },
    {
      entity: { eid: 'c' },
      entry: { session: 's' },
      call: { to: 't', args: '{}' },
    },
  ])
  await executeCall(g, 'c', { resolve: () => ({ run: () => 'hello' }) })
  const [result] = await g.read('.result')
  assertEquals(result.entry, { session: 's', seq: 2 })
  assertEquals(observed, [result.entity.eid])
  // Updating an existing result must not append a second transcript position.
  await g.apply([{ entity: result.entity, result: { call: 'c', ms: 50 } }])
  assertEquals((await g.read('.result'))[0].entry, result.entry)
})

Deno.test('same-batch call/result join respects the absence gate and detached calls', async () => {
  const vocab = loadVocab([sessionDoc, modelDoc])
  const g = graph({ vocab, storage: ram(vocab), plugins: [sessions()] })
  await g.apply([
    { entity: { eid: 's' }, session: {} },
    { entity: { eid: 't' }, tool: { name: 'echo' } },
    { entity: { eid: 'c' }, entry: { session: 's' }, call: { to: 't' } },
    { entity: { eid: 'r' }, result: { call: 'c' }, content: { body: 'ok' } },
    {
      entity: { eid: 'explicit' },
      entry: { session: 's' },
      result: { call: 'c' },
    },
    { entity: { eid: 'detached' }, call: { to: 't' } },
    { entity: { eid: 'detached-r' }, result: { call: 'detached' } },
  ])
  const rows = await g.read('.result')
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
