// The series a project is numbered in when it also carries the board of its
// tasks, the address its mail comes to, and the role it acts in: the project it
// is, not any one of those.

import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { seriesOf } from '@yaks/id'
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
  entity: { eid: 'p1' },
  project: {},
  board: { query: '.filed.project=P-19' },
  email: {},
  role: {},
}

let comps = (row: object) => Object.keys(row).filter((c) => c != 'entity')

test('a project that carries a board is numbered as the project', () => {
  let { email: _, role: __, ...row } = p19
  assertEquals(team.kindOf(row), 'project')
  assertEquals(seriesOf(team)(comps(row)), 'P')
})

test('so is one that also has an address and a role', () => {
  let vocab = loadVocab([...team.docs, aspects], [...team.keywords])
  assertEquals(vocab.kindOf(p19), 'project')
  assertEquals(seriesOf(vocab)(comps(p19)), 'P')
})
