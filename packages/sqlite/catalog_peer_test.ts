// A held catalog must survive unrelated commits, but never descriptor changes,
// missing tracking triggers, schema replacement or unclassified owner rows.
import { equal, test } from '@yaks/testing'
import { archetypeDoc, archetypes } from '@yaks/archetype'
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { open } from './db.ts'
import { storage } from './mod.ts'
import { shop } from './testing.ts'
import { catalog } from './catalog.ts'
let dir = Deno.makeTempDirSync({ prefix: 'catalog-peer-' })
let path = `${dir}/graph.db`, writer = open(path)
let vocab = loadVocab([...shop.docs, archetypeDoc]),
  store = storage(writer, vocab)
store.install()
let g = graph({ storage: store, vocab, plugins: [archetypes()] })
g.apply([{ entity: { eid: 'one' }, doc: { title: 'One' } }])
g.apply([{ entity: { eid: 'one' }, doc: { title: 'Second' } }])
let reader = open(path, { readOnly: true })
catalog(reader)({ all: ['doc'], none: [] })
g.apply([{ entity: { eid: 'one' }, doc: { title: 'Changed' } }])
let unrelated = !!catalog(reader).held
// A new shape changes the table token, so no old descriptor set is advertised.
g.apply([{ entity: { eid: 'two' }, doc: {}, product: {} }])
let changed = !!catalog(reader).held
let replaced = catalog(reader)
// The hint was false before refresh. Its eventual query must still observe
// the new shape, not the set retained before this peer commit.
let newShape = replaced({ all: ['product'], none: [] })

let matched = catalog(reader)({ all: ['doc'], none: [] })
let refreshed = !!catalog(reader).held
// Even when descriptor rows stay held, snapshot() declines unclassified owners.
writer.query({
  t: 'insert',
  into: 'entity',
  cols: ['eid'],
  rows: [[{ t: 'val', v: 'raw' }]],
})
let unclassified = catalog(reader)({ all: ['doc'], none: [] })
writer.query({ t: 'drop', kind: 'trigger', name: 'archetype_version_insert' })
let missing = !!catalog(reader).held
reader.close()
writer.close()
Deno.removeSync(dir, { recursive: true })
test('held shape descriptors survive an unrelated peer commit', () =>
  equal(unrelated, true))
test('held shape descriptors decline changed descriptor tokens', () => {
  equal(changed, false)
  equal(refreshed, true)
  equal(Array.isArray(matched), true)
  equal(newShape?.length, 1)
})
test('held shape descriptors never bypass unclassified owner checks', () =>
  equal(unclassified, undefined))
test('held shape descriptors decline missing tracking triggers', () =>
  equal(missing, false))
