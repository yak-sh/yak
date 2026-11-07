// Admission costs what the children holding a place cost, however many have
// settled: every child spawned keeps its legacy `dispatch` once settled, so an
// Operator store that has run for weeks holds thousands of them.
import { type Bundle, graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { storage } from '@yaks/sqlite'
import { equal, ok, test } from '@yaks/testing'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { provenanceDoc } from '@yaks/provenance'
import { stepping } from '../sqlite/testing.ts'
import { sessionDoc } from './comp.ts'
import { active, queue, tail } from './admission.ts'

let vocab = loadVocab([kernelDoc, provenanceDoc, sessionDoc], [kernelKeywords])

// A store whose `settled` children ran before one active and one queued.
let store = async (settled: number) => {
  let { driver, steps } = stepping()
  let s = storage(driver, vocab)
  s.install()
  let g = graph({ storage: s, vocab })
  let child = (eid: string, dispatch: Bundle['dispatch'], marks = {}) => ({
    entity: { eid },
    session: {},
    dispatch,
    ...marks,
  })
  await g.apply([
    ...Array.from(
      { length: settled },
      (_, n) => child(`done-${n}`, { state: 'settled', order: n }),
    ),
    child('holder', { state: 'active', order: settled }, { admitted: {} }),
    child('next', { order: settled + 1 }),
  ], { trusted: true })
  return { g, steps }
}

let cost = async (settled: number) => {
  let { g, steps } = await store(settled)
  let before = steps()
  equal(await active(g), 1)
  equal((await queue(g)).map((b) => b.entity.eid), ['next'])
  equal(await tail(g), settled + 2)
  return steps() - before
}

test('admission reads no settled child, in SQLite as well as in its answers', async () => {
  let few = await cost(10)
  let many = await cost(200)
  ok(many < few * 1.5, `${few} VM steps among 10 settled, ${many} among 200`)
})
