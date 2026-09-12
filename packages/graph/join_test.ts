import { assertEquals, assertThrows } from '@std/assert'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { graph } from './graph.ts'
import { joinRule } from './join.ts'
import type { Bundle } from './bundle.ts'
const vocab = loadVocab([{
  $defs: {
    session: { properties: {} },
    call: { properties: {} },
    entry: {
      properties: {
        session: { type: 'string', ref: 'session' },
        seq: { type: 'number' },
      },
    },
    result: { properties: { call: { type: 'string', ref: 'call' } } },
    source: {
      properties: { key: { type: 'string' }, value: { type: 'string' } },
    },
    target: { properties: { key: { type: 'string' } } },
    label: { properties: { value: { type: 'string' } } },
  },
}])
const rule = '$call .entry{$session} .call; .result{$call} +!entry{$session}'
const call: Bundle = { entity: { eid: 'c' }, call: {}, entry: { session: 's' } }
const result: Bundle = { entity: { eid: 'r' }, result: { call: 'c' } }
Deno.test('bounded join adds only missing membership and never sequence or new entities', () => {
  const plan = joinRule(rule, vocab)
  assertEquals(plan.run([[call], [result]]), [{
    entity: { eid: 'r' },
    entry: { session: 's' },
  }])
  assertEquals(
    plan.run([[call], [{ ...result, entry: { session: 'other' } }]]),
    [],
  )
  assertEquals(
    plan.run([[call], [{ ...result, result: { call: 'missing' } }]]),
    [],
  )
  assertEquals(plan.run([[call, call], [result]]).length, 1)
  assertEquals(
    plan.run([[{ ...call, result: { call: 'c' } }], [{
      ...call,
      result: { call: 'c' },
    }]]),
    [],
  )
})
Deno.test('second domain uses shared scalar bindings; ambiguous writes refuse', () => {
  const plan = joinRule(
    '.source{$key, $value}; .target{$key} +!label{$value}',
    vocab,
  )
  const a = { entity: { eid: 'a' }, source: { key: 'x', value: 'one' } }
  const b = { entity: { eid: 'b' }, source: { key: 'x', value: 'two' } }
  const t = { entity: { eid: 't' }, target: { key: 'x' } }
  assertEquals(plan.run([[a], [t]]), [{
    entity: { eid: 't' },
    label: { value: 'one' },
  }])
  assertThrows(() => plan.run([[a, b], [t]]), Error, 'Ambiguous')
  assertThrows(
    () => joinRule('.source{$key}; .target{$key} +!label{$value}', vocab),
    Error,
    'Unbound',
  )
  assertThrows(
    () => joinRule('.entry{seq: $x}; .target{key: $x}', vocab),
    Error,
    'Incompatible',
  )
  assertThrows(
    () => joinRule('.source{unknown: $x}', vocab),
    Error,
    'Unknown property',
  )
  assertThrows(
    () => joinRule(rule, vocab, { candidates: 1 }).run([[call], [result]]),
    Error,
    'candidate limit',
  )
  assertThrows(
    () => joinRule(rule, vocab, { steps: 1 }).run([[call], [result]]),
    Error,
    'step limit',
  )
})
Deno.test('transaction host supplies indexed views; separate sequence rule precedes effects', async () => {
  const plan = joinRule(rule, vocab)
  const seen: Bundle[] = []
  const g = graph({
    vocab,
    storage: ram(vocab),
    plugins: [{
      name: 'explicit-join-pilot',
      hooks: {
        precondition: async (batch, tx) => {
          // This host knows the reference direction: only touched result targets.
          const targets = batch.filter((b) => b.result)
          const ids = targets.map((b) =>
            String((b.result as { call: string }).call)
          )
          const stored = await tx.get([
            ...ids,
            ...targets.map((b) => b.entity.eid),
          ])
          const merged = new Map(stored.map((b) => [b.entity.eid, b]))
          for (const b of batch) {
            merged.set(b.entity.eid, { ...merged.get(b.entity.eid), ...b })
          }
          const patches = plan.run([
            ids.flatMap((id) => merged.has(id) ? [merged.get(id)!] : []),
            targets.map((b) => merged.get(b.entity.eid)!),
          ])
          return [...batch, ...patches]
        },
        effect: async (batch, tx) => {
          seen.push(...await tx.get(batch.map((b) => b.entity.eid)))
          return batch
        },
      },
      rules: [{
        phase: 'stamp',
        match: '.entry .entry.seq=',
        run: () => ({ entry: { seq: 7 } }),
      }],
    }],
  })
  await g.apply([{ entity: { eid: 's' }, session: {} }, call])
  seen.length = 0
  await g.apply([result])
  const [row] = await g.read('.result')
  assertEquals(row.entry, { session: 's', seq: 7 })
  assertEquals(seen.find((b) => b.entity.eid == 'r')?.entry, row.entry)
  await g.apply([{ entity: { eid: 'r2' }, result: { call: 'c2' } }, {
    ...call,
    entity: { eid: 'c2' },
  }])
  assertEquals((await g.read('.result')).length, 2)
})

Deno.test('self joins and repeated entity variables use identity equality', () => {
  const a = {
    entity: { eid: 'a' },
    source: { key: 'x', value: 'one' },
    target: { key: 'x' },
  }
  const b = { ...a, entity: { eid: 'b' } }
  const plan = joinRule(
    '$same .source{$value}; $same .target +!label{$value}',
    vocab,
  )
  assertEquals(plan.run([[a], [b, a]]), [{
    entity: { eid: 'a' },
    label: { value: 'one' },
  }])
  assertEquals(plan.run([[a], [b]]), [])
  assertEquals(
    joinRule('.target +!label{$value}; .source{$value}', vocab).run([[a], [a]]),
    [{ entity: { eid: 'a' }, label: { value: 'one' } }],
  )
})

Deno.test('null values do not bind and inconsistent candidate views refuse', () => {
  const plan = joinRule(rule, vocab)
  assertEquals(
    plan.run([[{ ...call, entry: { session: null } }], [result]]),
    [],
  )
  assertThrows(
    () => plan.run([[call], [{ ...call, entry: { session: 'different' } }]]),
    Error,
    'Conflicting candidate',
  )
  assertThrows(() => plan.run([[call]]), Error, 'candidate set')
})
