// The filter grammar: one parser for boards, CLI and MCP.
import {
  adopt,
  complete,
  hot,
  matchQuery,
  noFilter,
  orderOf,
  parseQuery,
  pred,
  resolveRefs,
  route,
  span,
  SUNK,
  sunk,
  warm as rank, // the test file's own `warm` fixture predates the export
} from './query.ts'
import { assert, assertEquals, assertThrows } from '@std/assert'

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

Deno.test('query: bad tokens are loud, bare words are terms', () => {
  assertThrows(() => parseQuery('.hovercraft=eels'), Error, 'unknown prop')
  assertThrows(() => parseQuery('.task.eels=9'), Error, 'no such prop')
  assertEquals(parseQuery('sandwich')[0].op, 'text') // a term, not an error
})

Deno.test('query: adopt pins down scalar equalities only', () => {
  let preds = parseQuery(
    '.project_eid=p1&.priority=2&.domain=Ops,Eng&.status!=done&.num=1..9&.title~=x',
  )
  // lists, ranges, negations, contains and other comps pin nothing down
  assertEquals(adopt(preds, 'task'), { project_eid: 'p1', priority: 2 })
  assertEquals(adopt(preds, 'doc'), {})
  assertEquals(adopt(parseQuery(''), 'task'), {})
  // assignee rides the same generality: a board of Jeff's plate adopts
  assertEquals(
    adopt(parseQuery('.assignee_eid=u1&.status=open'), 'task'),
    { assignee_eid: 'u1', status: 'open' },
  )
})

Deno.test('query: assignee_eid routes bare and filters', () => {
  let p = pred('.assignee_eid=u1')!
  assertEquals([p.comp, p.prop, p.op], ['task', 'assignee_eid', ''])
  assert(matchQuery(row({ status: 'open', assignee_eid: 'u1' }), [p]))
  assert(!matchQuery(row({ status: 'open', assignee_eid: 'u2' }), [p]))
  assert(!matchQuery(row({ status: 'open' }), [p]))
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

// ---- time phrases ----

// A fixed clock: Wed 2026-07-15 14:30 local. Spans come back in epoch ms.
let NOW = new Date(2026, 6, 15, 14, 30).getTime()
let at = (...a: number[]) =>
  new Date(a[0], a[1], a[2], a[3] ?? 0, a[4] ?? 0).getTime()

let spans: [string, number, number][] = [
  ['today', at(2026, 6, 15), at(2026, 6, 16)],
  ['yesterday', at(2026, 6, 14), at(2026, 6, 15)],
  ['tomorrow', at(2026, 6, 16), at(2026, 6, 17)],
  ['now', NOW, NOW],
  ['2026-07-04', at(2026, 6, 4), at(2026, 6, 5)],
  ['this week', at(2026, 6, 13), at(2026, 6, 20)], // Monday start
  ['last week', at(2026, 6, 6), at(2026, 6, 13)],
  ['this month', at(2026, 6, 1), at(2026, 7, 1)],
  ['next month', at(2026, 7, 1), at(2026, 8, 1)],
  ['this year', at(2026, 0, 1), at(2027, 0, 1)],
  ['this hour', at(2026, 6, 15, 14), at(2026, 6, 15, 15)],
  ['5 minutes ago', NOW - 300_000, NOW],
  ['1 hour ago', NOW - 3_600_000, NOW],
  ['2 days ago', NOW - 2 * 86_400_000, NOW],
  ['1 month ago', at(2026, 5, 15, 14, 30), NOW],
  ['in 2 hours', NOW, NOW + 7_200_000],
  ['1-hour-ago', NOW - 3_600_000, NOW], // glue for quoteless boxes
  ['1_hour_ago', NOW - 3_600_000, NOW],
]
for (let [phrase, start, end] of spans) {
  Deno.test(`span: ${phrase}`, () =>
    assertEquals(span(phrase, NOW), { start, end }))
}
Deno.test('span: not phrases', () => {
  for (let s of ['Ops', 'open', '1..3', 'a,b', '', 'todayish']) {
    assertEquals(span(s, NOW), null)
  }
})

// Time preds: the row value is ISO, the filter value a phrase; the op
// picks the edge of the range the phrase names.
let when = (modified_at: string) => ({
  entity: { num: 7, created_at: '2026-07-01T00:00:00Z', modified_at },
  task: { status: 'open' },
})
// matchQuery evaluates phrases on the REAL clock, so the fixtures do too.
let d = new Date()
let mid = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12)
  .toISOString() // noon today, local
let old = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 5, 12)
  .toISOString()
