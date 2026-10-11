// The tools facet: what the run answers, and what it refuses.

import { test } from '@yaks/testing'
import { assert, assertEquals, assertRejects } from '@std/assert'
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { fleet, link, memory, voiced, world } from './testing.ts'
import { personaFiles } from './files.ts'
import { owed } from './owed.ts'
import { runs } from './tools.ts'

let asked = (g: Graph, args: Record<string, unknown>) =>
  runs().persona_read(
    { entity: { eid: 'c1' }, call: { args } },
    g,
  ) as Promise<Bundle[]>

let peopled = (): Graph => {
  let g = world()
  g.apply([
    voiced('n1', 'TaskMaster', 'the voice'),
    memory('m1', 'one', 'first'),
    link('n1', 'contains', 'm1'),
  ])
  return g
}

test('the answer is prose, and says which call it came from', async () => {
  let [said] = await asked(peopled(), { persona: 'n1' })
  let body = String((said.content as Comp).body)
  assert(body.startsWith('# N-1 TaskMaster\n\nthe voice'), body)
  assert(body.includes('# M-2 one'), body)
  assertEquals((said.output as Comp).source, 'c1')
})

test('a persona nobody named, and one that is not a persona, are refused', async () => {
  let g = peopled()
  await assertRejects(() => asked(g, {}), Error, 'needs a persona')
  await assertRejects(() => asked(g, { persona: 'm1' }), Error, 'no persona')
})

let marked = fleet('/r')
let entry =
  'Keep the weekly budget in view.\n\n## Before spending\n\nRead it again.'
let comment = 'Use the words exactly as written.'
marked.apply([
  { entity: { eid: 'entry' }, memory: {}, content: { body: entry } },
  {
    entity: { eid: 'titled' },
    memory: {},
    doc: { title: 'Budget', body: '' },
    content: { body: entry },
  },
  memory('comment', 'Verbatim', comment),
  link('n1', 'contains', 'entry'),
  link('n1', 'contains', 'titled'),
  link('n1', 'contains', 'comment'),
  link('n2', 'contains', 'n1'),
])

let verbatim = (text: string) => {
  assert(text.includes(entry), text)
  assert(text.includes(` Budget\n\n${entry}`), text)
  assert(text.includes(` Verbatim\n\n${comment}`), text)
  assertEquals(text.split(entry).length - 1, 2)
}

for (let persona of ['n1', 'n2']) {
  test(`contained marks reach persona ${persona} verbatim`, async () => {
    verbatim(
      String(((await asked(marked, { persona }))[0].content as Comp).body),
    )
  })
}

// File projections and admission snapshots use the same fixture, as the
// checkout tests do; assertions check what those interfaces give their callers.
let files = (await personaFiles(marked)).files
let instructions = (await owed(marked, '/r', []))!.text
test('contained marks reach persona files and session instructions verbatim', () => {
  verbatim(files[0].text)
  verbatim(instructions)
})
