/** A scratch expansion vocabulary rehearses legacy trace conversion and
 * proves it preserves identities, links and independently stored measurements. */
import { graph, mint } from '@yaks/graph'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { ram } from '@yaks/ram'
import { equal, test, throws } from '@yaks/testing'
import { toolsDoc } from '@yaks/tools/vocab'
import { trackerDoc } from '@yaks/tracker/vocab'
import { loadVocab } from '@yaks/vocab'
import { type LegacyTrace, migrateTrace } from './migrate.ts'
import { timingDoc } from './vocab.ts'

let legacy: LegacyTrace = {
  op: 'request',
  name: 'http',
  at: '2026-01-01T00:00:00.000Z',
  ms: 20,
  spans: [{
    id: '0',
    kind: 'request',
    name: 'http',
    start: 0,
    ms: 20,
    counts: { rowsRead: 20, rowsWritten: 2, statements: 3 },
  }, {
    id: '1',
    parent: '0',
    kind: 'sql',
    name: 'select entity',
    start: 1,
    ms: 5,
    counts: { rowsRead: 20, rowsWritten: 0, statements: 1 },
  }],
}

test('legacy rehearsal replaces JSON with measured entities and is resumable', async () => {
  let expansion = structuredClone(timingDoc)
  expansion.$defs!.trace.properties!.ms = { type: 'number' }
  expansion.$defs!.trace.properties!.spans = {
    type: 'array',
    items: { type: 'object', additionalProperties: true },
  }
  let vocab = loadVocab([kernelDoc, toolsDoc, trackerDoc, expansion], [
    kernelKeywords,
  ])
  let g = graph({ vocab, storage: ram(vocab) })
  let eid = mint()
  let process = mint()
  let old = { entity: { eid }, trace: legacy, during: { process } }
  await g.apply([old], { trusted: true })
  let patches = migrateTrace(old)
  let snapshot = structuredClone(old)
  // Rehearsal returns valid patches but commits no change.
  await g.apply(patches, { trusted: true, check: true })
  let [before] = await g.get([eid])
  equal(before.trace, legacy)
  await g.apply(patches, { trusted: true })
  let [trace, root, child] = await g.get(patches.map((row) => row.entity.eid))
  equal(trace.trace, {
    op: 'request',
    name: 'http',
    at: legacy.at,
    ms: null,
    spans: null,
  })
  equal(root.rows_read, { n: 20 })
  equal(root.rows_written, { n: 2 })
  equal(root.statements, { n: 3 })
  equal(root.elapsed, { start: 0, ms: 20 })
  equal(child.elapsed, { start: 1, ms: 5 })
  equal(child.span, {
    trace: eid,
    parent: root.entity.eid,
    op: 'sql',
    name: 'select entity',
  })
  equal(trace.during, old.during)
  equal(root.during, old.during)
  equal(child.during, old.during)
  equal(migrateTrace(trace), [])
  equal(old, snapshot)
})

test('conversion refuses data it cannot preserve as independently named metrics', () => {
  let eid = mint()
  throws(() =>
    migrateTrace({
      entity: { eid },
      trace: {
        ...legacy,
        spans: [{ ...legacy.spans[0], counts: { rows: 4 } }],
      },
    })
  )
  throws(() =>
    migrateTrace({ entity: { eid }, trace: { ...legacy, spans: [] } })
  )
  throws(() =>
    migrateTrace({
      entity: { eid },
      trace: {
        ...legacy,
        spans: [{ ...legacy.spans[1], parent: 'missing' }],
      },
    })
  )
})
