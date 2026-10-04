// A platform vocabulary edit changes only the schema rows it actually edits.
import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { graph } from '@yaks/graph'
import { described } from '@yaks/code/effects'
import { mem } from '../../packages/sqlite/testing.ts'
import { storage } from '@yaks/sqlite'
import { appDerived, appVocab } from './vocab.ts'

test('a platform schema edit does not rewrite unchanged app schema pages', async () => {
  let d = mem(), v = appVocab(), s = storage(d, v, { derived: appDerived(v) })
  s.install()
  let g = graph({ storage: s, vocab: v })
  await g.apply(await described(g, v.docs), { trusted: true })
  assertEquals(await described(g, v.docs), [])
  let docs = structuredClone(v.docs)
  let doc = docs.find((d) => d.$defs?.doc?.properties?.title)!
  doc.$defs!.doc.properties!.title.description = 'A changed schema description.'
  let changes = await described(g, docs)
  assertEquals(changes.length, 2)
})
