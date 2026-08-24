// The filter grammar: one parser for boards, CLI and MCP.
import {
  adopt,
  AGG,
  aggOf,
  bareRenamesOf,
  complete,
  distinctValues,
  EXISTS,
  fieldsOf,
  hot,
  kidsOf,
  kindPreds,
  listed,
  matchQuery,
  noFilter,
  orderOf,
  parseQuery,
  pred,
  preds,
  PROJECT,
  resolution,
  resolveRefs,
  reverseAssocs,
  route,
  scopes,
  SUNK,
  sunk,
  tally,
  warm as rank, // the test file's own `warm` fixture predates the export
} from './query.ts'
import { instant, span } from './time.ts'
import { stamped } from './types.ts'
import { assert, assertEquals, assertThrows } from '@std/assert'

// A task-shaped entity to filter against.
let row = (
  task: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) => ({
  entity: { num: 7 },
  created: { at: '2026-07-01' },
  updated: { at: '2026-07-16' },
  doc: { title: 'Fix the flux capacitor', body: '' },
  task: {
    status: 'open',
    priority: 1,
    project: 'p1',
    domain: 'Ops',
    ...task,
  },
  ...extra,
})

let hit = (q: string, task: Record<string, unknown> = {}) =>
  matchQuery(row(task), parseQuery(q))

Deno.test('quarantine needs an explicit facet before a row is listed', () => {
  let hidden = row({}, { quarantined: { at: '2026-08-10' } })
  assertEquals(listed(hidden, parseQuery('')), false)
  assertEquals(listed(hidden, parseQuery('.status=open')), false)
  assertEquals(listed(hidden, parseQuery('.quarantined!')), true)
  assertEquals(listed(hidden, parseQuery('.quarantined.at>=today')), true)
})

Deno.test('the shared error facet is a fleet-wide health predicate', () => {
  let failed = row({}, { error: { message: 'boom' } })
  assertEquals(matchQuery(failed, parseQuery('.error!')), true)
  assertEquals(matchQuery(row({}), parseQuery('.error!')), false)
})

// `.kind=` is the first SCOPE — a virtual prop resolving to the kindPreds
// Pred[] the seam splices into the AND-list. It reads like a column: dotted,
// composing, one grammar. The bespoke `kind` parameter is gone.
Deno.test('query: .kind= filters like a column and composes', () => {
  // A memory-shaped entity matches .kind=memory; the task row does not — the
  // absence clauses make it EXACT, not a bare `.memory!` presence.
  let mem = { entity: { num: 9 }, doc: { title: 'm', body: '' }, memory: {} }
  assertEquals(matchQuery(mem, parseQuery('.kind=memory')), true)
  assertEquals(hit('.kind=memory'), false) // a task is not a memory
  assertEquals(hit('.kind=task'), true)

  // The seam splices: a kind past the first in kindOrder yields SEVERAL preds
  // (the kind present + every earlier one absent), spread into the list.
  let spliced = preds('.kind=comment')!
  assertEquals(spliced.length > 1, true)
  assertEquals(spliced, kindPreds('comment'))
  // parseQuery flattens the splice into its AND-list, not a nested node.
  assertEquals(parseQuery('.kind=comment'), kindPreds('comment'))

  // Composition is free — it ANDs with any other pred.
  assertEquals(hit('.kind=task&.priority<=1'), true)
  assertEquals(hit('.kind=task&.priority>=3'), false)
  // The plural folds in, the leniency the bare-word listing already granted.
  assertEquals(parseQuery('.kind=tasks'), kindPreds('task'))
})

Deno.test('query: bare kind= is not a filter; .kind=typo is a named refusal', () => {
  // No leading dot: not a dot-param at all — a text term to the search line,
  // and the strict doors refuse it (noFilter teaches the dotted spelling).
  assertEquals(preds('kind=session'), null)
  assertEquals(pred('kind=session'), null)
  assert(noFilter('kind=session').includes('.kind=session'))
  // Dotted and valid: a real filter. Dotted and unknown: a named refusal, not
  // a silent empty result.
  assertEquals(preds('.kind=session')!.length > 0, true)
  assertThrows(() => preds('.kind=griffin'), Error, 'no such kind: griffin')
})

Deno.test('query: a real prop wins over a same-named scope', () => {
  // The seam resolves owned column/component props FIRST, so a scope can never
  // shadow `.status`. Register a colliding scope and prove `.status=open` still
  // routes to the task column rather than the scope's Pred[].
  scopes.status = () => [{ comp: 'x', prop: '', op: 'exists', value: '' }]
  try {
    assertEquals(pred('.status=open'), {
      comp: 'task',
      prop: 'status',
      op: '',
      value: 'open',
    })
    assertEquals(hit('.status=open'), true)
  } finally {
    delete scopes.status
  }
})

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
  // priority speaks P<n> at the filter — the form the tool itself prints
  ['priority P<n> equals', '.priority=P1', {}, true],
  ['priority P<n> lte', '.priority<=P1', {}, true],
  ['priority P<n> range', '.priority=P1..P3', {}, true],
  ['priority P<n> list', '.priority=P0,P1', {}, true],
  ['lt strict', '.priority<1', {}, false],
  ['gte', '.priority>=1', {}, true],
  ['range inclusive', '.priority=1..3', {}, true],
  ['range inclusive hi', '.priority=1..3', { priority: 3 }, true],
  ['range exclusive hi', '.priority=1...3', { priority: 3 }, false],
  ['range miss', '.priority=2..3', {}, false],
  ['date range', '.created.at=2026-06-01..2026-08-01', {}, true],
  ['contains', '.title~=flux', {}, true],
  ['contains is case-blind', '.title~=FLUX', {}, true],
  ['contains miss', '.title~=warp', {}, false],
  ['null means absent', '.domain=', { domain: null }, true],
  ['null miss', '.domain=', {}, false],
  ['not-null', '.domain!=', {}, true],
  ['present', '.domain!', {}, true],
  ['empty string is present', '.domain!', { domain: '' }, true],
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

