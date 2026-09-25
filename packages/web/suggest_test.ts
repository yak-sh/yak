// suggest(): candidates as text → kind, so a case asserts membership without
// freezing the whole vocabulary into the test.
import { assertEquals } from '@std/assert'
import { suggest } from './suggest.ts'

let cand = (token: string, wells?: Record<string, string[]>) =>
  Object.fromEntries(suggest(token, wells).map((c) => [c.text, c.kind]))

let has: [string, string, string, string][] = [
  ['comp name', '.', '.task.', 'comp'],
  ['bare prop', '.', '.status', 'task'],
  ['doc prop', '.', '.title', 'doc'],
  ['spine is stamped', '.', '.num', 'entity · stamped'],
  ['recall bare + stamped', '.', '.count', 'recall · stamped'],
  ['reference', '.', '.assignee', 'filed · ref'],
  ['shared reference', '.', '.actor', 'ref'],
  ['prefix keeps the comp', '.mem', '.memory.', 'comp'],
  ['comp columns', '.memory.', '.memory.scope', 'memory'],
  [
    'stamped column, dimmed',
    '.memory.',
    '.memory.last_confirmed_at',
    'memory · stamped',
  ],
  ['recall columns', '.recall.', '.recall.count', 'recall · stamped'],
  ['explicit spelling for collisions', '.pin.', '.pin.x', 'pin'],
  ['ops after a prop', '.status', '.status=', 'equals'],
  ['presence op', '.status', '.status!', 'exists'],
  ['negation op', '.status', '.status!=', 'not'],
  ['contains op', '.title', '.title~=', 'contains'],
  ['facet absent', '.proposed', '.proposed=', 'absent'],
  ['facet present', '.proposed', '.proposed~=', 'present'],
  ['facet bang present', '.proposed', '.proposed!', 'present'],
  ['range skeleton', '.priority', '.priority=..', 'range'],
  ['half-typed op', '.status!', '.status!=', 'not'],
  ['enum values', '.status=', '.status=open', 'status'],
  ['enum by prefix', '.status=o', '.status=open', 'status'],
  ['enum after a comma', '.status=open,w', '.status=open,wip', 'status'],
  [
    'enum on the explicit spelling',
    '.task.status=',
    '.task.status=open',
    'status',
  ],
  ['path far side', '.assignee.', '.assignee.title', 'doc'],
  ['path far side, any comp', '.assignee.', '.assignee.status', 'task'],
  ['path value', '.assignee.status=', '.assignee.status=open', 'status'],
  // multi-hop chains complete the same way, at any depth (T-17123)
  [
    'chain far columns',
    '.comment.target.doc.',
    '.comment.target.doc.title',
    'doc',
  ],
  [
    'chain fresh far side',
    '.comment.target.',
    '.comment.target.assignee',
    'filed · ref',
  ],
  [
    'chain leaf value',
    '.comment.target.task.status=',
    '.comment.target.task.status=open',
    'status',
  ],
  ['time phrases on _at', '.updated.at=', '.updated.at=today', 'time'],
  ['rank value', '.orde', '.order=hot', 'rank'],
  ['rank value completes', '.order=h', '.order=hot', 'rank'],
  ['similar rank value', '.order=simi', '.order=similar', 'rank'],
  ['similar rank input', '.nea', '.near=', 'rank'],
]
for (let [name, token, text, kind] of has) {
  Deno.test(`complete: ${name}`, () => assertEquals(cand(token)[text], kind))
}

Deno.test('complete: prefixes filter', () => {
  let c = cand('.mem')
  assertEquals(c['.status'], undefined)
  assertEquals(c['.task.'], undefined)
})

Deno.test('complete: ambiguous columns only via the explicit spelling', () => {
  assertEquals(cand('.')['.x'], undefined) // pin/camera collide
  assertEquals(cand('.pin.')['.pin.x'], 'pin')
})

Deno.test("complete: wells are the caller's lists", () => {
  assertEquals(
    cand('.domain=', { domains: ['Eng', 'Ops'] })['.domain=Eng'],
    'domains',
  )
  assertEquals(suggest('.domain='), []) // pure: no lists passed, none invented
})

Deno.test("complete: {eid} params offer the caller's entities by kind", () => {
  let ents = [
    { id: 'P-19', kind: 'project' },
    { id: 'P-30', kind: 'project' },
    { id: 'T-3', kind: 'task' },
    { id: 'U-7', kind: 'person' },
  ]
  // .project points at kind project — only projects; the task/person drop out
  let proj = Object.fromEntries(
    suggest('.project=', undefined, ents).map((c) => [c.text, c.kind]),
  )
  assertEquals(proj['.project=P-19'], 'project')
  assertEquals(proj['.project=P-30'], 'project')
  assertEquals(proj['.project=T-3'], undefined)
  // .assignee points at any entity — everything is offered
  let any = suggest('.assignee=', undefined, ents).map((c) => c.text)
  assertEquals(any.includes('.assignee=T-3'), true)
  assertEquals(any.includes('.assignee=U-7'), true)
  // prefix-filtered like every value, and pure without the list
  assertEquals(
    suggest('.project=P-3', undefined, ents).map((c) => c.text),
    ['.project=P-30'],
  )
  assertEquals(suggest('.project='), [])
})

Deno.test('complete: unknowns and non-tokens teach nothing', () => {
  assertEquals(suggest('.hovercraft.'), [])
  assertEquals(suggest('.hovercraft=x'), [])
  assertEquals(suggest('sandwich'), [])
  assertEquals(suggest('.status=open'), []) // the typed value is the value
})