Deno.test('time: = is within the range', () => {
  assertEquals(matchQuery(when(mid), parseQuery('.modified_at=today')), true)
  assertEquals(matchQuery(when(old), parseQuery('.modified_at=today')), false)
  assertEquals(matchQuery(when(old), parseQuery('.modified_at!=today')), true)
})
Deno.test('time: >= takes the start, <= the end', () => {
  assertEquals(matchQuery(when(mid), parseQuery('.modified_at>=today')), true)
  assertEquals(matchQuery(when(old), parseQuery('.modified_at>=today')), false)
  assertEquals(matchQuery(when(old), parseQuery('.modified_at<=today')), true)
  assertEquals(matchQuery(when(mid), parseQuery('.modified_at<today')), false)
  assertEquals(matchQuery(when(old), parseQuery('.modified_at<today')), true)
})
Deno.test('time: a string row named today stays a string', () => {
  let c = { task: { status: 'open', domain: 'today' } }
  assertEquals(matchQuery(c, parseQuery('.domain=today')), true)
})

// ---- text preds + the mixed line ----

Deno.test('text: bare words search the doc, either column', () => {
  assertEquals(hit('flux'), true)
  assertEquals(hit('FLUX'), true) // case-insensitive
  assertEquals(hit('warp'), false)
  assertEquals(hit('flux .status=open'), true)
  assertEquals(hit('flux .status=done'), false)
  assertEquals(hit('"the flux"'), true) // quotes glue a phrase
  assertEquals(hit('"flux the"'), false)
})
Deno.test('mixed line: & segments keep their spaces, space-dot splits', () => {
  assertEquals(hit('.title~=the flux'), true) // the old grammar survives
  assertEquals(parseQuery('a .status=done b').length, 3)
  assertEquals(
    parseQuery('.modified_at>="1 hour ago"')[0].value,
    '1 hour ago', // quotes shield the phrase from the whitespace split
  )
  assertEquals(parseQuery('.env')[0].op, 'text') // opless dot-word = a term
})

// ---- hot: the decay rank behind '.order=hot' ----

let T0 = Date.parse('2026-07-20T12:00:00Z')
let H = 3_600_000
let D = 24 * H
let ago = (ms: number) => new Date(T0 - ms).toISOString()
let warm = (count: number, firstAgo: number, lastAgo: number) =>
  hot({ recall: { count, first_at: ago(firstAgo), last_at: ago(lastAgo) } }, T0)

Deno.test('hot: hours top of mind, days recallable, months rings a bell', () => {
  assert(warm(1, 2 * H, 2 * H) > 0.9) // just touched
  assert(warm(1, 5 * D, 5 * D) < 0.05) // one touch, days ago: faded
  assert(warm(20, 200 * D, 7 * D) > 0.6) // a habit stays warm across weeks
})

Deno.test('hot: recalled often decays slower than recalled once', () => {
  assert(warm(10, 30 * D, 5 * D) > warm(1, 5 * D, 5 * D))
})

Deno.test('hot: spaced recalls outlast crammed ones at equal count', () => {
  assert(warm(10, 90 * D, 10 * D) > warm(10, 10 * D + H, 10 * D))
})

Deno.test('hot: no recalls yet — modified_at counts as a single touch', () => {
  assert(hot({ entity: { modified_at: ago(H) } }, T0) > 0.9)
  assert(hot({ entity: { modified_at: ago(10 * D) } }, T0) < 0.01)
  assertEquals(hot({}, T0), 0)
})

Deno.test('noFilter teaches the door a stray predicate belongs to', () => {
  let m = noFilter('kind=session')
  assert(m.startsWith('not a filter: kind=session'))
  assert(m.includes("graph_query's kind parameter"))
  assert(m.includes('.status=open')) // the dot-param shape, sketched
  assert(!m.includes('\n')) // one line — it rides tool errors verbatim
  assert(!noFilter('sessions').includes('graph_query')) // kind= only
  assert(noFilter('sessions').includes('dot-params'))
  // the dot forms reject at route() — one seam, every door inherits
  assertThrows(() => route('kind'), Error, "graph_query's kind parameter")
  assertThrows(() => route('eid'), Error, '(T-3, E-9)')
  assertEquals(route('id'), { comp: 'session', prop: 'id' }) // no near-miss
  assertThrows(
    () => parseQuery('.hovercraft=eels'),
    Error,
    'unknown prop: .hovercraft — filters are dot-params',
  )
})

Deno.test('.order=hot is a ranking, not a filter', () => {
  let ps = parseQuery('.order=hot&.status=open')
  assertEquals(orderOf(ps), 'hot')
  assertEquals(matchQuery(row({}), ps), true) // never screens
  assertEquals(adopt(ps, 'task'), { status: 'open' }) // never adopts
  assertEquals(orderOf(parseQuery('.status=open')), undefined)
})