Deno.test('query: trailing bang tests property presence', () => {
  let p = pred('.proposed.at!')!
  assertEquals(p, {
    comp: 'proposed',
    prop: 'at',
    op: 'exists',
    value: '',
  })
  assertEquals(matchQuery({}, [p]), false)
  assertEquals(matchQuery({ proposed: { at: null } }, [p]), false)
  assertEquals(matchQuery({ proposed: { at: '' } }, [p]), true)
  assertEquals(matchQuery({ proposed: { at: '2026-08-01' } }, [p]), true)
})

Deno.test('query: .decided.verdict routes through the one grammar', () => {
  let matches = (q: string, r: ReturnType<typeof row>) =>
    matchQuery(r, parseQuery(q))
  let no = row({}, { decided: { at: '2026-08-01', verdict: 'declined' } })
  let yes = row({}, { decided: { at: '2026-08-01', verdict: 'approved' } })
  let bare = row({}, { decided: { at: '2026-08-01' } })
  assertEquals(matches('.decided.verdict=declined', no), true)
  assertEquals(matches('.decided.verdict=declined', yes), false)
  // `=` empty screens the pre-verdict rows (absent reads as approved)
  assertEquals(matches('.decided.verdict=', bare), true)
  assertEquals(matches('.decided.verdict=declined', bare), false)
})

Deno.test('query: component names test facet absence and presence', () => {
  let fix = row({})
  let idea = row({}, { proposed: { at: '2026-08-01T00:00:00.000Z' } })
  let matches = (q: string, r: ReturnType<typeof row>) =>
    matchQuery(r, parseQuery(q))
  assertEquals(matches('.proposed=', fix), true)
  assertEquals(matches('.proposed=', idea), false)
  assertEquals(matches('.proposed~=', fix), false)
  assertEquals(matches('.proposed~=', idea), true)
  assertEquals(matches('.proposed!', fix), false)
  assertEquals(matches('.proposed!', idea), true)
  assertThrows(
    () => parseQuery('.proposed!=yes'),
    Error,
    'component filters are presence tests',
  )
})

Deno.test('query: a trailing bang names a facet before its namesake prop', () => {
  assertEquals(parseQuery('.persona!'), [{
    comp: 'persona',
    prop: '',
    op: 'exists',
    value: '',
  }])
  assertEquals(parseQuery('.session.persona!'), [{
    comp: 'session',
    prop: 'persona',
    op: 'exists',
    value: '',
  }])
})

Deno.test('query: bad tokens are loud, bare words are terms', () => {
  assertThrows(() => parseQuery('.hovercraft=eels'), Error, 'unknown prop')
  assertThrows(() => parseQuery('.task.eels=9'), Error, 'no such prop')
  assertEquals(parseQuery('sandwich')[0].op, 'text') // a term, not an error
})

// A page address is the ordinary value that carries the separator, and
// an unquoted one used to become a url pred plus a stray term matching
// nothing — an empty badge that looked like a truthful "nothing here".
Deno.test('query: quotes hold a value that carries the separator', () => {
  let preds = parseQuery('.web.url="https://x.test/p?a=1&b=2"&.status=open')
  assertEquals(preds.length, 2)
  assertEquals(preds[0].value, 'https://x.test/p?a=1&b=2')
  assertEquals([preds[1].comp, preds[1].prop, preds[1].value], [
    'task',
    'status',
    'open',
  ])
  // A url still canonicalizes inside its quotes, and unquoted still splits.
  assertEquals(
    parseQuery('.web.url="https://X.test/p/?utm_source=n#top"')[0].value,
    'https://x.test/p',
  )
  assertEquals(parseQuery('.web.url=https://x.test/p?a=1&b=2').length, 2)
  // An unbalanced quote is not a value form — it splits exactly as before.
  assertEquals(parseQuery('.title~="half&.status=open').length, 2)
})

Deno.test('query: adopt pins down scalar equalities only', () => {
  let preds = parseQuery(
    '.project=p1&.priority=2&.domain=Ops,Eng&.status!=done&.num=1..9&.title~=x',
  )
  // lists, ranges, negations, contains and other comps pin nothing down
  assertEquals(adopt(preds, 'task'), { project: 'p1', priority: 2 })
  assertEquals(adopt(preds, 'doc'), {})
  assertEquals(adopt(parseQuery(''), 'task'), {})
  // assignee rides the same generality: a board of Jeff's plate adopts
  assertEquals(
    adopt(parseQuery('.assignee=u1&.status=open'), 'task'),
    { assignee: 'u1', status: 'open' },
  )
})

Deno.test('query: assignee routes bare and filters', () => {
  let p = pred('.assignee=u1')!
  assertEquals([p.comp, p.prop, p.op], ['task', 'assignee', ''])
  assert(matchQuery(row({ status: 'open', assignee: 'u1' }), [p]))
  assert(!matchQuery(row({ status: 'open', assignee: 'u2' }), [p]))
  assert(!matchQuery(row({ status: 'open' }), [p]))
})

// ---- reverse hops ----

// A tiny graph: one parent task with two comments (one by jeff, one by sam), and
// a project with none — the rows that prove and disprove each quantifier.
let revGraph = () =>
  ({
    T1: {
      entity: { eid: 'T1', num: 1 },
      task: { eid: 'T1', status: 'open' },
      doc: { eid: 'T1', title: 'parent' },
    },
    P1: {
      entity: { eid: 'P1', num: 2 },
      project: { eid: 'P1' },
      doc: { eid: 'P1', title: 'proj' },
    },
    c1: {
      entity: { eid: 'c1', num: 3 },
      comment: { eid: 'c1', target: 'T1' },
      created: { eid: 'c1', by: 'jeff' },
    },
    c2: {
      entity: { eid: 'c2', num: 4 },
      comment: { eid: 'c2', target: 'T1' },
      created: { eid: 'c2', by: 'sam' },
    },
  }) as Record<string, Record<string, Record<string, unknown>>>

let revHit = (q: string, eid: string) => {
  let g = revGraph()
  let kids = kidsOf(new Map(Object.entries(g)))
  return matchQuery(g[eid], parseQuery(q), (e) => g[e], undefined, kids)
}

