// The filter grammar: one parser for boards, CLI and MCP.
import { adopt, matchQuery, parseQuery, pred } from './query.ts'
import { assertEquals, assertThrows } from '@std/assert'

// A task-shaped entity to filter against.
let row = (
  task: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) => ({
  entity: { num: 7, created_at: '2026-07-01', modified_at: '2026-07-16' },
  doc: { title: 'Fix the flux capacitor', body: '' },
  task: {
    status: 'open',
    priority: 1,
    project_eid: 'p1',
    domain: 'Ops',
    ...task,
  },
  ...extra,
})

let hit = (q: string, task: Record<string, unknown> = {}) =>
  matchQuery(row(task), parseQuery(q))

let cases: [string, string, Record<string, unknown>, boolean][] = [
  ['equality', '.status=open', {}, true],
  ['equality miss', '.status=done', {}, false],
  ['and across params', '.status=open&.domain=Ops', {}, true],
  ['and fails on one', '.status=open&.domain=Eng', {}, false],
  ['any-of list', '.domain=Ops,Eng', {}, true],
  ['any-of miss', '.domain=Eng,Web', {}, false],
  ['negated list', '.domain!=Eng,Web', {}, true],
  ['negation', '.status!=done', {}, true],
  ['lte', '.priority<=1', {}, true],
  ['lte boundary out', '.priority<=1', { priority: 1.5 }, false],
  ['lt strict', '.priority<1', {}, false],
  ['gte', '.priority>=1', {}, true],
  ['range inclusive', '.priority=1..3', {}, true],
  ['range inclusive hi', '.priority=1..3', { priority: 3 }, true],
  ['range exclusive hi', '.priority=1...3', { priority: 3 }, false],
  ['range miss', '.priority=2..3', {}, false],
  ['date range', '.created_at=2026-06-01..2026-08-01', {}, true],
  ['contains', '.title~=flux', {}, true],
  ['contains is case-blind', '.title~=FLUX', {}, true],
  ['contains miss', '.title~=warp', {}, false],
  ['null means absent', '.domain=', { domain: null }, true],
  ['null miss', '.domain=', {}, false],
  ['not-null', '.domain!=', {}, true],
  ['spine num', '.num=7', {}, true],
  ['spine num list', '.num=1,7,9', {}, true],
  ['explicit comp', '.task.status=open', {}, true],
  ['empty query matches all', '', {}, true],
  [
    'numeric compare, not lexicographic',
    '.priority>=2',
    { priority: 10 },
    true,
  ],
]
for (let [name, q, task, want] of cases) {
  Deno.test(`query: ${name}`, () => assertEquals(hit(q, task), want))
}

Deno.test('query: comparisons never match an absent prop', () => {
  assertEquals(
    matchQuery({ task: { status: 'open' } }, parseQuery('.priority<=1')),
    false,
  )
})

Deno.test('query: bad tokens are loud', () => {
  assertThrows(() => parseQuery('.hovercraft=eels'), Error, 'unknown prop')
  assertThrows(() => parseQuery('.task.eels=9'), Error, 'no such prop')
  assertThrows(() => parseQuery('sandwich'), Error, 'not a filter')
})

Deno.test('query: adopt pins down scalar equalities only', () => {
  let preds = parseQuery(
    '.project_eid=p1&.priority=2&.domain=Ops,Eng&.status!=done&.num=1..9&.title~=x',
  )
  // lists, ranges, negations, contains and other comps pin nothing down
  assertEquals(adopt(preds, 'task'), { project_eid: 'p1', priority: 2 })
  assertEquals(adopt(preds, 'doc'), {})
  assertEquals(adopt(parseQuery(''), 'task'), {})
})

Deno.test('query: pred routes and normalizes ops', () => {
  assertEquals(pred('.status=open'), {
    comp: 'task',
    prop: 'status',
    op: '',
    value: 'open',
  })
  assertEquals(pred('.priority<=1')?.op, '<=')
  assertEquals(pred('.title~=x')?.op, '~')
  assertEquals(pred('not a param'), null)
})
