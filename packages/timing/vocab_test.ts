/** Generated telemetry is admitted beside tracker context and round-trips
 * whole JSON distributions and trees through the graph's public interface. */
import { graph, mint } from '@yaks/graph'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { ram } from '@yaks/ram'
import { equal, test } from '@yaks/testing'
import { toolsDoc } from '@yaks/tools/vocab'
import { trackerDoc } from '@yaks/tracker/vocab'
import type { Event } from '@yaks/trace'
import { loadVocab } from '@yaks/vocab'
import { sample, summarize, timingDoc } from './mod.ts'

test('summary and trace bundles round-trip in a composed tracker vocabulary', async () => {
  let vocab = loadVocab([kernelDoc, toolsDoc, trackerDoc, timingDoc], [
    kernelKeywords,
  ])
  let g = graph({ vocab, storage: ram(vocab) })
  let origin = Date.parse('2026-01-01T00:00:00Z')
  let process = mint()
  let spans: Event[] = [{
    id: '1.1',
    kind: 'apply',
    name: 'apply',
    stage: 'end',
    start: 10,
    time: 30,
    duration: 20,
    counts: { bundles: 4, rows: 8 },
  }]
  let rows = summarize(spans, { process, origin, before: origin + 60_000 })
  let trace = sample(spans, { origin }).trace!
  let eid = mint()
  await g.apply([...rows, { entity: { eid }, trace, during: { process } }], {
    trusted: true,
  })
  let saved = await g.get([rows[0].entity.eid, eid])
  equal(saved[0].timing, rows[0].timing)
  equal(saved[0].during, { process })
  equal(saved[1].trace, trace)
  equal(saved[1].during, { process })
})
