import { assertEquals } from '@std/assert'
import type { Bundle, Graph } from '@yaks/graph'
import { idKeywords } from '@yaks/id'
import { loadVocab } from '@yaks/vocab'
import { docDoc } from '@yaks/doc'
import { sessionDoc } from './comp.ts'
import { hear, said } from './listen.ts'

let vocab = loadVocab([docDoc, sessionDoc], [idKeywords])
let named = (eid: string) => eid.toUpperCase()

Deno.test('an item is one line, whitespace folded, naming what it points at', () => {
  let b: Bundle = {
    entity: { eid: 'c1', num: 7 },
    comment: { target: 't1' },
    created: { via: 's2' },
    doc: { title: '', body: 'two\n\nlines\tand a tab' },
  }
  assertEquals(
    said(vocab, b, named).split(' on ')[1],
    'T1 from S2: two lines and a tab',
  )
})

// A read that answers every query with the same rows, and an apply that keeps
// what it was handed.
let heard = async (rows: Bundle[], session: string) => {
  let lines: string[] = []
  let applied: Bundle[] = []
  let graph = {
    vocab: loadVocab([docDoc, sessionDoc, {
      $defs: {
        comment: {
          component: true,
          type: 'object',
          properties: { target: { type: 'string' } },
        },
        notified: { component: true, type: 'object', properties: {} },
      },
    }], [idKeywords]),
    storage: {
      tx: (run: (tx: { get: () => Bundle[] }) => unknown) =>
        run({ get: () => [] }),
    },
    apply: (bundles: Bundle[]) => (applied.push(...bundles), bundles),
    read: () => rows,
  } as unknown as Graph
  await hear(graph, null, session, (line) => lines.push(line))
  return { lines, marked: applied.map((b) => b.entity.eid) }
}

Deno.test('what the session wrote itself is never said, and what is said is marked', async () => {
  let rows: Bundle[] = [
    {
      entity: { eid: 'c1' },
      comment: { target: 't' },
      created: { via: 'other' },
      doc: { title: '', body: 'hi' },
    },
    {
      entity: { eid: 'c2' },
      comment: { target: 't' },
      created: { via: 'me' },
      doc: { title: '', body: 'mine' },
    },
  ]
  let { lines, marked } = await heard(rows, 'me')
  assertEquals(lines.length, 1)
  assertEquals(marked, ['c1'])
})
