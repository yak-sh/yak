// Stored rows round-trip through a graph, and marks determine registration status.

import { type Comp, graph } from '@yaks/graph'
import { kernelDoc } from '@yaks/kernel/vocab'
import { ram } from '@yaks/ram'
import { equal, test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { formsDoc } from './vocab.ts'

let vocab = loadVocab([kernelDoc, formsDoc])
let g = graph({ vocab, storage: ram(vocab) })
let at = '2026-11-08T12:00:00Z'
await g.apply([
  { entity: { eid: 'form' }, form: { capacity: 3 } },
  {
    entity: { eid: 'question' },
    question: {
      form: 'form',
      label: 'Your name',
      kind: 'line',
      required: true,
    },
  },
  {
    entity: { eid: 'registration' },
    registration: { form: 'form', answers: { question: 'Sam' }, at },
  },
])
let [registration] = await g.read('.registration')

test('registration answers and their supplied timestamp round-trip', () => {
  equal(registration.registration, {
    form: 'form',
    answers: { question: 'Sam' },
    at,
    status: 'open',
  })
})

let transitions = [
  { name: 'completion', initial: {}, patch: { completed: {} }, status: 'done' },
  {
    name: 'waitlisting takes precedence over completion',
    initial: { completed: {} },
    patch: { waitlisted: {} },
    status: 'waitlisted',
  },
  {
    name: 'cancellation takes precedence over waitlisting',
    initial: { completed: {}, waitlisted: {} },
    patch: { cancelled: {} },
    status: 'cancelled',
  },
  {
    name: 'removing marks reopens a registration',
    initial: { completed: {}, waitlisted: {}, cancelled: {} },
    patch: { completed: null, waitlisted: null, cancelled: null },
    status: 'open',
  },
]

for (let { name, initial, patch, status } of transitions) {
  let store = graph({ vocab, storage: ram(vocab) })
  await store.apply([
    { entity: { eid: 'form' }, form: {} },
    {
      entity: { eid: 'registration' },
      registration: { form: 'form' },
      ...initial,
    },
  ])
  let query = `.registration.status=${status}&*`
  await store.read(query)
  test(name, async () => {
    await store.apply([{ entity: { eid: 'registration' }, ...patch }])
    let [row] = await store.read(query)
    equal((row.registration as Comp).status, status)
    for (let mark of ['completed', 'waitlisted', 'cancelled']) {
      if (row[mark]) equal(typeof (row[mark] as Comp).at, 'string')
    }
  })
}
