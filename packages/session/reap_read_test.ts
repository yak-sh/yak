// Housekeeping selects identities, never the transcript-derived session fields.
import { test } from '@yaks/testing'
import { assertEquals, assertGreater } from '@std/assert'
import { detached, graph } from '@yaks/graph'
import { fn, val } from '@yaks/sql'
import { mem } from '../sqlite/testing.ts'
import { storage } from '@yaks/sqlite'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { provenanceDoc } from '@yaks/provenance'
import { sessionDoc } from './comp.ts'
import { toolsDoc } from '@yaks/tools/vocab'
import { modelDoc } from '@yaks/model/vocab'
import { sessionDerived } from './status.ts'
import { staleLeases } from './reap.ts'
import { stale } from './service.ts'

let vocab = loadVocab([
  sessionDoc,
  toolsDoc,
  modelDoc,
  kernelDoc,
  provenanceDoc,
], [
  kernelKeywords,
])
let derived = sessionDerived(vocab)
let status = derived['session.status'].expr
let marker = 'housekeeping_read_status_probe'
derived['session.status'].expr = (owner) =>
  fn('coalesce', status(owner), val(marker))
let calls = 0
let d = mem()
let query = d.query.bind(d)
d.query = (statement) => {
  let rows = query(statement)
  // An empty-owner shape lookup compiles the decoder but evaluates no state.
  if (rows.length && JSON.stringify(statement).includes(marker)) calls++
  return rows
}

let s = storage(d, vocab, { derived })
s.install()
s.tx((tx) =>
  tx.patch([
    { entity: { eid: 's' }, session: { id: 's', operator: true } },
    { entity: { eid: 'held' }, claim: { session: 's' } },
  ])
)
let g = graph({ storage: s, vocab })
calls = 0
let freed = await staleLeases(detached(s))
let reapCalls = calls
calls = 0
let pages: string[][] = []
for await (let page of stale(g)) pages.push(page)
let staleCalls = calls
await g.get(['s'])
let wholeCalls = calls

test('reaping existing session holders never derives their transcript state', () => {
  assertEquals(freed, [])
  assertEquals(reapCalls, 0)
  assertGreater(wholeCalls, 0)
})

test('enumerating quiet imported sessions never gathers their transcript state', () => {
  assertEquals(pages, [[]])
  assertEquals(staleCalls, 0)
})
