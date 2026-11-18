import { equal, ok, test, throws } from '@yaks/testing'
import { type Bundle, type Comp, graph, signed } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { authors, retained } from './authorship.ts'
import { authorship } from './tracker.ts'
import { provenanceDoc } from './vocab.ts'

let vocab = loadVocab([provenanceDoc, {
  $defs: {
    note: {
      component: true,
      properties: {
        title: { type: 'string' },
        body: { type: 'string' },
        data: { type: 'object' },
      },
    },
  },
}])
let g = graph({ vocab, storage: ram(vocab), plugins: [authorship(vocab)] })
let owner = '00000000-0000-4000-8000-000000000001'
let stranger = '00000000-0000-4000-8000-000000000002'
let visitor = '00000000-0000-4000-8000-000000000003'
let write = (eid: string, note: Comp, by = owner) =>
  g.apply(signed([{ entity: { eid }, note }], { by }))
let writers = async (eid: string) =>
  [...new Set(authors((await g.get([eid]))[0]).map((a) => a.by))].sort()
await g.apply([owner, stranger, visitor].map((eid) => ({ entity: { eid } })))
await write('edited', { title: 'Member heading' })
await write('edited', { body: 'Stranger instructions' }, stranger)
await write('edited', { title: 'Revised heading' })
await write('removed', { title: 'Member heading' })
await write('removed', { body: 'Stranger instructions' }, stranger)
await write('removed', { body: null })
await write('replaced', { body: 'Stranger instructions' }, stranger)
await write('replaced', { body: 'Completely different wording' })
await write('appended', { body: 'Stranger instructions' }, stranger)
await write('appended', { body: 'Stranger instructions plus member text' })
await write('trimmed', { body: 'Stranger instructions' }, stranger)
await write('trimmed', { body: 'Stranger instructions plus member text' })
await write('trimmed', { body: 'plus member text' })
await write(
  'nested',
  { data: { guest: { body: 'Stranger instructions' } } },
  stranger,
)
await write('nested', {
  data: { guest: { body: 'Stranger instructions' }, member: 'Reply' },
})
await g.apply(
  signed([{ entity: { eid: 'anonymous' }, note: { body: 'Visitor text' } }], {
    via: visitor,
  }),
)
await write('anonymous', { title: 'Member heading' })
await write('deleted', { body: 'Stranger instructions' }, stranger)
await g.apply([{ entity: { eid: 'deleted' }, $delete: true }])
await write('deleted', { title: 'Member heading' })
await write('shifted', { data: { lines: ['Member introduction'] } })
await write('shifted', {
  data: { lines: ['Member introduction', 'Stranger instructions'] },
}, stranger)
await write('shifted', { data: { lines: ['Stranger instructions'] } })
await write('moved', { body: 'Stranger instructions' }, stranger)
await write('moved', { body: null, title: 'Stranger instructions' })

test('every surviving writer remains after later member edits', async () => {
  equal(await writers('edited'), [owner, stranger])
  equal(await writers('appended'), [owner, stranger])
  equal(await writers('nested'), [owner, stranger])
  ok(
    authors((await g.get(['anonymous']))[0]).some((a) =>
      a.via == visitor && !a.by
    ),
  )
})

test('removed words stop contributing even when the stranger created the row', async () => {
  for (let eid of ['removed', 'replaced', 'trimmed', 'deleted']) {
    equal(await writers(eid), [owner])
  }
})

test('a client cannot replace or remove live attribution', async () => {
  await throws(() =>
    g.apply([{ entity: { eid: 'edited' }, authorship: { fields: {} } }])
  )
  await g.apply([{ entity: { eid: 'edited' }, authorship: null }])
  equal(await writers('edited'), [owner, stranger])
})

test('legacy attribution retains both known writers, and replacement lets them go', () => {
  let old: Bundle = {
    entity: { eid: 'legacy' },
    note: { body: 'Stranger instructions', title: 'Member heading' },
    created: { by: stranger },
    updated: { by: owner },
  }
  let fields = retained(
    old,
    { ...old, note: { ...old.note as object, title: 'New heading' } },
    { by: owner },
    vocab,
  )
  ok(Object.values(fields).flat().some((a) => a.by == stranger))
  let changed = retained(
    old,
    { ...old, note: { body: 'Completely different wording' } },
    { by: owner },
    vocab,
  )
  equal([...new Set(Object.values(changed).flat().map((a) => a.by))], [owner])
})

test('large rewrites keep only writers of surviving words', () => {
  let old = {
    entity: { eid: 'large' },
    note: { body: Array.from({ length: 150 }, (_, i) => `old${i}`).join(' ') },
  }
  let fields = retained(undefined, old, { by: stranger }, vocab)
  let next = {
    ...old,
    authorship: { fields },
    note: { body: Array.from({ length: 150 }, (_, i) => `new${i}`).join(' ') },
  }
  let replaced = retained({ ...old, authorship: { fields } }, next, {
    by: owner,
  }, vocab)
  equal([...new Set(Object.values(replaced).flat().map((a) => a.by))], [owner])
  let kept = retained(
    { ...old, authorship: { fields } },
    { ...next, note: { body: next.note.body + ' old149' } },
    { by: owner },
    vocab,
  )
  equal([...new Set(Object.values(kept).flat().map((a) => a.by))].sort(), [
    owner,
    stranger,
  ])
})

test('moving words within a row preserves their writers, including shifted array elements', async () => {
  equal(await writers('shifted'), [owner, stranger])
  equal(await writers('moved'), [owner, stranger])
})

let repeated = {
  entity: { eid: 'repeated' },
  note: { body: 'repeat '.repeat(50) },
}
let initial = retained(undefined, repeated, { by: stranger }, vocab)
let repeatedBefore = { ...repeated, authorship: { fields: initial } }
let repeatedAfter = { ...repeated, note: { body: repeated.note.body + 'new' } }
test('repeated words keep compact ranges instead of growing author lists', () => {
  let fields = retained(repeatedBefore, repeatedAfter, { by: owner }, vocab)
  equal(Object.values(fields).flat().length, 3)
  equal([...new Set(Object.values(fields).flat().map((a) => a.by))].sort(), [
    owner,
    stranger,
  ])
})

await write('reordered', { body: 'display the answer then skip nothing' })
await write(
  'reordered',
  { body: 'skip the answer then display nothing' },
  stranger,
)
await write('reordered', { title: 'Member heading' })
test('rearranging existing words also records the writer who changed their meaning', async () => {
  equal(await writers('reordered'), [owner, stranger])
})
