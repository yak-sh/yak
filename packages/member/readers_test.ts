// A component declared `readers` keeps the entity wearing it from every reader
// below that floor, at every read shape, whatever an app's mode lets them read.
import { type Bundle, type Comp, graph, type ReadOpts } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal, test, throws } from '@yaks/testing'
import { memberDoc } from './comp.ts'
import { memberKeywords } from './keywords.ts'
import { personal } from './personal.ts'

let vocab = loadVocab({
  $defs: {
    entity: { component: true, type: 'object' },
    signup: {
      component: true,
      type: 'object',
      readers: 'viewer',
      properties: { answers: { type: 'string' } },
    },
    note: {
      component: true,
      type: 'object',
      properties: {
        about: { type: 'string', ref: 'entity', death: 'keep' },
      },
    },
  },
}, [memberKeywords])
let g = graph({ vocab, storage: ram(vocab) })
await g.apply([
  { entity: { eid: 'ruth' }, signup: { answers: 'Heal Ruth' } },
  { entity: { eid: 'thanks' }, note: { about: 'ruth' } },
])
g.use(personal(vocab))

// What each read shape shows of the sign-up: its answers, or null where the
// reader is kept from it.
let shapes = {
  query: async (o: ReadOpts) => (await g.read('.signup', o))[0]?.signup,
  get: async (o: ReadOpts) => (await g.get(['ruth'], undefined, o))[0]?.signup,
  count: async (o: ReadOpts) =>
    (await g.rows('.signup .count', o))[0]?.n ? 'counted' : undefined,
  reference: async (o: ReadOpts) =>
    ((await g.read('.note', o))[0]?.note as Comp)?.about == 'ruth'
      ? 'named'
      : undefined,
  // A subscription relays a patch the store did not read under the scope.
  relay: async (o: ReadOpts) =>
    (await g.answer([
      { entity: { eid: 'ruth' }, signup: { answers: 'Heal Ruth' } } as Bundle,
    ], { ...o, patch: true }))[0]?.signup,
}
let readers: [string, ReadOpts, boolean][] = [
  ['a guest', { person: null }, false],
  ['a stranger signed in', { person: 'kim' }, false],
  [
    'a stranger claiming no known level',
    { person: 'kim', level: 'boss' },
    false,
  ],
  ['a viewer', { person: 'kim', level: 'viewer' }, true],
  ['an editor', { person: 'kim', level: 'editor' }, true],
  ['a vouched administrator', { person: null, administrative: true }, true],
  ['the platform itself', {}, true],
]
for (let [who, opts, sees] of readers) {
  for (let [shape, ask] of Object.entries(shapes)) {
    test(`${who} ${sees ? 'sees' : 'is kept from'} a sign-up: ${shape}`, async () =>
      equal(!!await ask(opts), sees))
  }
}

// A `readers` object asks a floor only of the entities its queries match.
// `!=` matches an absent property, so the directory names its own.
let directory = loadVocab([memberDoc, {
  $defs: {
    entity: { component: true, type: 'object' },
    individual: {
      component: true,
      type: 'object',
      readers: {
        editor: '.individual.status&.individual.status!=member,attender',
      },
      properties: { status: { type: 'string' } },
    },
  },
}], [memberKeywords])
let person = (eid: string, status?: string) => ({
  entity: { eid },
  individual: status ? { status } : {},
})
let roll = async (...rows: Bundle[]) => {
  let g = graph({ vocab: directory, storage: ram(directory) })
  g.use(personal(directory))
  await g.apply(rows, { trusted: true })
  let read = async (level: 'viewer' | 'editor') =>
    (await g.read('.individual', { person: 'kim', level }))
      .map((b) => b.entity.eid).sort()
  return { g, read }
}
let people = [
  person('noah', 'member'),
  person('ada', 'attender'),
  person('ruth', 'former'),
  person('kid'),
]

test('a viewer reads the entities the conditions leave, an editor all', async () => {
  let { read } = await roll(...people)
  equal(await read('viewer'), ['ada', 'kid', 'noah'])
  equal(await read('editor'), ['ada', 'kid', 'noah', 'ruth'])
})

test('a write that changes the property moves the entity either way', async () => {
  let { g, read } = await roll(...people)
  await g.apply([person('ruth', 'member'), person('noah', 'guest')], {
    trusted: true,
  })
  equal(await read('viewer'), ['ada', 'kid', 'ruth'])
  await g.apply([{ entity: { eid: 'noah' }, individual: { status: null } }], {
    trusted: true,
  })
  equal(await read('viewer'), ['ada', 'kid', 'noah', 'ruth'])
})

test('a subscription relay leaves out what the conditions keep', async () => {
  let { g } = await roll(...people)
  let relay = async (eid: string) =>
    (await g.answer([person(eid, 'former')], {
      person: 'kim',
      level: 'viewer',
      patch: true,
    })).length
  equal([await relay('ruth'), await relay('kid')], [0, 1])
})

test('conditions need a vocabulary that keeps _privacy', () => {
  let bare = loadVocab({
    $defs: {
      entity: { component: true, type: 'object' },
      line: {
        component: true,
        type: 'object',
        readers: { editor: '.line.x' },
        properties: { x: { type: 'string' } },
      },
    },
  }, [memberKeywords])
  return throws(() => personal(bare), '_privacy')
})
