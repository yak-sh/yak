// What an agent in a checkout is owed of its persona, given the instruction
// files its provider reads there.

import { test } from '@yaks/testing'
import { assert, assertEquals, assertRejects } from '@std/assert'
import type { Bundle, Graph } from '@yaks/graph'
import { human } from '@yaks/id'
import { fleet, nested } from './testing.ts'
import { personaFiles } from './files.ts'
import { voice } from './voice.ts'
import { wear } from './worn.ts'
import { owed, projection } from './owed.ts'

let then = (g: Graph, ...bundles: Bundle[]): Graph => (g.apply(bundles), g)

// What the persona files write at the checkout a person keeps.
let agentsMd = async (g: Graph) => (await personaFiles(g)).files[0].text

let spoken = async (g: Graph, eid: string) =>
  voice(g.vocab)((await wear(g.storage, g.vocab)(eid))!)

let id = async (g: Graph, eid: string) =>
  human(g.vocab)((await g.get([eid]))[0])

test('an agent anywhere in any checkout of the repository is owed its common persona', async () => {
  let g = fleet('/r')
  let owes = await owed(g, '/r/agent/src/', [])
  assertEquals(owes?.text, await spoken(g, 'n1'))
  assertEquals(owes?.source, await id(g, 'n1'))
})

let changing = fleet('/r')
let originalFile = await agentsMd(changing)
let originalSource = await id(changing, 'n1')
let revised = fleet('/r')
let parentOnly = nested('/r')
let parentFile = await agentsMd(parentOnly)
let parentVoice = await spoken(parentOnly, 'n1')

test('a file that is the persona file is not said twice; any other file is', async () => {
  let g = changing
  let file = originalFile
  assertEquals(await owed(g, '/r/agent', ['# elsewhere\n', file]), undefined)
  assertEquals(await owed(g, '/r', [file]), undefined)
})

test('another repository’s instruction file leaves this persona owed', async () => {
  assertEquals(
    (await owed(changing, '/r', ['# elsewhere\n']))?.source,
    originalSource,
  )
})

test('a persona file from before a graph edit leaves the revised persona owed', async () => {
  let g = revised
  then(g, { entity: { eid: 'm1' }, doc: { body: 'first, revised' } })
  assertEquals(
    (await owed(g, '/r', [originalFile]))?.text,
    await spoken(g, 'n1'),
  )
})

let unknownCheckout = fleet('/r')
let withoutCommon = then(fleet('/r'), {
  entity: { eid: 'n1' },
  persona: { home: null },
})
let chosen = fleet('/r')
let chosenWorn = (await wear(chosen.storage, chosen.vocab)('n2'))!
let chosenVoice = await spoken(chosen, 'n2')
let chosenProjection = projection(chosen.vocab)(chosenWorn)

test('a checkout the graph does not know, or a project with no common persona, is owed nothing', async () => {
  assertEquals(await owed(unknownCheckout, '/rx', []), undefined)
  assertEquals(await owed(withoutCommon, '/r/agent', []), undefined)
})

test('a chosen persona is omitted when its file says it', async () => {
  assertEquals(
    (await owed(chosen, '/elsewhere', [], { persona: 'n2' }))?.text,
    chosenVoice,
  )
  assertEquals(
    await owed(chosen, '/r', [chosenProjection], { persona: 'n2' }),
    undefined,
  )
  await assertRejects(
    () => owed(chosen, '/r', [], { persona: 'missing' }),
    Error,
    'no persona called missing',
  )
})

test("a sub-project's agent hears its own common persona and its parent's", async () => {
  let g = nested('/r')
  let owes = await owed(g, '/r/agent', [], { work: 't1' })
  assertEquals(owes?.source, await id(g, 'n3'))
  for (let said of ['for the sub', 'third', 'for everyone', 'first']) {
    assert(owes?.text.includes(said), said)
  }
  // Where the file already says the parent's, only what the sub-project adds.
  let rest = (await owed(g, '/r', [await agentsMd(g)], { work: 't1' }))?.text
  assert(rest?.includes('third') && !rest.includes('first'), rest)
})

test("a sub-project with no persona of its own hears its parent's", async () => {
  let g = parentOnly
  assertEquals(
    (await owed(g, '/r/agent', [], { work: 't2' }))?.text,
    parentVoice,
  )
})

test('a parent persona file also satisfies a sub-project with no persona', async () => {
  assertEquals(
    await owed(parentOnly, '/r', [parentFile], { work: 't2' }),
    undefined,
  )
})
