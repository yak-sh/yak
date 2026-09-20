import { assertEquals } from '@std/assert'
import { composed, type Sections, snip, written } from './digest.ts'

let nothing: Sections = () => []

// A contributor that writes one section, and remembers the transcript it was
// asked about.
let part = (heading: string, lines: string[], weight?: number) => {
  let saw = ''
  let sections: Sections = (session) => {
    saw = session.entity.eid
    return [{ heading, lines }]
  }
  return { part: { sections, weight }, saw: () => saw }
}

let session = { entity: { eid: 's1' } }
let read = () => []

Deno.test('a digest is written in weight order, whatever order the parts came in', async () => {
  let goals = part('goals', ['- V-1'], 20)
  let mine = part('claimed', ['- T-7'], -10)
  let told = composed([goals.part, mine.part])
  assertEquals(
    (await told(session, read)).map((s) => s.heading),
    ['claimed', 'goals'],
  )
})

Deno.test('a part with no weight sits at zero, and ties keep their order', async () => {
  let told = composed([
    part('a', ['1']).part,
    part('b', ['2']).part,
    part('lead', ['0'], -1).part,
  ])
  assertEquals(
    (await told(session, read)).map((s) => s.heading),
    ['lead', 'a', 'b'],
  )
})

Deno.test('every part is asked about the same transcript', async () => {
  let first = part('owner said', ['- ship it'], -10)
  let later = part('recall', ['- M-1'], 10)
  await composed([later.part, first.part])(session, read)
  assertEquals([first.saw(), later.saw()], ['s1', 's1'])
})

Deno.test('a section with no lines is not written at all', async () => {
  let told = composed([
    part('previously', [], -10).part,
    part('goals', ['- V-1'], 20).part,
  ])
  assertEquals((await told(session, read)).map((s) => s.heading), ['goals'])
})

Deno.test('no parts at all is an empty digest, not a failure', async () => {
  assertEquals(await composed([])(session, read), [])
  assertEquals(await composed([{ sections: nothing }])(session, read), [])
})

Deno.test('the prose is a blank line, the heading, the lines', () => {
  assertEquals(
    written([
      { heading: 'owner said', lines: ['- ship it'] },
      { heading: 'goals', lines: ['- V-1 noise'] },
    ]),
    ['', '## owner said', '- ship it', '', '## goals', '- V-1 noise'],
  )
})

Deno.test('a line is cut to a width, and a short one is left alone', () => {
  assertEquals(snip('short', 10), 'short')
  assertEquals(snip('0123456789abc', 10), '012345678…')
})
