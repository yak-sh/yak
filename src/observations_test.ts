// Transient observations stay small, provider-neutral, and subordinate to
// their generation's durable graph evidence.
import { assertEquals } from '@std/assert'
import { foldObservation, observedBy, safeObservation } from './observations.ts'

let sight = (
  kind: 'model' | 'reasoning' | 'tool' | 'clear',
  extra: { text?: string; name?: string } = {},
) =>
  ({
    session: 'session',
    generation: 'generation',
    kind,
    ...extra,
  }) as Parameters<typeof foldObservation>[1]

Deno.test('observation frames admit only bounded typed progress', () => {
  assertEquals(safeObservation(null), undefined)
  assertEquals(
    safeObservation({
      session: 1,
      generation: 'generation',
      kind: 'clear',
    }),
    undefined,
  )
  assertEquals(
    safeObservation({
      session: 'x'.repeat(129),
      generation: 'generation',
      kind: 'clear',
    }),
    undefined,
  )
  assertEquals(safeObservation(sight('model', { text: 'hello' })), {
    session: 'session',
    generation: 'generation',
    kind: 'model',
    text: 'hello',
  })
  let text = safeObservation(sight('model', { text: 'x'.repeat(3000) }))
  assertEquals(text?.kind == 'model' ? text.text.length : 0, 2048)
  let named = safeObservation(sight('tool', { name: 'shell' }))
  assertEquals(named?.kind == 'tool' ? named.name : '', 'shell')
  assertEquals(safeObservation(sight('tool', { name: 'not a tool payload' })), {
    session: 'session',
    generation: 'generation',
    kind: 'tool',
    name: 'tool',
  })
  assertEquals(
    safeObservation(sight('reasoning', { text: '' })),
    undefined,
  )
})

Deno.test('observation state is bounded and a new generation replaces it', () => {
  let state = foldObservation(undefined, sight('model', { text: 'first' }))
  state = foldObservation(state, sight('reasoning', { text: 'thinking' }))
  state = foldObservation(state, sight('tool', { name: 'shell' }))
  state = foldObservation(state, sight('tool', { name: 'shell' }))
  assertEquals(state, {
    generation: 'generation',
    model: 'first',
    reasoning: 'thinking',
    tools: ['shell'],
    rev: 4,
  })
  for (let i = 0; i < 8; i++) {
    state = foldObservation(state, sight('model', { text: 'x'.repeat(2048) }))
  }
  assertEquals(state?.model.length, 12_000)
  assertEquals(state?.model.startsWith('…'), true)
  state = foldObservation(state, {
    ...sight('model', { text: 'next' }),
    generation: 'next',
  })
  assertEquals(state?.generation, 'next')
  assertEquals(state?.model, 'next')
})

Deno.test('durable generation evidence clears its transient preview', () => {
  let state = foldObservation(undefined, sight('model', { text: 'soon' }))!
  assertEquals(
    observedBy(state, [{
      eid: 'output',
      name: 'output',
      comp: { source: 'generation' },
    }]),
    true,
  )
  assertEquals(
    observedBy(state, [{
      eid: 'other',
      name: 'output',
      comp: { source: 'other' },
    }]),
    false,
  )
  assertEquals(foldObservation(state, sight('clear')), undefined)
})
