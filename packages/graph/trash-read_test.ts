// Trash snapshots retain the read policy of their original components.
import { equal, test } from '@yaks/testing'
import { graph } from './graph.ts'
import type { Bundle } from './bundle.ts'
import { readTrash } from './trash-read.ts'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { absent, and, eq, or } from '@yaks/query/core'
import { assertRejects } from '@std/assert'
import { Refused } from './errors.ts'

let vocab = loadVocab({
  $defs: {
    note: {
      component: true,
      properties: {
        by: { type: 'string', ref: 'entity', death: 'keep' },
        body: { type: 'string' },
        source: { type: 'string', ref: 'entity', death: 'keep' },
      },
    },
    private: { component: true },
  },
})
let row = (eid: string, by: string): Bundle => ({
  entity: { eid, archetype: 'stored-shape' },
  note: { by, body: eid },
  private: {},
})
let saved = [row('mine', 'alice'), row('theirs', 'bob')]
let store = ram(vocab)
let g = graph({
  vocab,
  storage: {
    ...store,
    trash: (ids?: string[]) =>
      ids?.length === 0 ? [] : [{
        id: 'deletion',
        at: '2026-11-18T00:00:00.000Z',
        bundles: saved,
      }],
  },
  plugins: [{
    name: 'visibility',
    scope: () => ({
      entity: and(eq('note.by', 'alice')),
      components: { private: and(eq('entity.eid', 'alice')) },
    }),
  }],
})

test('trash reads hide foreign snapshots and restricted components', async () => {
  let [entry] = await readTrash(g)
  equal(entry.id, 'deletion')
  equal(entry.bundles, [{
    entity: { eid: 'mine' },
    note: { by: 'alice', body: 'mine' },
  }])
  equal(saved[0].private, {})
  equal(saved[0].entity.archetype, 'stored-shape')
})

test('an explicit empty trash selection reads nothing', async () => {
  equal(await readTrash(g, []), [])
})

let linkedStore = ram(vocab)
await linkedStore.tx((tx) => tx.patch([row('source', 'bob')]))
let linked = graph({
  vocab,
  storage: {
    ...linkedStore,
    trash: () => [{
      id: 'linked-deletion',
      at: '2026-11-18T00:00:00.000Z',
      bundles: [{ entity: { eid: 'linked' }, note: { source: 'source' } }],
    }],
  },
  plugins: [{
    name: 'source-visibility',
    scope: () => ({
      entity: and(
        or(absent('note.source'), eq('note.source.note.by', 'alice')),
      ),
    }),
  }],
})

test('trash reference scopes consult the live source ownership', async () => {
  equal(await readTrash(linked), [])
})

let noTrash = graph({ vocab, storage: { ...ram(vocab), trash: undefined } })
test('a graph without trash refuses a trash read', async () => {
  await assertRejects(() => readTrash(noTrash), Refused, 'keeps no trash')
})
