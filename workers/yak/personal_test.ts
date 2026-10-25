// The guide's example for `personal` (docs/components.md, "Rows that belong to
// one person"): an app's vocab.json read as the store reads it, with each
// member's rows readable and writable by that member alone.
import { equal, test } from '@yaks/testing'
import { assertStringIncludes, assertThrows } from '@std/assert'
import { graph, signed } from '@yaks/graph'
import { personal } from '@yaks/member'
import { ram } from '@yaks/ram'
import { appDoc, appVocab } from './vocab.ts'

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
    equal(see(person, q), [...seen]))
}

test('a member cannot write on another person', () => {
  assertThrows(() => write('bo', 'ana', { mood: { today: 'x' } }))
})

// A `personal` no row could be kept private by is refused at the deploy in the
// sentence that fixes it, and the store's load reads it by the same rule, so a
// manifest never deploys that its store could not load. Both answers are read
// as the file loads: composing the platform's words for a new manifest costs
// more than a case's budget.
let note = (personal: unknown, by?: object) => ({
  $defs: {
    note: {
      personal,
      properties: { text: { type: 'string' }, ...by && { by } },
    },
  },
})
let answer = (read: (manifest: object) => unknown, manifest: object) => {
  try {
    read(manifest)
    return ''
  } catch (e) {
    return (e as Error).message
  }
}
let BY = '"by": {"type": "string", "ref": "entity", "death": "keep"}'
for (
  let [said, manifest] of [
    [
      `note.personal names by, which is no reference — declare ${BY}`,
      note('by', { type: 'string' }),
    ],
    ['note.personal names by, which is no property of note', note('by')],
    ['note.personal is 7 — say "personal": "entity"', note(7)],
  ] as const
) {
  let deploy = answer(appDoc, manifest), load = answer(appVocab, manifest)
  test(`deploy and load refuse: ${said}`, () => {
    assertStringIncludes(deploy, `vocab.json: ${said}`)
    equal(load, deploy)
  })
}