Deno.test('server-stamped recall columns filter without being writable', () => {
  assertEquals(
    matchQuery({ recall: { count: 3 } }, parseQuery('.count>=2')),
    true,
  )
  assertEquals(
    matchQuery({ recall: { count: 1 } }, parseQuery('.count>=2')),
    false,
  )
})

Deno.test('mail arrival columns route bare and filter (the mail door)', () => {
  assertEquals(pred('.verified=0'), {
    comp: 'mail',
    prop: 'verified',
    op: '',
    value: '0',
  })
  assertEquals(route('message_id'), { comp: 'mail', prop: 'message_id' })
  let ps = parseQuery('.verified=0')
  assert(matchQuery({ mail: { to: 'x', verified: 0 } }, ps))
  assert(!matchQuery({ mail: { to: 'x', verified: 1 } }, ps))
})

// ---- reference sugar + path predicates ----

Deno.test('sugar: .assignee is .assignee_eid', () => {
  assertEquals(pred('.assignee=u1'), {
    comp: 'task',
    prop: 'assignee_eid',
    op: '',
    value: 'u1',
  })
  assert(hit('.assignee=u1', { assignee_eid: 'u1' }))
  assert(!hit('.assignee=u1', { assignee_eid: 'u2' }))
})

Deno.test('sugar: misses and own-column collisions stay loud', () => {
  assertThrows(() => route('hovercraft'), Error, 'unknown prop')
  assertThrows(() => route('target_eid'), Error, 'ambiguous')
})

Deno.test('sugar: a ref name several comps share is any-of', () => {
  // actor_eid lives on client AND session — one concept, so the bare
  // form filters across both comps; writes must name one (client.ts).
  assertEquals(route('actor'), { comp: '', prop: 'actor_eid' })
  assertEquals(route('client'), { comp: '', prop: 'client_eid' })
  let ps = parseQuery('.actor=u1')
  assert(matchQuery({ client: { actor_eid: 'u1' } }, ps))
  assert(matchQuery({ session: { id: 's', actor_eid: 'u1' } }, ps))
  assert(!matchQuery({ session: { id: 's', actor_eid: 'u2' } }, ps))
  assert(!matchQuery({ session: { id: 's' } }, ps))
  // adopt() pins only comp-named equalities — any-of pins nothing
  assertEquals(adopt(ps, 'client'), {})
})

Deno.test('paths: a component first segment stays the explicit spelling', () => {
  assertEquals(pred('.pin.x=12'), {
    comp: 'pin',
    prop: 'x',
    op: '',
    value: '12',
  })
})

Deno.test('paths: .assignee.title walks the reference', () => {
  assertEquals(pred('.assignee.title~=jeff'), {
    comp: 'task',
    prop: 'assignee_eid',
    op: '~',
    value: 'jeff',
    at: { comp: 'doc', prop: 'title' },
  })
  assertThrows(() => pred('.status.title=x'), Error, 'not a reference')
  assertThrows(() => pred('.assignee.eels=x'), Error, 'unknown prop')
})

Deno.test('paths: the pred tests the TARGET through ent', () => {
  let world: Record<string, Record<string, Record<string, unknown>>> = {
    u1: { doc: { title: 'Jeff Peterson' } },
  }
  let ent = (e: string) => world[e]
  let ps = parseQuery('.assignee.title~=jeff')
  assert(matchQuery(row({ assignee_eid: 'u1' }), ps, ent))
  assert(!matchQuery(row({ assignee_eid: 'ghost' }), ps, ent))
  assert(!matchQuery(row({}), ps, ent)) // absent ref: '=' shapes miss
  assert(matchQuery(row({}), parseQuery('.assignee.title!=jeff'), ent))
})

Deno.test('paths: .author.actor walks comment → instrument → actor', () => {
  let world: Record<string, Record<string, Record<string, unknown>>> = {
    c1: { client: { actor_eid: 'jeff' } },
    s1: { session: { id: 'x', actor_eid: 'jeff' } },
    s2: { session: { id: 'y' } },
  }
  let ent = (e: string) => world[e]
  let ps = parseQuery('.author.actor=jeff')
  assert(matchQuery({ comment: { author_eid: 'c1' } }, ps, ent))
  assert(matchQuery({ comment: { author_eid: 's1' } }, ps, ent))
  assert(!matchQuery({ comment: { author_eid: 's2' } }, ps, ent))
  assert(!matchQuery({ comment: {} }, ps, ent))
})

