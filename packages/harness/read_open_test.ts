// read_open opens one of the Reads a transcript's persona names, in full, by
// the id its text gives or its title, whether the persona reads it itself or
// through a base kept elsewhere, and nothing that is not one of its Reads.
import { equal, test } from '@yaks/testing'
import { assertRejects } from '@std/assert'
import { link } from '@yaks/edge'
import type { Bundle } from '@yaks/graph'
import { begin } from './agent.ts'
import { harness } from './testing.ts'
import { readOpen } from './worn.ts'

let h = await harness()
let bases = await harness()
let doc = (eid: string, title: string, body: string) => ({
  entity: { eid },
  doc: { title, body },
})
await bases.g.apply([
  { entity: { eid: 'platform' }, persona: {}, doc: { title: 'Platform' } },
  doc('calls', 'Calls', 'Speak slowly on a call.'),
  doc('secret', 'Secret', 'Not a Read.'),
  link('platform', 'reads', 'calls'),
])
await h.g.apply([
  {
    entity: { eid: 'space' },
    persona: { base: 'platform' },
    doc: { title: 'Space' },
  },
  doc('voices', 'Your voices', 'cedar, marin'),
  link('space', 'reads', 'voices'),
])
let session = await begin(h.g, 'hello', { persona: 'space', using: {} })
let tool = readOpen({ bases: bases.g.storage })
let open = async (read: string) => {
  let [said] = await tool.run!(
    {
      entity: { eid: 'c' },
      call: { args: { read } },
      $actor: { via: session },
    } as Bundle,
    h.g,
  ) as Bundle[]
  return String((said.content as { body: string }).body)
}

test("a Read opens in full by its title or its id, its own or its base's", async () => {
  equal((await open('Your voices')).endsWith('cedar, marin'), true)
  equal((await open('calls')).endsWith('Speak slowly on a call.'), true)
})

test('what is not one of the Reads is refused, naming the Reads', async () => {
  await assertRejects(() => open('secret'), Error, 'your Reads are')
})
