// The letter a project is shown by when it also carries the board of its tasks,
// the address its mail comes to, and the role it acts in: the project it is,
// not any one of those.

import { assertEquals } from '@std/assert'
import { human } from '@yaks/id'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { team } from './testing.ts'

// @yaks/mail's `email` and @yaks/persona's `role`, as far as the display cares:
// each a kind with a letter of its own, alphabetically ahead of `project`.
let aspects: VocabDoc = {
  $defs: {
    email: { component: true, type: 'object', kind: true, prefix: 'A' },
    role: { component: true, type: 'object', kind: true, prefix: 'R' },
  },
} as VocabDoc

let p19 = {
  entity: { eid: 'p1', num: 19 },
  project: {},
  board: { query: '.filed.project=P-19' },
  email: {},
  role: {},
}

Deno.test('a project that carries a board is shown as the project', () => {
  let { email: _, role: __, ...row } = p19
  assertEquals(team.kindOf(row), 'project')
  assertEquals(human(team)(row), 'P-19')
})

Deno.test('so is one that also has an address and a role', () => {
  let vocab = loadVocab([...team.docs, aspects])
  assertEquals(vocab.kindOf(p19), 'project')
  assertEquals(human(vocab)(p19), 'P-19')
})
