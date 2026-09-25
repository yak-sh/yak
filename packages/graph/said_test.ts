// A query line's ids, addressed. The graph-wide effect (a `/query` line that
// says a name) rides on `graph.read`; these are the pure halves.

import { assertEquals } from '@std/assert'
import { loadVocab } from '@yaks/vocab'
import { parse } from '@yaks/query'
import type { Eid } from './bundle.ts'
import { addressing } from './said.ts'

let vocab = loadVocab([{
  $defs: {
    entity: { component: true, wire: false, properties: {} },
    person: { component: true, properties: { name: { type: 'string' } } },
    decided: {
      component: true,
      properties: {
        by: { type: 'string', ref: 'person' },
        at: { type: 'string' },
        how: { type: 'string', enum: ['yes', 'no'] },
      },
    },
  },
}])

let JEFF = 'a3f19c02-4b00-4000-8000-000000000001' as Eid
let at = new Map<string, Eid>([['jeff', JEFF], ['P-1', JEFF]])
let aim = addressing(vocab)
// Every call is synchronous here, so the answer is the query itself.
let said = (q: string) =>
  aim(
    q,
    (ids) =>
      new Map(ids.flatMap((id) =>
        at.has(id) ? [[id, at.get(id)!] as [string, Eid]] : []
      )),
  )
// What the line asked about, whether or not anything moved.
let asked = (q: string) => {
  let seen: string[] = []
  aim(q, (ids) => (seen = ids, new Map()))
  return seen
}

Deno.test('a reference property takes the name it is told', () => {
  assertEquals(said('.decided.by=jeff'), parse(`.decided.by=${JEFF}`))
  assertEquals(said('.decided.by!=jeff'), parse(`.decided.by!=${JEFF}`))
})

Deno.test('a list on a reference is any-of, so each item is addressed', () => {
  assertEquals(
    said('.decided.by=jeff,P-1'),
    parse(`.decided.by=${JEFF},${JEFF}`),
  )
})

Deno.test("an entity's own eid names it, a range of eids does not", () => {
  assertEquals(said('.eid=jeff'), parse(`.eid=${JEFF}`))
  assertEquals(asked('.entity.eid=#47e9678bdf,P-1'), ['#47e9678bdf', 'P-1'])
  assertEquals(asked('.entity.eid=47e9..47ea'), [])
})

Deno.test('the backlink, the walk and the neighbour name entities too', () => {
  assertEquals(asked('.refs=jeff'), ['jeff'])
  assertEquals(asked('.requires->P-1'), ['P-1'])
  assertEquals(asked('.near=jeff'), ['jeff'])
})

Deno.test('a scalar, an enum and an absence name nobody', () => {
  assertEquals(asked('.person.name=jeff'), [])
  assertEquals(asked('.decided.how=yes'), [])
  assertEquals(asked('!decided.by'), [])
  assertEquals(asked('.decided'), [])
  assertEquals(asked('jeff'), [])
})

Deno.test('a substring on a reference is not an id, so it is left alone', () => {
  assertEquals(asked('.decided.by~=a3f1'), [])
})

Deno.test('a line naming nobody, and one nobody answers for, come back whole', () => {
  assertEquals(said('.decided.how=yes&.limit=3'), '.decided.how=yes&.limit=3')
  assertEquals(said('.decided.by=nobody'), '.decided.by=nobody')
})
