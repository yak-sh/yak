// The guide's example for `personal` (docs/components.md, "Rows that belong to
// one person"): an app's vocab.json read as the store reads it, with each
// member's rows readable and writable by that member alone.
import { test } from '@yaks/testing'
import { assertEquals, assertThrows } from '@std/assert'
import { graph, signed } from '@yaks/graph'
import { personal } from '@yaks/member'
import { ram } from '@yaks/ram'
import { appVocab } from './vocab.ts'

let manifest = {
  $defs: {
    note: {
      personal: 'by',
      properties: {
        text: { type: 'string' },
        by: { type: 'string', ref: 'entity', death: 'keep' },
      },
    },
    mood: { personal: 'entity', properties: { today: { type: 'string' } } },
  },
}

let vocab = appVocab(manifest)
let g = graph({ vocab, storage: ram(vocab) })
g.use(personal(vocab))
let people = ['ana', 'bo', 'cy']
g.apply(people.map((eid) => ({ entity: { eid }, person: {} })), {
  trusted: true,
})
let write = (by: string, eid: string, row: object) =>
  g.apply(signed([{ entity: { eid }, ...row }], { by }))
write('ana', 'n1', { note: { text: 'hers' } })
write('bo', 'n2', { note: { text: 'his' } })
write('ana', 'ana', { mood: { today: 'calm' } })
write('bo', 'bo', { mood: { today: 'busy' } })

type Row = { note?: { text: string }; mood?: { today: string } }
let see = (person: string, q: string) =>
  (g.read(q, { person }) as Row[]).map((r) => r.note?.text ?? r.mood?.today)

for (
  let [person, q, seen] of [
    ['ana', '.note', ['hers']],
    ['bo', '.note', ['his']],
    ['cy', '.note', []],
    ['ana', '.mood', ['calm']],
    ['bo', '.mood', ['busy']],
    ['cy', '.mood', []],
  ] as const
) {
  test(`${person} sees ${q} as ${seen.join() || 'nothing'}`, () =>
    assertEquals(see(person, q), seen))
}

test('a member cannot write on another person', () => {
  assertThrows(() => write('bo', 'ana', { mood: { today: 'x' } }))
})

test('personal naming a property that is no reference is refused', () => {
  assertThrows(() =>
    personal(appVocab({
      $defs: {
        note: { personal: 'by', properties: { by: { type: 'string' } } },
      },
    }))
  )
})
