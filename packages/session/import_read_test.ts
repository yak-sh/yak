// Import bookkeeping must not execute the session's derived status query.
import { test } from '@yaks/testing'
import { assertEquals, assertGreater } from '@std/assert'
import { graph } from '@yaks/graph'
import { fn, val } from '@yaks/sql'
import { mem } from '../sqlite/testing.ts'
import { storage } from '@yaks/sqlite'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { sessionDoc } from './comp.ts'
import { toolsDoc } from '@yaks/tools/vocab'
import { modelDoc } from '@yaks/model/vocab'
import { sessionDerived } from './status.ts'
import { tail } from './tail.ts'

let vocab = loadVocab([sessionDoc, toolsDoc, modelDoc, kernelDoc], [
  kernelKeywords,
])
let derived = sessionDerived(vocab)
let status = derived['session.status'].expr
// COALESCE preserves the real status expression; its fallback marks its AST.
let marker = 'import_read_status_probe'
derived['session.status'].expr = (owner) =>
  fn('coalesce', status(owner), val(marker))
let calls = 0
let d = mem()
let query = d.query.bind(d)
d.query = (statement) => {
  if (JSON.stringify(statement).includes(marker)) calls++
  return query(statement)
}
let s = storage(d, vocab, { derived })
s.install()
s.tx((tx) =>
  tx.patch([{ entity: { eid: 's' }, session: { id: 's', operator: true } }])
)
let g = graph({ storage: s, vocab })

test('opening an imported tail skips status derivation', async () => {
  calls = 0
  let t = await tail(g, '/missing/import-read.jsonl', { session: 's' })
  assertEquals(t.session, 's')
  assertEquals(t.operator, true)
  assertEquals(t.own, true)
  assertEquals(t.line, 0)
  assertEquals(calls, 0)
  // A whole-session read must execute status, even with cached compilation.
  await g.get(['s'])
  assertGreater(calls, 0)
})