Deno.test('resolveRefs: values resolve at match time, misses stay put', () => {
  let eids: Record<string, string> = {
    jeff: '11111111-1111-4111-8111-111111111111',
    'T-3': '22222222-2222-4222-8222-222222222222',
  }
  let r = (q: string) => resolveRefs(parseQuery(q), (id) => eids[id])
  assertEquals(r('.assignee=jeff')[0].value, eids.jeff)
  assertEquals(r('.assignee!=jeff')[0].value, eids.jeff)
  assertEquals(r('.assignee=jeff,T-3')[0].value, `${eids.jeff},${eids['T-3']}`)
  assertEquals(r(`.assignee=${eids.jeff}`)[0].value, eids.jeff) // already an eid
  assertEquals(r('.assignee=ghost')[0].value, 'ghost') // a miss matches nothing
  assertEquals(r('.assignee=')[0].value, '') // absence test, untouched
  assertEquals(r('.title~=jeff')[0].value, 'jeff') // not a reference
})

// ---- completion ----

// candidates as text → kind, so a case asserts membership without
// freezing the whole vocabulary into the test
let cand = (token: string, wells?: Record<string, string[]>) =>
  Object.fromEntries(complete(token, wells).map((c) => [c.text, c.kind]))

let has: [string, string, string, string][] = [
  ['comp name', '.', '.task.', 'comp'],
  ['bare prop', '.', '.status', 'task'],
  ['doc prop', '.', '.title', 'doc'],
  ['spine is stamped', '.', '.num', 'entity · stamped'],
  ['recall bare + stamped', '.', '.count', 'recall · stamped'],
  ['ref sugar', '.', '.assignee', 'task · ref'],
  ['shared ref sugar', '.', '.actor', 'ref'],
  ['prefix keeps the comp', '.mem', '.memory.', 'comp'],
  ['comp columns', '.memory.', '.memory.type', 'memory'],
  [
    'stamped column, dimmed',
    '.memory.',
    '.memory.last_confirmed_at',
    'memory · stamped',
  ],
  ['recall columns', '.recall.', '.recall.count', 'recall · stamped'],
  ['explicit spelling for collisions', '.pin.', '.pin.x', 'pin'],
  ['ops after a prop', '.status', '.status=', 'equals'],
  ['negation op', '.status', '.status!=', 'not'],
  ['contains op', '.title', '.title~=', 'contains'],
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
  ['time phrases on _at', '.modified_at=', '.modified_at=today', 'time'],
  ['rank value', '.orde', '.order=hot', 'rank'],
  ['rank value completes', '.order=h', '.order=hot', 'rank'],
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
  assertEquals(complete('.domain='), []) // pure: no lists passed, none invented
})

Deno.test('complete: unknowns and non-tokens teach nothing', () => {
  assertEquals(complete('.hovercraft.'), [])
  assertEquals(complete('.hovercraft=x'), [])
  assertEquals(complete('sandwich'), [])
  assertEquals(complete('.status=open'), []) // the typed value is the value
})

// ---- the filter bar's seam ----

// An ephemeral bar ANDs by concatenation: matchQuery is every(), so the
// merged pred list IS the intersection — nothing new to evaluate.
Deno.test('filter bar: extra preds AND into a saved query', () => {
  let both = [...parseQuery('.status=open'), ...parseQuery('.domain=Ops')]
  assert(matchQuery(row({}), both))
  assert(!matchQuery(row({ domain: 'Eng' }), both))
  assert(!matchQuery(row({ status: 'done' }), both))
  // a half-typed bar line throws like any query — the bar catches, inert
  assertThrows(() => parseQuery('.hovercraf=x'), Error, 'unknown prop')
})

// ---- retirement: the damper that sinks a dead venture ----

Deno.test('sunk: own stamp, or the project the task is filed under', () => {
  let P = 'p-eid'
  let look = (eid: string) =>
    eid == P ? { project: { retired_at: '2026-01-01' } } : undefined
  assertEquals(sunk({ project: { retired_at: 'x' } }), true)
  assertEquals(sunk({ project: {} }), false)
  assertEquals(sunk({ task: { project_eid: P } }, look), true)
  assertEquals(sunk({ task: { project_eid: 'live' } }, look), false)
  assertEquals(sunk({ task: {} }, look), false)
})

Deno.test('warm: retirement damps the rank, never zeroes it', () => {
  let c = { entity: { modified_at: ago(H) }, project: { retired_at: 'x' } }
  assert(rank(c, T0) > 0) // sunk, not erased
  assertEquals(rank(c, T0), hot(c, T0) * SUNK)
  // fresh-but-retired sinks beneath merely-idle live work
  assert(rank(c, T0) < hot({ entity: { modified_at: ago(2 * D) } }, T0))
})

Deno.test('.project.retired_at is the explicit spelling, and = means live', () => {
  let ps = parseQuery('.project.retired_at=')
  assertEquals(ps[0], {
    comp: 'project',
    prop: 'retired_at',
    op: '',
    value: '',
  })
  assert(matchQuery({ project: {} }, ps)) // a live project
  assert(!matchQuery({ project: { retired_at: 'x' } }, ps))
})
