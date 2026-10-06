/** Generated telemetry is admitted beside tracker context; stored spans and
 * their independent metrics round-trip through the graph's public interface. */
import { graph, mint } from '@yaks/graph'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { ram } from '@yaks/ram'
import { equal, test } from '@yaks/testing'
import { toolsDoc } from '@yaks/tools/vocab'
import { trackerDoc } from '@yaks/tracker/vocab'
import type { Event } from '@yaks/trace'
import { loadVocab } from '@yaks/vocab'
import { project, sample, summarize, timingDoc } from './mod.ts'

test('summaries and separately measured span entities round-trip in a tracker', async () => {
  let vocab = loadVocab([kernelDoc, toolsDoc, trackerDoc, timingDoc], [
    kernelKeywords,
  ])
  let g = graph({ vocab, storage: ram(vocab) })
  let origin = Date.parse('2026-01-01T00:00:00Z')
  let process = mint()
  let eid = mint()
  let spans: Event[] = [{
    id: '1.1',
    kind: 'apply',
    name: 'apply',
    stage: 'end',
    start: 10,
    time: 30,
    duration: 20,
    counts: { bundles: 4, rowsRead: 8, rowsWritten: 2, statements: 3 },
  }, {
    id: '1.2',
    parent: '1.1',
    kind: 'sql',
    name: 'select entity',
    stage: 'end',
    start: 11,
    time: 12,
    duration: 1,
    counts: { rowsRead: 8, rowsWritten: 0, statements: 1 },
  }]
  let summaries = summarize(spans, { process, origin, before: origin + 60_000 })
  let rows = sample(spans, { origin, eid, during: { process } }).rows!
  await g.apply([...summaries, ...rows], { trusted: true })
  let saved = await g.get(rows.map((row) => row.entity.eid))
  for (let i = 0; i < rows.length; i++) {
    for (
      let component of [
        'trace',
        'span',
        'during',
        'elapsed',
        'rows_read',
        'rows_written',
        'statements',
      ] as const
    ) {
      equal(saved[i][component] ?? undefined, rows[i][component])
    }
  }
  equal(saved[2].span, rows[2].span)
  // One metric can be removed while every other measurement and relationship stays.
  await g.apply([{ entity: rows[1].entity, rows_written: null }], {
    trusted: true,
  })
  let [changed] = await g.get([rows[1].entity.eid])
  equal(changed.rows_written, undefined)
  equal(changed.rows_read, { n: 8 })
  equal(changed.statements, { n: 3 })
  equal(changed.elapsed, { start: 0, ms: 20 })
  equal(changed.span, rows[1].span)
  let [summary] = await g.get([summaries[0].entity.eid])
  equal(summary.timing, summaries[0].timing)
})

test('suppressed repeats are a separately removable root span metric', async () => {
  let vocab = loadVocab([kernelDoc, toolsDoc, trackerDoc, timingDoc], [
    kernelKeywords,
  ])
  let g = graph({ vocab, storage: ram(vocab) })
  let rows = project([{
    id: 'root',
    kind: 'request',
    name: 'http query',
    stage: 'end',
    time: 0,
    duration: 0,
  }], {
    origin: 0,
    eid: mint(),
    repeats: 12,
  })
  await g.apply(rows, { trusted: true })
  let [root] = await g.get([rows[1].entity.eid])
  equal(root.repeats, { n: 12 })
  await g.apply([{ entity: root.entity, repeats: null }], { trusted: true })
  let [without] = await g.get([root.entity.eid])
  equal(without.repeats, undefined)
  equal(without.span, root.span)
  equal(without.elapsed, root.elapsed)
})
