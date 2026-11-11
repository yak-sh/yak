// A store that keeps each entity's privacy (`_privacy`) admits exactly what one
// reading the declarations admits, for every reader, through every change to
// what the privacy is read from; and is read by the declarations until every
// entity's privacy is current.
import {
  type Bundle,
  graph,
  type Plugin,
  type ReadOpts,
  type Storage,
} from '@yaks/graph'
import { open } from '@yaks/sqlite/db'
import { storage } from '@yaks/sqlite'
import { ram } from '@yaks/ram'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { equal, test } from '@yaks/testing'
import { memberDoc } from './comp.ts'
import { memberKeywords } from './keywords.ts'
import { declarationsOf, personal } from './personal.ts'
import { token } from '@yaks/graph/sha256'
import type { Asked } from './asking.ts'
import { PRIVACY, privacy } from './privacy.ts'

let ref = { type: 'string', ref: 'entity', death: 'keep' }
let words: VocabDoc = {
  $defs: {
    entity: { component: true, type: 'object' },
    person: { component: true, type: 'object', properties: {} },
    note: {
      component: true,
      type: 'object',
      personal: 'by',
      properties: { by: ref },
    },
    memo: {
      component: true,
      type: 'object',
      personal: 'owner',
      properties: { owner: ref },
    },
    page: { component: true, type: 'object', properties: { source: ref } },
    order: {
      component: true,
      type: 'object',
      readers: 'editor',
      properties: {},
    },
    ticket: {
      component: true,
      type: 'object',
      readers: 'person',
      properties: {},
    },
    plain: { component: true, type: 'object', properties: {} },
  },
}
let through = { page: 'source' }
let keeping = loadVocab([memberDoc, words], [memberKeywords])
let declaring = loadVocab([words], [memberKeywords])

let READERS: ReadOpts[] = [
  { person: null },
  { person: null, level: 'viewer' },
  { person: null, level: 'editor' },
  { person: 'ana' },
  { person: 'ana', level: 'viewer' },
  { person: 'ana', level: 'editor' },
  { person: 'bo', level: 'owner' },
  { person: 'cy', level: 'editor' },
]

let at = (eid: string, rest: object = {}): Bundle => ({
  entity: { eid },
  ...rest,
})
let SEED: Bundle[] = [
  at('ana', { person: {} }),
  at('bo', { person: {} }),
  at('n1', { note: { by: 'ana' } }),
  at('n2', { note: { by: 'bo' } }),
  at('n3', { note: { by: 'ana' }, memo: { owner: 'bo' } }),
  at('n4', { note: { by: 'ana' }, order: {} }),
  at('n5', { note: { by: 'ana' }, memo: { owner: 'ana' }, ticket: {} }),
  at('o1', { order: {} }),
  at('t1', { ticket: {} }),
  at('t2', { ticket: {}, order: {} }),
  at('x', { plain: {} }),
  at('p1', { page: { source: 'n1' } }),
  at('p2', { page: { source: 'n2' } }),
  at('p3', { page: {} }),
  at('p4', { page: { source: 'o1' } }),
  at('p5', { page: { source: 't2' } }),
  at('p6', { page: { source: 'x' } }),
  at('p7', { page: { source: crypto.randomUUID() } }),
  at('p8', { page: { source: 'n1' }, note: { by: 'bo' } }),
  at('p9', { page: { source: 'n4' }, ticket: {} }),
]

// The same writes into two stores of each kind, one keeping privacy.
let stores: Record<string, (v: typeof keeping) => Storage> = {
  RAM: (v: typeof keeping) => ram(v),
  SQL: (v: typeof keeping) => {
    let s = storage(open(':memory:'), v)
    s.install()
    return s
  },
}
// `before` written first, by a graph that `earlier` plugins compose.
let pair = (
  make: (v: typeof keeping) => Storage,
  before: Bundle[] = [],
  earlier: (v: typeof keeping) => Plugin[] = () => [],
) =>
  [keeping, declaring].map((v) => {
    let s = make(v)
    graph({ vocab: v, storage: s, plugins: earlier(v) })
      .apply(before, { trusted: true })
    let g = graph({ vocab: v, storage: s })
    g.use(personal(v, {}, through))
    return g
  })
