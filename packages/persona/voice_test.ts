// The document a persona renders as: what leads it, what rides whole, what is
// only named, and what never reaches it.

import { assert, assertEquals } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { said } from './testing.ts'
import { voice, type Worn } from './voice.ts'

let says = (eid: string, num: number | null, title: string, body: string) =>
  ({
    entity: { eid, num },
    doc: { title, body },
    memory: {},
  }) as Bundle

let who = (over: Partial<Worn> = {}): Worn => ({
  persona: {
    entity: { eid: 'n1', num: 1 },
    doc: { title: 'TaskMaster', body: 'the voice itself' },
    persona: {},
  },
  carries: [],
  names: [],
  ...over,
})

let told = (over: Partial<Worn> = {}) => voice(said)(who(over))

Deno.test('the persona leads: its own doc is the voice', () => {
  assertEquals(told(), '# N-1 TaskMaster\n\nthe voice itself\n')
})

Deno.test('what it carries rides whole, a rule between each', () => {
  let out = told({ carries: [says('m1', 3, 'delegation', 'fork the work')] })
  assertEquals(
    out,
    '# N-1 TaskMaster\n\nthe voice itself\n\n---\n\n' +
      '# M-3 delegation\n\nfork the work\n',
  )
})

Deno.test('a carried body keeps its own headings — the frame is H1 and a rule', () => {
  let out = told({ carries: [says('m1', 3, 'style', '## Rules\n\n- one')] })
  assert(out.includes('# M-3 style\n\n## Rules\n\n- one'))
})

Deno.test('what it only names is one line under its heading', () => {
  let out = told({ names: [says('m9', 9, 'tickets carry signal', 'body')] })
  assert(out.includes('## Reads'))
  assert(out.includes('- M-9 tickets carry signal'))
  assert(!out.includes('body'), 'a named doc said its body')
})

Deno.test('a numberless entity still has an id to show', () => {
  let out = told({ names: [says('m1-2-3-4-5', null, 'unnumbered', '')] })
  assert(/- #\w+ unnumbered/.test(out), out)
})

Deno.test('a control byte in a title never reaches the document', () => {
  // Said as a code, never as the byte: a source file carrying one is binary to
  // git, and a binary file cannot be merged (bin/check-bytes.ts).
  let esc = String.fromCharCode(27)
  let out = told({ carries: [says('m1', 3, `be${esc}[31mred`, 'body')] })
  assert(out.includes('# M-3 be[31mred'), out)
  assert(!out.includes(esc), 'an escape reached the reader')
})

Deno.test('a doc with no title is its id, and one with no body is its heading', () => {
  let out = told({ carries: [says('m1', 3, '', '')] })
  assertEquals(out.split('---\n\n')[1], '# M-3\n')
})
