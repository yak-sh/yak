// A kept query names identities, and each reader reads it back in its own
// labels, through a rename of every word it names.
import { equal, test } from '@yaks/testing'
import { assertThrows } from '@std/assert'
import {
  Ambiguous,
  loadVocab,
  type PropSchema,
  type VocabDoc,
} from '@yaks/vocab'
import { identified, labeled } from './mod.ts'

let ids = () => crypto.randomUUID()
let [MODEL, TRIP, COST, TRIP_COST, DOLLARS, EUROS, WHO, NOTE, ABOUT, SAID] =
  Array.from({ length: 10 }, ids)
let urn = (id: string) => `urn:uuid:${id}`
let props = (p: Record<string, [string, PropSchema?]>) =>
  Object.fromEntries(
    Object.entries(p).map(([k, [id, s]]) => [
      k,
      { $id: urn(id), type: 'number', ...s },
    ]),
  )
let doc = (id: string, label: string, $defs: VocabDoc['$defs']): VocabDoc => ({
  $id: urn(id),
  label,
  $defs,
})
let model = doc(MODEL, '@yaks/model', {
  cost: {
    $id: urn(COST),
    component: true,
    properties: props({ dollars: [DOLLARS] }),
  },
})
let trip = (cost = 'cost', euros = 'euros') =>
  doc(TRIP, 'yourname/trip', {
    [cost]: {
      $id: urn(TRIP_COST),
      component: true,
      properties: props({
        [euros]: [EUROS],
        who: [WHO, { type: 'string', ref: 'note', death: 'keep' }],
      }),
    },
    note: {
      $id: urn(NOTE),
      component: true,
      properties: props({
        about: [ABOUT, { type: 'string', ref: 'entity', death: 'keep' }],
        said: [SAID, { type: 'string' }],
      }),
    },
  })

let IN_TRIP = { label: 'yourname/trip' }, IN_MODEL = { label: '@yaks/model' }
let C = TRIP_COST, E = EUROS

// Each row: the query a reader in trip writes, and how the graph keeps it.
let KEPT: [string, string][] = [
  ['.cost.euros>10', `.${C}.${E}>10`],
  ['!cost .note', `!${C}&.${NOTE}`],
  ['.cost.who.note.said~=moss', `.${C}.${WHO}.${NOTE}.${SAID}~=moss`],
  ['.notes!.said=done', `.notes!.${SAID}=done`],
  [
    '.fields=cost.euros,note~ .order=-cost.euros',
    `.fields=${C}.${E},${NOTE}~&.order=-${C}.${E}`,
  ],
  ['.tally=cost.euros .limit=5', `.tally=${C}.${E}&.limit=5`],
  [
    '+cost.euros=1 +!note -cost #note *cost',
    `+${C}.${E}=1&+!${NOTE}&-${C}&#${NOTE}&*${C}`,
  ],
  ['.@yaks/model:cost.dollars=2', `.${COST}.${DOLLARS}=2`],
  ['.entity.eid=T-1 moss', '.entity.eid=T-1 moss'],
]

test('a kept query names identities, and its writer reads it back as written', () => {
  let t = loadVocab([model, trip()]).in(IN_TRIP)
  for (let [q, kept] of KEPT) {
    equal(identified(q, t), kept, q)
    equal(identified(labeled(kept, t), t), kept, q)
  }
  equal(labeled(`.${C}.${E}>10`, t), '.cost.euros>10')
})

test('each reader reads a kept query in its own labels', () => {
  let v = loadVocab([model, trip()])
  let kept = identified('.cost.euros>10 .@yaks/model:cost', v.in(IN_TRIP))
  equal(labeled(kept, v.in(IN_TRIP)), '.cost.euros>10&.@yaks/model:cost')
  equal(labeled(kept, v.in(IN_MODEL)), '.yourname/trip:cost.euros>10&.cost')
  equal(labeled(kept, v), '.yourname/trip:cost.euros>10&.@yaks/model:cost')
  // A rename of every word it names leaves it meaning the same.
  let renamed = loadVocab([model, trip('spend', 'amount')]).in(IN_TRIP)
  equal(labeled(kept, renamed), '.spend.amount>10&.cost')
})

test('a kept query refuses a bare label that means several words', () => {
  let v = loadVocab([model, trip()])
  assertThrows(() => identified('.cost.euros>10', v), Ambiguous)
  // A query naming nothing with an identity is kept as written.
  equal(identified('.doc.title=x  moss', v), '.doc.title=x  moss')
})
