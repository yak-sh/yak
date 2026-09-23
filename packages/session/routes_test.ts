// The door's half: a request says which run it speaks for, and what it writes
// carries that run and whoever the run speaks as.

import { assertEquals } from '@std/assert'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { idKeywords } from '@yaks/id'
import { ids } from '@yaks/id/rules'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { sessionDoc } from './comp.ts'
import { authenticate, VIA } from './routes.ts'

let spine: VocabDoc = {
  $defs: {
    entity: {
      component: true,
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
  },
}

let vocab = loadVocab([sessionDoc, spine], [idKeywords])

let host = () => {
  let s = ram(vocab, { number: true })
  let g = graph({ storage: s, vocab, plugins: [ids(vocab)] })
  g.apply([{ entity: { eid: 's1' }, session: { id: 'abc', actor: 'p1' } }], {
    trusted: true,
  })
  return { graph: g }
}

let asking = (said?: string) =>
  authenticate(host())(
    new Request('http://h/apply', {
      headers: said ? { [VIA]: said } : {},
    }),
  )

Deno.test('the run a request names is who its writes are by, and through', async () => {
  assertEquals(await asking('abc'), { by: 'p1', via: 's1' })
  // However the caller names it — the harness's name, the id a person says,
  // the eid — it is one run.
  assertEquals(await asking('S-1'), { by: 'p1', via: 's1' })
  assertEquals(await asking('s1'), { by: 'p1', via: 's1' })
})

Deno.test('a request naming nobody, or a run this graph never saw, is left to the host', async () => {
  assertEquals(await asking(), null)
  assertEquals(await asking('nothing-here'), null)
})