Deno.test('reverse hop: association names derive from the vocabulary', () => {
  // a sole-ref component takes the bare plural; a multi-ref one qualifies by prop
  assertEquals(reverseAssocs.get('comments'), {
    comp: 'comment',
    prop: 'target',
  })
  assertEquals(reverseAssocs.get('memories'), { comp: 'memory', prop: 'scope' })
  assertEquals(reverseAssocs.get('tasks'), undefined) // task has two ref cols
  assertEquals(reverseAssocs.get('tasks_project'), {
    comp: 'task',
    prop: 'project',
  })
  assertEquals(reverseAssocs.get('tasks_assignee'), {
    comp: 'task',
    prop: 'assignee',
  })
})

Deno.test('reverse hop: a hop parses to a rev pred, not a column', () => {
  let p = preds('.comments.created.by=jeff')![0]
  assertEquals(p.rev, {
    comp: 'comment',
    prop: 'target',
    not: false,
    preds: [{ comp: 'created', prop: 'by', op: '', value: 'jeff' }],
  })
  // a singular component name is still the forward path, untouched
  assert(!preds('.comment.target.doc.title~=x')![0].rev)
})

Deno.test('reverse hop: ANY is the default, NONE is the negation', () => {
  assert(revHit('.comments!', 'T1')) // has comments
  assert(!revHit('.comments!', 'P1'))
  assert(!revHit('.comments=', 'T1')) // none
  assert(revHit('.comments=', 'P1'))
  assert(revHit('.comments.created.by=jeff', 'T1')) // ANY by jeff
  assert(!revHit('.comments.created.by=jeff', 'P1'))
  assert(!revHit('.comments!.created.by=jeff', 'T1')) // NONE by jeff: c1 is
  assert(revHit('.comments!.created.by=jeff', 'P1')) // no comments at all
})

Deno.test('reverse hop: ALL falls out of De Morgan, count compares', () => {
  // every comment by jeff = NOT EXISTS one NOT by jeff. c2 is by sam, so false.
  assert(!revHit('.comments!.created.by!=jeff', 'T1'))
  // a project with no comments vacuously satisfies ALL
  assert(revHit('.comments!.created.by!=jeff', 'P1'))
  assert(revHit('.comments>=2', 'T1'))
  assert(!revHit('.comments>=3', 'T1'))
  assert(revHit('.comments=2', 'T1'))
  assert(revHit('.comments<1', 'P1'))
})

Deno.test('reverse hop: a bare association needs a sub-path or a count', () => {
  assertThrows(() => preds('.comments~=foo'), Error)
})

// ---- multi-column reverse-union (.refs) ----

// The backlinks of an entity: who points at it through ANY {eid} column. The
// revGraph reused — c1/c2 both aim comment.target at T1, and each carries a
// distinct created.by, so a target sits at the union of two different columns.
let refHit = (q: string, eid: string) =>
  matchQuery(revGraph()[eid], parseQuery(q))

Deno.test('.refs parses to a multi-column reverse-union pred', () => {
  assertEquals(preds('.refs=T-3'), [
    { comp: '', prop: '', op: '', value: 'T-3', refs: true },
  ])
  assertEquals(preds('.refs!'), [
    { comp: '', prop: '', op: EXISTS, value: '', refs: true },
  ])
  assertEquals(preds('.refs='), [
    { comp: '', prop: '', op: '', value: '', refs: true },
  ])
  // an operator that has no reverse-union meaning is refused, not guessed
  assertThrows(() => preds('.refs~=x'), Error)
  assertThrows(() => preds('.refs>=1'), Error)
})

Deno.test('.refs matches every referrer regardless of which column carries it', () => {
  assert(refHit('.refs=T1', 'c1')) // c1.comment.target = T1
  assert(refHit('.refs=T1', 'c2')) // c2.comment.target = T1
  assert(!refHit('.refs=T1', 'P1')) // P1 points at nothing
  assert(refHit('.refs=jeff', 'c1')) // c1.created.by = jeff, a DIFFERENT column
  assert(!refHit('.refs=jeff', 'c2')) // c2 is by sam
  // presence / absence: c1 references two things, T1 references nothing
  assert(refHit('.refs!', 'c1'))
  assert(!refHit('.refs!', 'T1'))
  assert(refHit('.refs=', 'T1'))
})

Deno.test('.refs resolves its value like any id at delivery', () => {
  let uuid = '22222222-2222-4222-8222-222222222222'
  let resolved = resolveRefs(
    parseQuery('.refs=T-3'),
    (id) => (id == 'T-3' ? uuid : undefined),
  )
  assertEquals(resolved[0].value, uuid)
  // an unresolvable id stays as typed — a saved query may name an absent entity
  assertEquals(
    resolveRefs(parseQuery('.refs=nope'), () => undefined)[0].value,
    'nope',
  )
})

// ---- aggregates (.distinct / .tally) ----

Deno.test('.distinct / .tally parse to an AGG projection over one column', () => {
  assertEquals(preds('.distinct=domain'), [
    { comp: 'task', prop: 'domain', op: AGG, value: '', agg: 'distinct' },
  ])
  assertEquals(preds('.tally=domain')![0].agg, 'tally')
  // the explicit component spelling routes the same column
  assertEquals(preds('.distinct=task.domain')![0], {
    comp: 'task',
    prop: 'domain',
    op: AGG,
    value: '',
    agg: 'distinct',
  })
  // a path or a bare component is refused — the census aggregates one column
  assertThrows(() => preds('.distinct=assignee.title'), Error)
  assertThrows(() => preds('.distinct=proposed'), Error)
  assertThrows(() => preds('.distinct='), Error)
})

Deno.test('an aggregate rides the pred list without filtering, read via aggOf', () => {
  let rows = [
    row({ domain: 'Ops' }),
    row({ domain: 'Eng' }),
    row({ domain: 'Ops' }),
    row({ domain: '' }),
  ]
  let ps = parseQuery('.distinct=domain')
  assert(rows.every((r) => matchQuery(r, ps))) // the directive filters nothing
  let agg = aggOf(ps)!
  assertEquals(agg, { op: 'distinct', at: { comp: 'task', prop: 'domain' } })
  // distinct is sorted with the empty dropped; tally counts each value
  assertEquals(distinctValues(rows, agg.at), ['Eng', 'Ops'])
  assertEquals(tally(rows, agg.at).get('Ops'), 2)
  assertEquals(tally(rows, agg.at).has(''), false)
})

