// A graph describing the vocabulary it is served with, as the vocabulary a
// store is served with changes under it.

import { whole } from '@yaks/query'
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { docDoc } from '@yaks/doc/vocab'
import { edgeDoc, edgeKeywords, edges } from '@yaks/edge'
import { type Comp, type Graph, graph, identityEid } from '@yaks/graph'
import { derivedEid, mint } from '@yaks/graph/identity'
import { gitDoc } from '@yaks/git'
import { fileDoc } from '@yaks/file/vocab'
import { ram } from '@yaks/ram'
import {
  labelled,
  loadVocab,
  metaDoc,
  type PropSchema,
  type VocabDoc,
} from '@yaks/vocab'
import { codeDoc } from './vocab.ts'
import { described, describing } from './described.ts'

let entity = {
  $defs: {
    entity: {
      component: true,
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
  },
}
let base = [entity, edgeDoc, fileDoc, gitDoc, docDoc, codeDoc, metaDoc]

let note = (properties: Record<string, PropSchema>, before = ['doc']) => ({
  component: true,
  type: 'object',
  kind: true,
  before,
  properties,
})
let p = (props: Record<string, PropSchema>, before?: string[]): VocabDoc => ({
  label: '@t/p',
  description: 'Notes.',
  $defs: { note: note(props, before) },
})
let q: VocabDoc = {
  label: '@t/q',
  $defs: {
    note: {
      component: true,
      extends: true,
      properties: { c: { type: 'boolean' } },
    },
    note_tidy: { effect: true, created: ['note'], description: 'tidy a note' },
  },
}

// One store, each graph over it served with its own vocabulary, as a server
// restarted over new code is; `serve` also describes it, as a worker starting
// does (./effects.ts).
let store = () => {
  let storage = ram(loadVocab(base, [edgeKeywords]))
  return async (docs: VocabDoc[]) => {
    let vocab = loadVocab([...base, ...docs], [edgeKeywords])
    let g = graph({ storage, vocab, plugins: [edges(vocab)] })
    await g.apply(await described(g, g.vocab.docs), { trusted: true })
    return g
  }
}

// A graph over a store of its own that derives its description when read.
let deriving = () => {
  let storage = ram(loadVocab(base, [edgeKeywords]))
  return (docs: VocabDoc[]) => {
    let vocab = loadVocab([...base, ...docs], [edgeKeywords])
    return graph({ storage, vocab, plugins: [edges(vocab), describing] })
  }
}

test('a graph describes what it is served with, and stops describing what it is not', async () => {
  let stored = store(), derived = deriving()
  let g!: Graph, d!: Graph
  let serve = async (docs: VocabDoc[]) => {
    g = await stored(docs)
    d = derived(docs)
  }
  // Each answer the stored description gives, the derived one gives too.
  let both = async (read: (g: Graph) => Promise<string[]>) => {
    let said = await read(g)
    assertEquals((await read(d)).sort(), said.sort())
    return said
  }
  let titles = (q: string) =>
    both(async (g) =>
      (await g.read(whole(`${q} ?doc`))).map((b) =>
        (b.doc as Comp).title as string
      )
    )
  let note = identityEid('_comp', ['note'])
  let eids = (q: string) =>
    both(async (g) => (await g.read(whole(q))).map((b) => b.entity.eid))
  let kind = identityEid('_kind', ['note'])
  let befores = async () => (await eids(`._before .edge.from=${kind}`)).length
  await serve([p({ a: { type: 'string' }, b: { type: 'number' } }), q])

  // The fixtures' own documents are namespaces by their `$id`, unlabelled.
  let labels = async () => (await titles('._namespace')).filter(Boolean)
  assertEquals(await labels(), ['@t/p', '@t/q'])
  let [pkg] = await g.read('._namespace.name=@t/p ?doc')
  assertEquals((pkg.doc as Comp).body, 'Notes.')
  assertEquals(await titles('._comp.namespace._namespace.name=@t/p'), ['note'])
  assertEquals(await titles('._prop.comp._comp.name=note'), [
    'note.a',
    'note.b',
    'note.c',
  ])
  assertEquals(await titles('._prop.namespace._namespace.name=@t/q'), [
    'note.c',
  ])
  assertEquals(await titles('._effect.namespace._namespace.name=@t/q'), [
    'note_tidy',
  ])
  assertEquals(await titles('._kind.namespace._namespace.name=@t/p'), ['note'])
  assertEquals(await befores(), 1)
  assertEquals((await eids(`.refs=${note}`)).length, 4)
  // A description is read by its eid, and a read that requires a component
  // no description wears answers none.
  assertEquals(await eids(`.entity.eid=${note}`), [note])
  assertEquals(await eids(`.entity.eid=${note}&.note`), [])
  assertEquals(
    (await d.get([note], ['_comp']))[0]._comp,
    (await g.get([note], ['_comp']))[0]._comp,
  )
  for (
    let query of [
      '._namespace ?doc',
      '._comp ?doc',
      '._kind ?doc',
      '._effect ?doc',
      '._extends ?doc',
      '._prop ?doc',
      '._before ?edge',
    ]
  ) {
    let byId = (
      a: { entity: { eid: string } },
      b: { entity: { eid: string } },
    ) => a.entity.eid.localeCompare(b.entity.eid)
    assertEquals(
      (await d.read(whole(query))).sort(byId),
      (await g.read(whole(query))).sort(byId),
    )
  }
  // Described already, so a worker starting writes nothing.
  assertEquals(await described(g, g.vocab.docs), [])

  // A property and a `before` no longer served are cleared, and so is a
  // package no longer listed, with what it added.
  await serve([p({ a: { type: 'string' } }, [])])
  assertEquals(await titles('._prop.comp._comp.name=note'), ['note.a'])
  assertEquals(await labels(), ['@t/p'])
  assertEquals(await titles('._effect.name=note_tidy'), [])
  assertEquals(await befores(), 0)

  // A component no longer served is cleared; served again, it is back on
  // the same entity.
  await serve([])
  assertEquals(await titles('._comp.name=note'), [])
  assertEquals(await titles('._kind.name=note'), [])
  await serve([p({ a: { type: 'string' } })])
  assertEquals(await eids('._comp.name=note'), [note])

  // A derived description reads past what an earlier copy left, and a
  // namespace the graph names itself still stands.
  let own = labelled(derivedEid).namespace('@t/own')
  await d.apply([
    {
      entity: { eid: identityEid('_comp', ['gone']) },
      _comp: { name: 'gone' },
    },
    { entity: { eid: note }, doc: { title: 'stale' } },
    { entity: { eid: own }, _namespace: { name: '@t/own' } },
  ], { trusted: true })
  assertEquals(await d.read('._comp.name=gone'), [])
  assertEquals(
    await d.read('._comp.name=note ?doc'),
    await g.read('._comp.name=note ?doc'),
  )
  assertEquals((await d.read('._namespace.name=@t/own')).length, 1)
})

test('a retained declaration reads only changed description identities and resumes', async () => {
  let old = [
    p({
      kept: { type: 'string' },
      a: { type: 'string', description: 'Old text.', computed: true },
      b: { type: 'number' },
    }),
    q,
  ]
  let serve = store(), g = await serve(old)
  let next = [p({ kept: { type: 'string' }, a: { type: 'string' } }, [])]
  let read = g.read.bind(g), get = g.get.bind(g)
  let scans = 0, identities: string[] = []
  g.read = (line, opts) => {
    scans++
    return read(line, opts)
  }
  g.get = (ids, comps) => {
    identities.push(...ids)
    return get(ids, comps)
  }
  let patch = await described(g, [...base, ...next], [...base, ...old])
  assertEquals(scans, 0)
  assertEquals(
    identities.includes(
      identityEid('_prop', [identityEid('_comp', ['note']), 'kept']),
    ),
    false,
  )
  let id = identityEid('_prop', [identityEid('_comp', ['note']), 'a'])
  let changed = patch.find((b) => b.entity.eid == id)!
  assertEquals((changed._prop as Comp).computed, null)
  assertEquals((changed.doc as Comp).body, null)
  // An interrupted pass commits only one batch. The old declaration remains
  // the comparison until the global marker is committed last.
  await g.apply(patch.slice(0, 1), { trusted: true })
  let resumed = await described(g, [...base, ...next], [...base, ...old])
  await g.apply(resumed, { trusted: true })
  assertEquals(await described(g, [...base, ...next], [...base, ...next]), [])
  let [stored] = await get([id], ['_prop', 'doc'])
  assertEquals(Object.hasOwn(stored._prop as Comp, 'computed'), false)
  assertEquals(Object.hasOwn(stored.doc as Comp, 'body'), false)
  let d = deriving()(next)
  assertEquals(await d.get([id], ['_prop', 'doc']), [stored])
  assertEquals(
    (await read('._prop.comp._comp.name=note')).map((b) =>
      (b._prop as Comp).name
    ),
    ['kept', 'a'],
  )
})

test('a renamed word keeps its row, and the label it had', async () => {
  let ids = { comp: mint(), prop: mint() }
  let named = (comp: string, prop: string): VocabDoc => ({
    label: '@t/p',
    $defs: {
      [comp]: {
        $id: `urn:uuid:${ids.comp}`,
        component: true,
        properties: { [prop]: { $id: `urn:uuid:${ids.prop}`, type: 'string' } },
      },
    },
  })
  let serve = store()
  let labels = async (docs: VocabDoc[]) => {
    let g = await serve(docs)
    let [c, p] = await g.get([ids.comp, ids.prop], ['_comp', '_prop'])
    let { name, former } = c._comp as Comp, prop = p._prop as Comp
    return [name, former, prop.name, prop.former, prop.comp]
  }
  assertEquals(await labels([named('jar', 'label')]), [
    'jar',
    undefined,
    'label',
    undefined,
    ids.comp,
  ])
  assertEquals(await labels([named('pot', 'label')]), [
    'pot',
    ['jar'],
    'label',
    undefined,
    ids.comp,
  ])
  assertEquals(await labels([named('crock', 'name')]), [
    'crock',
    ['jar', 'pot'],
    'name',
    ['label'],
    ids.comp,
  ])
  assertEquals(await labels([named('jar', 'name')]), [
    'jar',
    ['pot', 'crock'],
    'name',
    ['label'],
    ids.comp,
  ])
})
