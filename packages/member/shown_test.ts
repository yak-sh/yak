// A component declared `shown` is left off the entity wearing it for every
// reader below that floor, at every read shape, while the entity's other
// components read as they would.
import { type Bundle, type Comp, graph, type ReadOpts } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal, test } from '@yaks/testing'
import { memberDoc } from './comp.ts'
import { floored, memberKeywords } from './keywords.ts'
import { personal } from './personal.ts'

let text = { type: 'string' }
let vocab = loadVocab([memberDoc, {
  $defs: {
    entity: { component: true, type: 'object' },
    individual: {
      component: true,
      type: 'object',
      readers: {
        editor: '.individual.status&.individual.status!=member,attender',
      },
      properties: { first: text, status: text },
    },
    interests: {
      component: true,
      type: 'object',
      shown: 'editor',
      properties: { choices: { type: 'array', items: text } },
    },
  },
}], [memberKeywords])
let g = graph({ vocab, storage: ram(vocab) })
g.use(personal(vocab))
let ann: Bundle = {
  entity: { eid: 'ann' },
  individual: { first: 'Ann', status: 'member' },
  interests: { choices: ['a mailbox'] },
}
await g.apply([ann], { trusted: true })

let choices = (b: Bundle | undefined) =>
  (b?.interests as Comp | undefined)?.choices
// What each read shape shows: the person's first name and their choices.
let shapes = {
  query: async (o: ReadOpts) => (await g.read('.individual&?interests', o))[0],
  get: async (o: ReadOpts) => (await g.get(['ann'], undefined, o))[0],
  relay: async (o: ReadOpts) =>
    (await g.answer([ann], { ...o, patch: true }))[0],
}
let readers: [string, ReadOpts, boolean][] = [
  ['a stranger signed in', { person: 'kim' }, false],
  ['a viewer', { person: 'kim', level: 'viewer' }, false],
  ['an editor', { person: 'kim', level: 'editor' }, true],
  ['the platform itself', {}, true],
]
for (let [who, opts, sees] of readers) {
  for (let [shape, ask] of Object.entries(shapes)) {
    test(`${who} ${sees ? 'reads' : 'reads without'} interests: ${shape}`, async () => {
      let b = await ask(opts)
      equal([(b?.individual as Comp)?.first, choices(b)], [
        'Ann',
        sees ? ['a mailbox'] : undefined,
      ])
    })
  }
}

test('a reader below the floor finds nobody by what they chose', async () => {
  let found = (level: 'viewer' | 'editor') =>
    g.read('.interests.choices', { person: 'kim', level })
  equal([(await found('viewer')).length, (await found('editor')).length], [
    0,
    1,
  ])
})

test('shown is a floor', () =>
  equal(floored({ $defs: { line: { shown: 'all' } } }), [
    'line is shown to "all" — shown is person, viewer, editor or owner',
  ]))
