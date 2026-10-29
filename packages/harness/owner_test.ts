/// <reference lib="deno.ns" />
// Only the host's own process fallback may speak as the configured person.

import { assertEquals, assertRejects } from '@std/assert'
import { type Actor, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { sessionDoc } from '@yaks/session'
import { test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { conversationOwner } from './conversations.ts'

let vocab = loadVocab([sessionDoc, {
  $defs: { person: { component: true, properties: {} } },
}])
let g = graph({ storage: ram(vocab), vocab })
await g.apply([
  { entity: { eid: 'jeff' }, person: {} },
  { entity: { eid: 'opened' }, session: { fallback: true } },
  { entity: { eid: 'agent' }, session: {} },
], { trusted: true })
let host = { me: 'me', config: { person: 'jeff' } }
let owner = (actor: Actor) =>
  conversationOwner({ entity: { eid: 'c' }, $actor: actor }, g, host as never)

for (
  let actor of [{ by: 'me', via: 'me' }, { via: 'me' }, { via: 'opened' }]
) {
  test(`the host fallback ${JSON.stringify(actor)} speaks as its person`, async () => {
    assertEquals(await owner(actor), 'jeff')
  })
}

test('a transcript speaking for nobody has no owner', async () => {
  await assertRejects(() => owner({ via: 'agent' }))
})
