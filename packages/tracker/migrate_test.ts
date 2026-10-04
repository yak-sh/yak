// The title transition preserves existing identity, words and occurrences,
// and its second pass changes nothing.
import { equal, ok, test } from '@yaks/testing'
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { docDoc } from '@yaks/doc'
import { toolsDoc } from '@yaks/tools/vocab'
import { ram } from '@yaks/ram'
import { trackerDoc } from './vocab.ts'
import { migrateTitles } from './migrate.ts'

let fixture = () => {
  let legacy = structuredClone(trackerDoc)
  legacy.$defs!.bug.properties!.title = { type: 'string', stamped: true }
  let vocab = loadVocab([kernelDoc, docDoc, toolsDoc, legacy], [kernelKeywords])
  return graph({ vocab, storage: ram(vocab) })
}
test('titles move once without changing identity, errors or edited titles', async () => {
  let g = fixture()
  await g.apply([
    {
      entity: { eid: 'legacy' },
      bug: { fault: 'f', title: 'thrown words', hits: 3 },
    },
    {
      entity: { eid: 'doc' },
      bug: { fault: 'd' },
      doc: { title: 'edited title', body: 'kept body' },
    },
    { entity: { eid: 'bare' }, bug: { fault: 'b' } },
    {
      entity: { eid: 'error' },
      error: { bug: 'bare', message: 'first failure', at: '2026-10-01' },
    },
  ], { trusted: true })
  equal(await migrateTitles(g), 2)
  equal(await migrateTitles(g), 0)
  let [legacy, doc, bare] = await g.get(['legacy', 'doc', 'bare'])
  equal(legacy.doc, { title: 'thrown words' })
  ok(!(legacy.bug as { title?: string }).title)
  equal(doc.doc, { title: 'edited title', body: 'kept body' })
  equal(bare.doc, { title: 'first failure' })
  equal((await g.read('.error')).length, 1)
})
test('different human and legacy titles refuse before clearing either', async () => {
  let g = fixture()
  await g.apply([{
    entity: { eid: 'conflict' },
    bug: { title: 'old' },
    doc: { title: 'edited' },
  }], { trusted: true })
  let refused = false
  try {
    await migrateTitles(g)
  } catch {
    refused = true
  }
  ok(refused)
  let [row] = await g.get(['conflict'])
  equal(row.doc, { title: 'edited' })
  equal((row.bug as { title?: string }).title, 'old')
})