// ---- projection (.fields) ----

Deno.test('.fields parses to a PROJECT projection with per-field wake', () => {
  assertEquals(preds('.fields=pin.x,pin.y,pin.z~'), [
    {
      comp: '',
      prop: '',
      op: PROJECT,
      value: '',
      fields: [
        { comp: 'pin', prop: 'x', wake: true },
        { comp: 'pin', prop: 'y', wake: true },
        { comp: 'pin', prop: 'z', wake: false }, // ~ marks it volatile
      ],
    },
  ])
  // a bare column routes by name when it is unique to one component (z → pin)
  assertEquals(preds('.fields=z')![0].fields, [
    { comp: 'pin', prop: 'z', wake: true },
  ])
  // a path or a bare component is refused — a projection reads one own column
  assertThrows(() => preds('.fields=assignee.title'), Error)
  assertThrows(() => preds('.fields=pin'), Error)
  assertThrows(() => preds('.fields='), Error)
})

Deno.test('a projection rides the pred list without filtering, read via fieldsOf', () => {
  let ps = parseQuery('.pin.canvas=C1&.fields=pin.x,pin.y,pin.z~')
  // only the .pin.canvas pred screens; the projection filters nothing
  let onC1 = { pin: { canvas: 'C1', x: 5, y: 6, z: 9 } }
  let onC2 = { pin: { canvas: 'C2', x: 1, y: 2, z: 3 } }
  assert(matchQuery(onC1, ps))
  assert(!matchQuery(onC2, ps))
  let fields = fieldsOf(ps)!
  assertEquals(fields, [
    { comp: 'pin', prop: 'x', wake: true },
    { comp: 'pin', prop: 'y', wake: true },
    { comp: 'pin', prop: 'z', wake: false },
  ])
  // the waking subset excludes the volatile z — a z-bump won't re-fire
  assertEquals(fields.filter((f) => f.wake).map((f) => f.prop), ['x', 'y'])
  // a query naming no projection has none
  assertEquals(fieldsOf(parseQuery('.status=open')), undefined)
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

Deno.test('query: typed atoms canonicalize or reject as one matrix', () => {
  let accepted = [
    ['.status=OPEN', 'open'],
    ['.verified=YES,no', '1,0'],
    ['.pin.x=+01.0', '1'],
    ['.priority=p02', '2'],
    ['.priority=P0,P1.5', '0,1.5'],
    ['.priority=P0..P2', '0..2'],
    ['.assignee.status=WIP', 'wip'],
    ['.assignee.priority=P02', '2'],
    ['.updated.at=today', 'today'],
    ['.title~=01', '01'],
    ['.verified=', ''],
  ]
  for (let [query, value] of accepted) {
    assertEquals(pred(query)?.value, value, query)
  }

  let rejected = [
    ['.status=gone', 'status is one of'],
    ['.verified=maybe', 'verified is a boolean'],
    ['.pin.x=plenty', 'pin.x is a finite decimal'],
    ['.priority=P', 'priority is a finite number'],
    ['.assignee.status=gone', 'status is one of'],
  ]
  for (let [query, message] of rejected) {
    assertThrows(() => parseQuery(query), Error, message, query)
  }
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
  // short units — what a hand types
  ['in 60m', NOW, NOW + 3_600_000],
  ['after 8h', NOW, NOW + 8 * 3_600_000],
  ['after 8 hours', NOW, NOW + 8 * 3_600_000],
  ['in 2d', NOW, NOW + 2 * 86_400_000],
  ['30 mins ago', NOW - 1_800_000, NOW],
  // clock times: an hour named alone spans its hour, a minute its minute
  ['9am', at(2026, 6, 15, 9), at(2026, 6, 15, 10)],
  ['8pm', at(2026, 6, 15, 20), at(2026, 6, 15, 21)],
  ['12am', at(2026, 6, 15, 0), at(2026, 6, 15, 1)],
  ['12pm', at(2026, 6, 15, 12), at(2026, 6, 15, 13)],
  ['9:30am', at(2026, 6, 15, 9, 30), at(2026, 6, 15, 9, 31)],
  ['14:00', at(2026, 6, 15, 14), at(2026, 6, 15, 14, 1)],
  ['noon', at(2026, 6, 15, 12), at(2026, 6, 15, 12, 1)],
  // …on today, unless a day word leads or trails
  ['9am tomorrow', at(2026, 6, 16, 9), at(2026, 6, 16, 10)],
  ['tomorrow 9am', at(2026, 6, 16, 9), at(2026, 6, 16, 10)],
  ['9am yesterday', at(2026, 6, 14, 9), at(2026, 6, 14, 10)],
  // an ISO stamp is that moment, its precision wide
  ['2026-07-25T09:00', at(2026, 6, 25, 9), at(2026, 6, 25, 9, 1)],
]
for (let [phrase, start, end] of spans) {
  Deno.test(`span: ${phrase}`, () =>
    assertEquals(span(phrase, NOW), { start, end }))
}
Deno.test('span: a zoned stamp keeps its own zone', () =>
  assertEquals(span('2026-07-25T09:00:00.000Z', NOW), {
    start: Date.parse('2026-07-25T09:00:00.000Z'),
    end: Date.parse('2026-07-25T09:00:00.000Z') + 1000,
  }))
Deno.test('span: not phrases', () => {
  for (let s of ['Ops', 'open', '1..3', 'a,b', '', 'todayish', '25:00']) {
    assertEquals(span(s, NOW), null)
  }
})

// One moment, for the callers that schedule rather than filter (a wake):
// the range's start, except the forward phrases that begin at now.
let moments: [string, number][] = [
  ['in 60m', NOW + 3_600_000],
  ['after 8 hours', NOW + 8 * 3_600_000],
  ['in 2 days', NOW + 2 * 86_400_000],
  ['9am', at(2026, 6, 15, 9)],
  ['8pm', at(2026, 6, 15, 20)],
  ['9am tomorrow', at(2026, 6, 16, 9)],
  ['tomorrow', at(2026, 6, 16)],
  ['2026-07-25T09:00', at(2026, 6, 25, 9)],
  ['5 minutes ago', NOW - 300_000], // a past ask is past, not rolled
  ['now', NOW],
]
for (let [phrase, moment] of moments) {
  Deno.test(`instant: ${phrase}`, () =>
    assertEquals(instant(phrase, NOW), moment))
}
Deno.test('instant: an ISO stamp resolves to itself', () => {
  let iso = new Date(at(2026, 6, 25, 9)).toISOString()
  assertEquals(instant(iso, NOW), at(2026, 6, 25, 9))
})
Deno.test('instant: nonsense is null, never a guess', () =>
  assertEquals(instant('whenever', NOW), null))

// Time preds: the row value is ISO, the filter value a phrase; the op
// picks the edge of the range the phrase names.
let when = (updatedAt: string) => ({
  entity: { num: 7 },
  created: { at: '2026-07-01T00:00:00Z' },
  updated: { at: updatedAt },
  task: { status: 'open' },
})
// matchQuery evaluates phrases on the REAL clock, so the fixtures do too.
let d = new Date()
let mid = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12)
  .toISOString() // noon today, local
let old = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 5, 12)
  .toISOString()
Deno.test('time: = is within the range', () => {
  assertEquals(matchQuery(when(mid), parseQuery('.updated.at=today')), true)
  assertEquals(matchQuery(when(old), parseQuery('.updated.at=today')), false)
  assertEquals(matchQuery(when(old), parseQuery('.updated.at!=today')), true)
})
Deno.test('time: >= takes the start, <= the end', () => {
  assertEquals(matchQuery(when(mid), parseQuery('.updated.at>=today')), true)
  assertEquals(matchQuery(when(old), parseQuery('.updated.at>=today')), false)
  assertEquals(matchQuery(when(old), parseQuery('.updated.at<=today')), true)
  assertEquals(matchQuery(when(mid), parseQuery('.updated.at<today')), false)
  assertEquals(matchQuery(when(old), parseQuery('.updated.at<today')), true)
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
    parseQuery('.updated.at>="1 hour ago"')[0].value,
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

Deno.test('hot: no recalls yet — the last touch counts as a single touch', () => {
  assert(hot({ created: { at: ago(H) } }, T0) > 0.9)
  assert(hot({ created: { at: ago(10 * D) } }, T0) < 0.01)
  assertEquals(hot({}, T0), 0)
})

Deno.test('noFilter teaches the door a stray predicate belongs to', () => {
  // A bare `kind=K` is the warm mistake — the door names the dotted spelling
  // that now works instead of a separate parameter to reach for.
  let m = noFilter('kind=session')
  assert(m.startsWith('not a filter: kind=session'))
  assert(m.includes('.kind=session')) // write it dotted — the filter form
  assert(m.includes('.status=open')) // the dot-param shape, sketched
  assert(!m.includes('\n')) // one line — it rides tool errors verbatim
  assert(!noFilter('sessions').includes('dotted')) // kind= only
  assert(noFilter('sessions').includes('dot-params'))
  // `.kind=` is a SCOPE now — it parses to kindPreds, never reaching route(),
  // so the dotted spelling is a real filter rather than a rejection.
  assertEquals(parseQuery('.kind=session').length > 0, true)
  // eid stays a near-miss the door names; route('kind') no longer special-cases
  // (the scope intercepts before route), so a direct route() is a plain miss.
  assertThrows(() => route('eid'), Error, '(T-3, E-9)')
  assertEquals(route('id'), { comp: 'session', prop: 'id' }) // no near-miss
  assertThrows(
    () => parseQuery('.hovercraft=eels'),
    Error,
    'unknown prop: .hovercraft — filters are dot-params',
  )
})

// The renames table's filter door: a bare prop whose COLUMN NAME changed
// derives an old→new entry, so a stored board.query keeps answering. Only a
// column-name change qualifies — a whole-component rename keeps its columns.
Deno.test('bareRenamesOf: only a changed column name earns a bare redirect', () => {
  assertEquals(bareRenamesOf({ 'task.persona_eid': 'spawn.persona' }), {
    persona_eid: 'persona',
  })
  // A move that keeps the column name (session→spawn) needs no bare redirect —
  // the column still routes through the new component in `routes`.
  assertEquals(bareRenamesOf({ 'session.provider': 'spawn.provider' }), {})
  // A whole-component rename keeps its columns, so nothing bare to redirect.
  assertEquals(bareRenamesOf({ old: 'new' }), {})
  assertEquals(bareRenamesOf({}), {})
})

// A dependency is an edge in EITHER grammar, so the miss teaches the edge
// door instead of the sketch — every door through route() inherits it.
Deno.test('an edge-ish prop names the edge door, not the sketch', () => {
  for (let prop of ['blocked-by', 'depends_on', 'parent', 'subtasks']) {
    assertThrows(
      () => route(prop),
      Error,
      "link one with 'task <parent> requires <child>'",
    )
  }
  assertThrows(
    () => parseQuery('.blocked-by=T-1'),
    Error,
    'an EDGE, not a prop',
  )
  // and nothing else changes: the sketch still answers a plain miss
  assertThrows(() => route('hovercraft'), Error, 'filters are dot-params')
})

// The edge net is a substring match, so `blocked` (a real component) COLLIDES
// with `block` — the facet must win, or `.blocked` teaches the edge door
// instead of filtering what is stuck. Guarded at route(): a registered
// component is never edge vocabulary, while `.blocked-by` (not a component)
// still hits the door above.
Deno.test('a component whose name contains an edge substring routes to presence', () => {
  assertEquals(route('blocked'), { comp: 'blocked', prop: '' })
  let stuck = row({}, { blocked: { on: 'waiting on the vendor' } })
  assertEquals(matchQuery(stuck, parseQuery('.blocked!')), true)
  assertEquals(matchQuery(stuck, parseQuery('.blocked~=')), true)
  assertEquals(matchQuery(stuck, parseQuery('.blocked=')), false)
  assertEquals(matchQuery(row({}), parseQuery('.blocked!')), false)
  assertEquals(matchQuery(row({}), parseQuery('.blocked=')), true)
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

Deno.test('every server-stamped column routes through its component', () => {
  for (let [comp, props] of Object.entries(stamped)) {
    for (let prop of Object.keys(props)) {
      let p = pred(`.${comp}.${prop}!`)
      assert(p)
      assertEquals(p.comp, comp)
      assertEquals(p.prop, prop)
    }
  }
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

// The venture facet's columns were renamed off the bare slots four other
// comps already own, so venture reads qualified while the incumbents keep
// their bare names — no new ambiguity throw.
Deno.test('venture columns route qualified; incumbents keep bare', () => {
  assertEquals(route('phase'), { comp: 'venture', prop: 'phase' })
  assertEquals(pred('.venture.phase=live'), {
    comp: 'venture',
    prop: 'phase',
    op: '',
    value: 'live',
  })
  assertEquals(route('run_mode'), { comp: 'venture', prop: 'run_mode' })
  // the incumbents venture deliberately dodged are unchanged: three still
  // route bare, `.url` stays exactly as ambiguous as it already was (repo,
  // web) — `site` added no third owner.
  assertEquals(route('state'), { comp: 'role', prop: 'state' })
  assertEquals(route('mode'), { comp: 'subscription', prop: 'mode' })
  assertEquals(route('operator'), { comp: 'session', prop: 'operator' })
  assertThrows(() => route('url'), Error, '.url is ambiguous (repo, web)')
})

// ---- references + path predicates ----

Deno.test('references route and filter by their own names', () => {
  assertEquals(pred('.assignee=u1'), {
    comp: 'task',
    prop: 'assignee',
    op: '',
    value: 'u1',
  })
  assert(hit('.assignee=u1', { assignee: 'u1' }))
  assert(!hit('.assignee=u1', { assignee: 'u2' }))
})

Deno.test('reference misses stay loud', () => {
  assertThrows(() => route('hovercraft'), Error, 'unknown prop')
})

Deno.test('a reference name shared by several comps is any-of', () => {
  // actor lives on client AND session — one concept, so the bare
  // form filters across both comps; writes must name one (client.ts).
  assertEquals(route('actor'), { comp: '', prop: 'actor' })
  assertEquals(route('client'), { comp: '', prop: 'client' })
  assertEquals(route('target'), { comp: '', prop: 'target' })
  let ps = parseQuery('.actor=u1')
  assert(matchQuery({ client: { actor: 'u1' } }, ps))
  assert(matchQuery({ session: { id: 's', actor: 'u1' } }, ps))
  assert(matchQuery({ client: { actor: 'u2' }, session: { actor: 'u1' } }, ps))
  assert(!matchQuery({ session: { id: 's', actor: 'u2' } }, ps))
  assert(!matchQuery({ session: { id: 's' } }, ps))
  assertThrows(() => route('by'), Error, 'ambiguous')
  // adopt() pins only comp-named equalities — any-of pins nothing
  assertEquals(adopt(ps, 'client'), {})
})

Deno.test('session compatibility fields filter across both homes', () => {
  assertEquals(route('provider'), { comp: '', prop: 'provider' })
  let ps = parseQuery('.provider=fake')
  assert(matchQuery({ session: { provider: 'fake' } }, ps))
  assert(matchQuery({ spawn: { provider: 'fake' } }, ps))
  assert(!matchQuery({ session: { provider: 'claude' } }, ps))
  assertEquals(route('persona'), { comp: '', prop: 'persona' })
  assertEquals(route('cwd'), { comp: '', prop: 'cwd' })
  let cwd = parseQuery('.cwd=/tmp/tree')
  assert(matchQuery({ session: { cwd: '/tmp/tree' } }, cwd))
  assert(matchQuery({ worktree: { cwd: '/tmp/tree' } }, cwd))
  assertEquals(route('pid'), { comp: '', prop: 'pid' })
  let pid = parseQuery('.pid=42')
  assert(matchQuery({ session: { pid: 42 } }, pid))
  assert(matchQuery({ runtime: { pid: 42 } }, pid))
  let providerId = parseQuery('.runtime.provider_session_id=thread-1')
  assertEquals(providerId[0], {
    comp: 'runtime',
    prop: 'provider_session_id',
    op: '',
    value: 'thread-1',
  })
  assert(
    matchQuery({ runtime: { provider_session_id: 'thread-1' } }, providerId),
  )
  assert(
    !matchQuery({ runtime: { provider_session_id: 'thread-2' } }, providerId),
  )
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
    prop: 'assignee',
    op: '~',
    value: 'jeff',
    at: [{ comp: 'doc', prop: 'title' }],
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
  assert(matchQuery(row({ assignee: 'u1' }), ps, ent))
  assert(!matchQuery(row({ assignee: 'ghost' }), ps, ent))
  assert(!matchQuery(row({}), ps, ent)) // absent ref: '=' shapes miss
  assert(matchQuery(row({}), parseQuery('.assignee.title!=jeff'), ent))
})

// ---- multi-hop traversal (T-17123) ----

Deno.test('paths: an explicit comp.prop.comp.prop chain parses to one deref', () => {
  // The owner's headline example: `.comment.target.doc.title` — one `{eid}`
  // deref (comment.target) with an EXPLICIT leaf (doc.title), the same shape
  // `.assignee.title` reaches through the bare spelling.
  assertEquals(pred('.comment.target.doc.title~=foo'), {
    comp: 'comment',
    prop: 'target',
    op: '~',
    value: 'foo',
    at: [{ comp: 'doc', prop: 'title' }],
  })
})

Deno.test('paths: the owner example resolves through a target entity', () => {
  let world: Record<string, Record<string, Record<string, unknown>>> = {
    t1: { doc: { title: 'the foobar task' } },
  }
  let ent = (e: string) => world[e]
  let comment = (target: unknown) => ({
    comment: { target },
    doc: { title: 'nice work', body: '' },
  })
  let ps = parseQuery('.comment.target.doc.title~=foo')
  assert(matchQuery(comment('t1'), ps, ent))
  assert(!matchQuery(comment('t9'), ps, ent)) // target has no doc here
  assert(!matchQuery(comment(null), ps, ent)) // no target at all
  // A broken link reads as an absent value, so `!=` holds — the null-column
  // rule, folded over the chain.
  assert(
    matchQuery(
      comment(null),
      parseQuery('.comment.target.doc.title!=foo'),
      ent,
    ),
  )
})

Deno.test('paths: a chain derefs each reference in turn (two hops)', () => {
  // comment → target (a task) → task.project → doc.title: two `{eid}` derefs
  // then the leaf. `.project` names a component, so the explicit `.task.project`
  // spelling is how a chain derefs it — the escape hatch for any ref whose
  // name collides with a component's.
  let world: Record<string, Record<string, Record<string, unknown>>> = {
    task1: { doc: { title: 't' }, task: { status: 'open', project: 'proj1' } },
    proj1: { doc: { title: 'Task Graph' }, project: {} },
    proj2: { doc: { title: 'Other' }, project: {} },
  }
  let ent = (e: string) => world[e]
  let comment = (target: string) => ({ comment: { target } })
  let ps = parseQuery('.comment.target.task.project.doc.title~=graph')
  assertEquals(ps[0].at, [
    { comp: 'task', prop: 'project' },
    { comp: 'doc', prop: 'title' },
  ])
  assert(matchQuery(comment('task1'), ps, ent))
  world.task1.task!.project = 'proj2'
  assert(!matchQuery(comment('task1'), ps, ent))
})

// A path-LEAF component-presence — `.task.project.archived!` — tests whether
// the far entity WEARS the component, the counterpoint to the depth-0
// `.blocked!` presence test one hop out. `!`/`~=` hold when it is present, `=`
// when absent; a broken link reads as absent, same as any null column. (Before
// T-17677 the leaf read a nonexistent column and silently tested false.)
Deno.test('paths: a component-presence leaf tests the far entity (T-17677)', () => {
  let world: Record<string, Record<string, Record<string, unknown>>> = {
    open: { project: {} },
    shelved: { project: {}, archived: { at: '2026-08-01' } },
  }
  let ent = (e: string) => world[e]
  let task = (project: string) => ({ task: { project } })

  let present = parseQuery('.task.project.archived!')
  assertEquals(present[0].at, [{ comp: 'archived', prop: '' }])
  assert(matchQuery(task('shelved'), present, ent)) // project wears archived
  assert(!matchQuery(task('open'), present, ent)) // project lacks it
  assert(!matchQuery(task('gone'), present, ent)) // broken link reads absent

  let absent = parseQuery('.task.project.archived=')
  assert(!matchQuery(task('shelved'), absent, ent))
  assert(matchQuery(task('open'), absent, ent))
  assert(matchQuery(task('gone'), absent, ent)) // no target counts as absent
})

Deno.test('paths: a bare non-colliding ref chains too (assignee)', () => {
  // comment → target (task) → assignee (a user) → doc.title, where `assignee`
  // is a bare ref hop (no component wears its name), mixed with explicit hops.
  let world: Record<string, Record<string, Record<string, unknown>>> = {
    task1: { task: { assignee: 'u1' } },
    u1: { doc: { title: 'Jeff Peterson' } },
  }
  let ent = (e: string) => world[e]
  let ps = parseQuery('.comment.target.assignee.title~=jeff')
  assertEquals(ps[0].at, [
    { comp: 'task', prop: 'assignee' },
    { comp: 'doc', prop: 'title' },
  ])
  assert(matchQuery({ comment: { target: 'task1' } }, ps, ent))
  assert(!matchQuery({ comment: { target: 'u1' } }, ps, ent))
})

Deno.test('paths: a non-reference middle hop is refused', () => {
  // `.status` is not an `{eid}` column, so it cannot be dereferenced.
  assertThrows(
    () => pred('.comment.target.status.doc.title=x'),
    Error,
    'not a reference',
  )
})

Deno.test('paths: an edge word as a hop points at the edge-hop ticket', () => {
  assertThrows(
    () => pred('.dependency.child.task.status=open'),
    Error,
    'T-14078',
  )
  // A single-segment edge word keeps teaching the link door, not traversal.
  assertThrows(() => pred('.depends_on=T-9'), Error, 'link one')
})

Deno.test('provenance: .created.via filters by instrument', () => {
  let ps = parseQuery('.created.via=s1')
  assert(matchQuery({ created: { via: 's1' } }, ps))
  assert(!matchQuery({ created: { via: 's2' } }, ps))
  assert(!matchQuery({ created: {} }, ps))
})

Deno.test('resolveRefs: values resolve at match time, misses stay put', () => {
  let eids: Record<string, string> = {
    jeff: 'ABCDEFAB-1111-4111-8111-111111111111',
    'T-3': '22222222-2222-4222-8222-222222222222',
  }
  let r = (q: string) => resolveRefs(parseQuery(q), (id) => eids[id])
  let jeff = eids.jeff.toLowerCase()
  assertEquals(r('.assignee=jeff')[0].value, jeff)
  assertEquals(r('.assignee!=jeff')[0].value, jeff)
  assertEquals(r('.assignee=jeff,T-3')[0].value, `${jeff},${eids['T-3']}`)
  assertEquals(r(`.assignee=${eids.jeff}`)[0].value, jeff) // already an eid
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
  ['reference', '.', '.assignee', 'task · ref'],
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
    'task · ref',
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

Deno.test("complete: {eid} params offer the caller's entities by kind", () => {
  let ents = [
    { id: 'P-19', kind: 'project' },
    { id: 'P-30', kind: 'project' },
    { id: 'T-3', kind: 'task' },
    { id: 'U-7', kind: 'person' },
  ]
  // .project points at kind project — only projects; the task/person drop out
  let proj = Object.fromEntries(
    complete('.project=', undefined, ents).map((c) => [c.text, c.kind]),
  )
  assertEquals(proj['.project=P-19'], 'project')
  assertEquals(proj['.project=P-30'], 'project')
  assertEquals(proj['.project=T-3'], undefined)
  // .assignee points at any entity — everything is offered
  let any = complete('.assignee=', undefined, ents).map((c) => c.text)
  assertEquals(any.includes('.assignee=T-3'), true)
  assertEquals(any.includes('.assignee=U-7'), true)
  // prefix-filtered like every value, and pure without the list
  assertEquals(
    complete('.project=P-3', undefined, ents).map((c) => c.text),
    ['.project=P-30'],
  )
  assertEquals(complete('.project='), [])
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
    eid == P ? { project: {}, archived: { at: '2026-01-01' } } : undefined
  assertEquals(sunk({ project: {}, archived: { at: 'x' } }), true)
  assertEquals(sunk({ project: {} }), false)
  assertEquals(sunk({ archived: { at: 'x' } }), false)
  assertEquals(sunk({ task: { project: P } }, look), true)
  assertEquals(sunk({ task: { project: 'live' } }, look), false)
  assertEquals(sunk({ task: {} }, look), false)
})

Deno.test('warm: retirement damps the rank, never zeroes it', () => {
  let c = { created: { at: ago(H) }, project: {}, archived: { at: 'x' } }
  assert(rank(c, T0) > 0) // sunk, not erased
  assertEquals(rank(c, T0), hot(c, T0) * SUNK)
  // fresh-but-retired sinks beneath merely-idle live work
  assert(rank(c, T0) < hot({ created: { at: ago(2 * D) } }, T0))
})

Deno.test('.archived.at is filterable, and = means live', () => {
  let ps = parseQuery('.archived.at=')
  assertEquals(ps[0], {
    comp: 'archived',
    prop: 'at',
    op: '',
    value: '',
  })
  assert(matchQuery({ project: {} }, ps)) // a live project
  assert(!matchQuery({ project: {}, archived: { at: 'x' } }, ps))
})

// T-10611: a VALID pred naming another kind's column matches nothing and
// prints like a truthful "none". These are the two occurrences that were
// read as evidence of absence.
Deno.test('resolution: an empty answer names the routing it actually used', () => {
  let ps = (q: string) => parseQuery(q)
  // `.from` is real — on mail (stamped). `task list` returns tasks.
  assertEquals(resolution(ps('.from=jeff@yak.sh'), 'task'), 'mail.from')
  // `.to` routes to the shared deliver.to (D-14945) — a facet a wake wears,
  // so it is a legitimate filter, not a cross-kind mistake: silent.
  assertEquals(resolution(ps('.to=holdco'), 'wake'), '')
  // Silent where there is nothing to explain: the door's own kind, the doc
  // facet every kind wears, and provenance. Advisory means never noisy.
  assertEquals(resolution(ps('.status=open'), 'task'), '')
  assertEquals(resolution(ps('.title~=word'), 'task'), '')
  assertEquals(resolution(ps('.created.at=today'), 'task'), '')
  // A ranking is not a filter and never routes.
  assertEquals(resolution(ps('.order=hot'), 'task'), '')
})

// The `updated` row is stamped by a LATER write, so an entity made and never
// touched since carries `created` and no `updated` at all — 1,656 of the live
// graph's 10,767 entities. Every one was invisible to `.updated.at>=…`,
// including the boards whose whole job is showing recent activity: a task
// filed an hour ago and not revisited simply was not on them.
Deno.test('.updated.at reads created.at when nothing has updated it', () => {
  let born = {
    entity: { eid: 'e', num: 1 },
    doc: { title: 'never touched' },
    created: { at: '2026-08-03T00:00:00.000Z' },
  }
  let touched = {
    entity: { eid: 'f', num: 2 },
    doc: { title: 'edited since' },
    created: { at: '2020-01-01T00:00:00.000Z' },
    updated: { at: '2026-08-03T00:00:00.000Z' },
  }
  let hits = (line: string, c: Record<string, Record<string, unknown>>) =>
    matchQuery(c, parseQuery(line))

  // The fallback: born inside the window, never updated, still a match.
  assertEquals(hits('.updated.at>=2026-08-01', born), true)
  assertEquals(hits('.updated.at>=2026-08-01', touched), true)
  assertEquals(hits('.updated.at!', born), true)
  // And it does not invent recency: born long ago is still out.
  assertEquals(
    hits('.updated.at>=2026-08-01', { ...born, created: { at: '2019-01-01' } }),
    false,
  )
  // A real `updated` still wins over `created` in both directions.
  assertEquals(hits('.updated.at<=2021-01-01', touched), false)
  assertEquals(
    hits('.updated.at<=2021-01-01', { ...born, created: { at: '2020-06-01' } }),
    true,
  )
  // Absence still means absence when there is no created row either.
  assertEquals(hits('.updated.at=', { entity: { eid: 'g', num: 3 } }), true)
  assertEquals(hits('.updated.at=', born), false)
})

// `.decided.at` needed no grammar work: `at` is declared in comps, so route()
// and the time predicates carried it. The one edit was the routes union
// created/updated already have, which is what makes `.decided.via` filterable
// without its ever being writable.
Deno.test('.decided.at filters like any stamped time', () => {
  let settled = {
    entity: { eid: 'e', num: 1 },
    doc: { title: 'ship weekly' },
    created: { at: '2026-08-03T00:00:00.000Z' },
    decided: { at: '2026-05-04T00:00:00.000Z', by: 'jeff' },
  }
  let open = {
    entity: { eid: 'f', num: 2 },
    doc: { title: 'still arguing' },
    created: { at: '2026-08-03T00:00:00.000Z' },
  }
  let hits = (line: string, c: Record<string, Record<string, unknown>>) =>
    matchQuery(c, parseQuery(line))

  // The decision date, not the filing date — the whole point of the stamp.
  assertEquals(hits('.decided.at>=2026-05-01', settled), true)
  assertEquals(hits('.decided.at>=2026-06-01', settled), false)
  assertEquals(hits('.decided.at=2026-01-01..2026-06-01', settled), true)
  // Absent stamp: `=` empty finds it, everything else misses it.
  assertEquals(hits('.decided.at=', open), true)
  assertEquals(hits('.decided.at=', settled), false)
  assertEquals(hits('.decided.at>=2026-01-01', open), false)
  // The byline filters like created's, and bare `at` stays ambiguous.
  assertEquals(hits('.decided.by=jeff', settled), true)
  assertThrows(() => parseQuery('.at>=2026-01-01'), Error, 'ambiguous')
})
