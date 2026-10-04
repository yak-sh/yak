import { docDoc } from '@yaks/doc'
import { equal, test } from '@yaks/testing'
import { type Graph, graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { toolsDoc } from '@yaks/tools/vocab'
import { effects as registry } from '@yaks/effects'
import { computed, trackerDoc } from './vocab.ts'
import { capture } from './report.ts'
import { effects } from './effects.ts'
import { comp } from './model.ts'

test('declared effects group intake and retain occurrences downstream', async () => {
  let vocab = loadVocab([kernelDoc, toolsDoc, docDoc, trackerDoc], [
    kernelKeywords,
  ])
  let g: Graph
  let fx = registry(vocab, { write: (b) => g.apply(b, { trusted: true }) })
  g = graph({ vocab, storage: ram(vocab, { computed }), plugins: [fx] })
  fx.handle(effects({ graph: g }, { retain: 1 }))
  for (let i = 1; i <= 3; i++) {
    await g.apply(
      capture('broken', {
        sink: () => {},
        eid: String(i),
        fault: 'one',
        at: `2026-10-02T00:00:0${i}Z`,
      }),
      { trusted: true },
    )
  }
  let [bug] = await g.read('.bug *')
  equal(comp(bug, 'bug').hits, 3)
  equal((await g.read('.error')).length, 1)
})
