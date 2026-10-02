import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { ram } from '@yaks/ram'
import { loadVocab, type PropSchema } from '@yaks/vocab'
import { inboxCountQueries, inboxQueries } from './queries.ts'

test('an inbox reads declared delivery facets and preserves read/archive policy', () => {
  let component = (properties: Record<string, PropSchema>) => ({
    component: true,
    type: 'object',
    properties,
  })
  let text = { type: 'string' }
  let vocab = loadVocab([{
    $defs: {
      entity: component({ eid: text }),
      comment: component({ target: text }),
      doc: component({ title: text }),
      created: component({ at: text }),
      opened: component({ at: text }),
      archived: component({ at: text }),
    },
  }])
  let rows = [
    { entity: { eid: 'new' }, comment: { target: 'owner' } },
    {
      entity: { eid: 'read' },
      comment: { target: 'owner' },
      opened: { at: 'today' },
    },
    {
      entity: { eid: 'archived' },
      comment: { target: 'owner' },
      archived: { at: 'today' },
    },
    { entity: { eid: 'other' }, comment: { target: 'other' } },
  ]
  let who = { actor: 'owner', addrs: new Set(['owner@example.com']) }
  let store = ram(vocab)
  store.tx((tx) => tx.patch(rows))
  let read = (queries: string[]) =>
    queries.filter(Boolean).flatMap((query) => store.rows(query))
  let candidates = (unread: boolean) =>
    read(inboxQueries(who, unread, vocab)).map((row) => row.eid)
  assertEquals(candidates(false), ['new', 'read'])
  assertEquals(candidates(true), ['new'])
  assertEquals(read(inboxCountQueries(who, vocab)), [{ value: '', n: 1 }])
})
