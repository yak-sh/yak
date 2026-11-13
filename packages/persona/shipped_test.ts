// A persona a package ships as files, kept in a store: worn as the files say
// it, written only where the store holds something else, and a document the
// files dropped leaving it.

import { test } from '@yaks/testing'
import { assertEquals, assertThrows } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { kept, shipped } from './shipped.ts'
import { wear } from './worn.ts'
import { voice } from './voice.ts'
import { held, said, world } from './testing.ts'

let file = (meta: string, body: string) => `---\n${meta}\n---\n\n${body}\n`
let base = (contains: string[], body = 'Help.') =>
  file(
    `persona: {}\ndoc:\n  title: Helper\ncontains: [${contains.join(', ')}]`,
    body,
  )
let doc = (title: string, body: string) => file(`doc:\n  title: ${title}`, body)
let rows = (files: Record<string, string>) => shipped(files, (n) => 'h-' + n)

let FILES = {
  'base.md': base(['tone', 'tools']),
  'tone.md': doc('Tone', 'Be brief.'),
  'tools.md': doc('Tools', 'Read first.'),
}

// A store kept as `files` say, then what keeping `next` writes there.
let keep = async (files: Record<string, string>, next = files) => {
  let g = world()
  await g.apply(await kept(held(g), rows(files)))
  let writes = await kept(held(g), rows(next))
  await g.apply(writes)
  let worn = await wear(held(g), said)('h-base')
  return { writes, text: voice(said)(worn!) }
}

let eids = (bs: Bundle[]) => bs.map((b) => b.entity.eid)

test('a persona kept from its files is said as they say it, in their order', async () => {
  let { text } = await keep(FILES)
  assertEquals(
    text.split('\n').filter((l) => l.startsWith('# ')).map((l) =>
      l.replace(/^# \S+ /, '')
    ),
    ['Helper', 'Tone', 'Tools'],
  )
})

test('keeping it again writes nothing, and a changed file writes its row alone', async () => {
  assertEquals((await keep(FILES)).writes, [])
  let { writes, text } = await keep(FILES, {
    ...FILES,
    'tone.md': doc('Tone', 'Be warm.'),
  })
  assertEquals(eids(writes), ['h-tone'])
  assertEquals(text.includes('Be warm.'), true)
})

test('a document the files no longer hold leaves the persona', async () => {
  let { text } = await keep(FILES, {
    'base.md': base(['tone']),
    'tone.md': FILES['tone.md'],
  })
  assertEquals(text.includes('Read first.'), false)
})

test('files that do not make one persona are refused', () => {
  assertThrows(() => rows({ 'tone.md': FILES['tone.md'] }))
  assertThrows(() => rows({ ...FILES, 'loose.md': doc('Loose', 'x') }))
  assertThrows(() => rows({ 'base.md': base(['gone']) }))
  assertThrows(() =>
    rows({ 'base.md': file('entity: {eid: x}\npersona: {}', 'x') })
  )
})
