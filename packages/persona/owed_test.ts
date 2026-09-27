// What an agent in a checkout is owed of its persona, given the instruction
// files its provider reads there.

import { assertEquals } from '@std/assert'
import type { Bundle, Graph } from '@yaks/graph'
import { human } from '@yaks/id'
import { fleet } from './testing.ts'
import { personaFiles } from './files.ts'
import { voice } from './voice.ts'
import { wear } from './worn.ts'
import { owed } from './owed.ts'

let then = (g: Graph, ...batch: Bundle[]): Graph => (g.apply(batch), g)

// What the persona files write at the checkout a person keeps.
let agentsMd = async (g: Graph) => (await personaFiles(g)).files[0].text

let spoken = async (g: Graph, eid: string) =>
  voice(g.vocab)((await wear(g.storage, g.vocab)(eid))!)

let id = async (g: Graph, eid: string) =>
  human(g.vocab)((await g.get([eid]))[0])

Deno.test('an agent in any checkout of the repository is owed its common persona', async () => {
  let g = fleet('/r')
  let owes = await owed(g, '/r/agent', [])
  assertEquals(owes?.text, await spoken(g, 'n1'))
  assertEquals(owes?.source, await id(g, 'n1'))
})

Deno.test('a file that is the persona file is not said twice; any other file is', async () => {
  let g = fleet('/r')
  let file = await agentsMd(g)
  assertEquals(await owed(g, '/r/agent', ['# elsewhere\n', file]), undefined)
  assertEquals(await owed(g, '/r', [file]), undefined)
  // Another repository's instructions, or this persona's before the graph
  // moved, leave the persona owed as it stands now.
  assertEquals(
    (await owed(g, '/r', ['# elsewhere\n']))?.source,
    await id(g, 'n1'),
  )
  then(g, { entity: { eid: 'm1' }, doc: { body: 'first, revised' } })
  assertEquals((await owed(g, '/r', [file]))?.text, await spoken(g, 'n1'))
})

Deno.test('a checkout the graph does not know, or a project with no common persona, is owed nothing', async () => {
  assertEquals(await owed(fleet('/r'), '/elsewhere', []), undefined)
  let bare = then(fleet('/r'), {
    entity: { eid: 'n1' },
    persona: { home: null },
  })
  assertEquals(await owed(bare, '/r/agent', []), undefined)
})
