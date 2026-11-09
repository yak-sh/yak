// A component declared `readers` keeps the entity wearing it from every reader
// below that floor, at every read shape, whatever an app's mode lets them read.
import { type Bundle, type Comp, graph, type ReadOpts } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal, test } from '@yaks/testing'
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
