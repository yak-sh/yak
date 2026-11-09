// A person's search of the Operator's store (operator.ts `textSearch(self)`)
// under workerd's limits, once the store holds every component that says
// whose a thing is: each index's arm reads the person's whole scope.
import { equal, test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import { textSearch } from '@yaks/graph/tools'
import { operatorStore } from './operator-store.ts'
import { durable } from '../../packages/durable-object/testing.ts'
import { seenBy } from './operator-access.ts'
import { rootOf } from './operator-root.ts'

let space = crypto.randomUUID()
let [person, other] = [crypto.randomUUID(), crypto.randomUUID()]
let store = operatorStore(durable())
let [root, theirs] = [rootOf(space, person), rootOf(space, other)]
let one = (b: Omit<Bundle, 'entity'>): Bundle => ({
  entity: { eid: crypto.randomUUID() },
  ...b,
})
await store.g.apply([
  ...[[root, person], [theirs, other]].map(([eid, who]) => ({
    entity: { eid },
    session: {},
    operator_session: { space, person: who },
  })),
  one({ session: {}, spawned: { parent: root } }),
  one({
    doc: { title: 'Pruning the roses' },
    operator_request: { person, space, channel: 'chat', session: root },
  }),
  one({
    entry: { session: root },
    operator_files: { files: [{ name: 'a.png', mime: 'image/png', key: 'k' }] },
  }),
  one({ entry: { session: root }, content: { body: 'Pruning canary' } }),
  one({ entry: { session: theirs }, content: { body: 'Pruning secret' } }),
  one({ memory: {}, doc: { title: 'Pruning memory' } }),
  ...[
    ['operator_ask', 'person'],
    ['operator_letter', 'person'],
    ['operator_text', 'person'],
    ['deliver', 'to'],
    ['draft', 'by'],
  ].map(([comp, by]) => one({ [comp]: { [by]: person } })),
], { trusted: true })

// What a hit says: its title, or an entry's words.
let said = (b: Bundle) =>
  (b.doc as { title?: string })?.title ??
    (b.content as { body: string }).body

test('a person’s search of the Operator’s store finds their words and what nobody owns, not another person’s', async () => {
  let found = await textSearch(seenBy(store.g, person))('Pruning')
  equal(found.map(said).sort(), [
    'Pruning canary',
    'Pruning memory',
    'Pruning the roses',
  ])
})
