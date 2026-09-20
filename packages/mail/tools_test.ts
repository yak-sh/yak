// The check: what it says about a clean post room, and about a letter nobody
// can answer.

import { assert, assertEquals } from '@std/assert'
import type { Bundle, Comp, Graph, ToolCtx } from '@yaks/graph'
import { clubhouse } from './harness.ts'
import { runs } from './tools.ts'

// One check run over a graph, as a host would call it: the answer's prose and
// the level it carries.
let checkup = async (g: Graph) => {
  let [said] = await runs().mail_check([], {
    graph: g,
    actor: null,
    read: (q) => g.read(q),
    args: {},
    call: 'c1',
  } as ToolCtx) as Bundle[]
  return {
    body: String((said.content as Comp).body),
    level: (said.error as Comp | undefined)?.code,
    source: (said.output as Comp).source,
  }
}

let posted = async (mail: Record<string, unknown>) => {
  let { g } = clubhouse()
  await g.apply([{ entity: { eid: 'e1' }, mail, doc: { title: 'hello' } }])
  return g
}

Deno.test('a letter that arrived with a sender is nothing to report', async () => {
  let said = await checkup(
    await posted({ from: 'ana@books.example', message_id: '<a@x>' }),
  )
  assertEquals(said.level, undefined)
  assert(said.body.endsWith('— nothing to report'), said.body)
  assertEquals(said.source, 'c1')
})

Deno.test('a letter that arrived with no sender is a fail', async () => {
  let said = await checkup(await posted({ message_id: '<a@x>' }))
  assertEquals(said.level, 'fail')
  assert(said.body.includes('arrived with no sender'), said.body)
})

Deno.test('a letter nobody received is not the check’s business', async () => {
  // No Message-ID: composed here, and ./send.ts is what refuses it a sender.
  let said = await checkup(await posted({ to: 'ana@books.example' }))
  assertEquals(said.level, undefined)
})