let seen = async (g: ReturnType<typeof graph>, o: ReadOpts) =>
  (await g.read('.entity', o)).map((b) => b.entity.eid).sort()
let agree = async (gs: ReturnType<typeof graph>[]) => {
  for (let o of READERS) {
    let [kept, declared] = await Promise.all(gs.map((g) => seen(g, o)))
    equal(kept, declared, JSON.stringify(o))
  }
}

for (let [name, make] of Object.entries(stores)) {
  test(`${name} a store keeping privacy admits what the declarations admit, through each change`, async () => {
    let gs = pair(make)
    // A store that keeps no privacy is given none.
    let write = (b: Bundle[]) =>
      Promise.all(gs.map((g) => {
        let own = g.vocab.comp(PRIVACY) ? b : b.filter((x) => !(PRIVACY in x))
        return g.apply(own, { trusted: true })
      }))
    await write(SEED)
    // Every entity read from keeps it, and nothing else does.
    equal(
      (await gs[0].read(`.${PRIVACY}`)).map((b) => b.entity.eid).sort(),
      SEED.filter((b) => !b.person && !b.plain).map((b) => b.entity.eid).sort(),
    )
    let p = privacy(declarationsOf(keeping, {}, through))
    // So it is read by them.
    equal(await p.current((line) => gs[0].read(line)), true)
    await agree(gs)
    for (
      let change of [
        [at('n1', { order: {} })], // a source asks a floor
        [at('n1', { order: null })], // and stops
        [at('x', { memo: { owner: 'bo' } })], // a public source made private
        [at('p6', { page: { source: 'n2' } })], // a page moved to another source
        [at('p3', { page: { source: 'x' } })], // a page given a source
        [at('p1', { page: null })], // a page that stops inheriting
        [{ entity: { eid: 'n2' }, $delete: true }], // a source deleted
        [at('t1', { ticket: null })], // an entity that stops bearing
        [at('o1', { [PRIVACY]: null })], // a privacy written by hand is put back
      ] as Bundle[][]
    ) {
      await write(change)
      await agree(gs)
    }
  })

  for (
    let [before, earlier] of [
      ['before it kept privacy', () => []],
      ['under other declarations', (v) => [personal(v)]],
    ] as [string, (v: typeof keeping) => Plugin[]][]
  ) {
    test(`${name} a store holding entities written ${before} is read by the declarations until a pass writes them`, async () => {
      let gs = pair(make, SEED, earlier)
      await agree(gs)
      let p = privacy(declarationsOf(keeping, {}, through))
      let stale = (await Promise.all(p.stale.map((line) => gs[0].read(line))))
        .flat().map((b) => b.entity.eid)
      await gs[0].apply(
        await p.reckon((e, c) => gs[0].get(e, c), stale),
        { trusted: true },
      )
      equal(stale.length > 0, true)
      equal(await p.current((line) => gs[0].read(line)), true)
      await agree(gs)
    })
  }
}

test('declarations hash a floor as ever and conditions as part of them', () => {
  let order = loadVocab({
    $defs: {
      entity: { component: true, type: 'object' },
      order: {
        component: true,
        type: 'object',
        properties: { kind: { type: 'string' } },
      },
    },
  })
  let hashed = (asked: Asked) =>
    privacy({
      owners: [],
      through: [],
      floors: [['order', asked]],
      vocab: order,
    })
      .hash
  equal(
    hashed('editor'),
    token({ owners: [], through: [], floors: [['order', 'editor']] })!
      .slice(0, 16),
  )
  let rush = hashed({ editor: '.order.kind=rush' })
  equal(rush == hashed({ editor: '.order.kind=gift' }), false)
  equal(rush == hashed('editor'), false)
})
