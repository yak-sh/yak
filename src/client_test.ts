// The headless client's pure half: dot-param grammar, row assembly,
// change builders, and the injection digest. No server, no db.
import {
  belongs,
  byBoard,
  byList,
  checkRefs,
  claimant,
  claimChanges,
  commentChanges,
  commitChanges,
  contextDigest,
  contextSnapshot,
  derefParams,
  designChanges,
  edgesOf,
  facetsFor,
  fetched,
  find,
  goalChanges,
  hookClaim,
  inboxItem,
  isOperator,
  isUnread,
  jsonAuthored,
  jsonOf,
  lapseChanges,
  ledger,
  mailAt,
  mailChanges,
  mailLine,
  me,
  memoryChanges,
  mintedIn,
  normalizeLiterals,
  noticesFor,
  param,
  patchChanges,
  patches,
  readerAt,
  readerFor,
  recallIndex,
  replyChanges,
  repoAt,
  reSubject,
  rootFirst,
  type Row,
  rows,
  scopeFor,
  sessionFor,
  sessionMeta,
  showMd,
  spawnChanges,
  spawnDefaults,
  spawnPlan,
  spec,
  statusChanges,
  STUB,
  subChanges,
  TASK_TREE_ADOPTION,
  taskBlock,
  taskChanges,
  taskContextBlock,
  taskContextGraph,
  taskTreeExample,
  taskTreePlan,
  taskTreeText,
  taskTreeWarning,
  threadOf,
  unreadMail,
  workClaimMutation,
  wrapChanges,
} from './client.ts'
import { edgeEid, link, typeOf } from './edge.ts'
import { inflate } from './client_host.ts'
import { matchQuery, parseQuery, resolveRefs } from './query.ts'
import { local } from './time.ts'
import { type Change, type Dep, idOf, kindOf, type Snapshot } from './types.ts'
import {
  assertEquals,
  assertMatch,
  assertRejects,
  assertThrows,
} from '@std/assert'

// A tiny graph: one board-ordered pair of tasks, a session, a claim.
let S = 'aaaaaaaa-0000-4000-8000-000000000001'
let T1 = 'aaaaaaaa-0000-4000-8000-000000000002'
let T2 = 'aaaaaaaa-0000-4000-8000-000000000003'
let snap: Snapshot = {
  changes: [
    { eid: S, name: 'entity', comp: { eid: S, num: 1, created_at: '' } },
    { eid: S, name: 'session', comp: { id: 'sess-x', cwd: '/w' } },
    { eid: T1, name: 'entity', comp: { eid: T1, num: 2, created_at: '' } },
    { eid: T1, name: 'doc', comp: { title: 'First', body: '' } },
    { eid: T1, name: 'task', comp: { status: 'wip', priority: 0 } },
    { eid: T1, name: 'claim', comp: { session: S } },
    { eid: T2, name: 'entity', comp: { eid: T2, num: 3, created_at: '' } },
    { eid: T2, name: 'doc', comp: { title: 'Second', body: '' } },
    { eid: T2, name: 'task', comp: { priority: 1 } },
    {
      eid: T2,
      name: 'alias',
      comp: { slug: 'old-board-slug', slugs: 'extra' },
    },
  ],
  deps: [{ parent: T1, type: 'requires', child: T2 }],
}
let all = rows(snap)
let by = (eid: string) => all.find((r) => r.eid == eid)!

Deno.test('rows: merge, derived kind, ids', () => {
  assertEquals(by(T1).kind, 'task')
  assertEquals(by(S).kind, 'session')
  assertEquals(idOf(by(T1)), 'T-2')
  assertEquals(idOf(by(S)), 'S-1')
  assertEquals(kindOf({ comment: {}, review: {} }), 'review')
  assertEquals(kindOf({}), 'entity')
})

// The create-print invariant (T-22591): a create names the num of the entity
// it actually MINTED — the spine /apply echoed for THIS eid — never a num
// obtained any other way. The fatal bug printed a foreign num (the caller's
// own session's) for a task that never landed, so the CLI wrote its
// body/claim/comment onto the stranger. mintedIn reads the num only from the
// batch's own spine, so a foreign entity riding the same batch cannot be
// mistaken for the mint, and a missing spine is a loud failure, not a guess.
Deno.test('mintedIn: names the minted eid, never a foreign num', () => {
  let NEW = 'bbbbbbbb-0000-4000-8000-000000000001'
  let SESSION = 'bbbbbbbb-0000-4000-8000-0000000000ff'
  // The echoed /apply batch: the task this write minted (num 7) alongside the
  // caller's own session (num 22575), which rides the batch as a touched
  // provenance row. The old separate read-back could resolve to the session.
  let applied: Change[] = [
    { eid: NEW, name: 'doc', comp: { title: 'Fresh', body: '' } },
    { eid: NEW, name: 'task', comp: { priority: 1 } },
    { eid: NEW, name: 'entity', comp: { eid: NEW, num: 7, created_at: '' } },
    { eid: SESSION, name: 'session', comp: { id: 'sess-y', cwd: '/w' } },
    {
      eid: SESSION,
      name: 'entity',
      comp: { eid: SESSION, num: 22575, created_at: '' },
    },
  ]
  assertEquals(mintedIn(applied, NEW), 'T-7')
})

Deno.test('mintedIn: no spine for the eid is a loud failure, not a stale num', () => {
  let NEW = 'bbbbbbbb-0000-4000-8000-000000000002'
  let SESSION = 'bbbbbbbb-0000-4000-8000-0000000000ff'
  // The mint did NOT land (a restart dropped it): the batch carries only the
  // caller's session spine. There is no num that names the task, so the door
  // must throw rather than borrow 22575.
  let applied: Change[] = [
    {
      eid: SESSION,
      name: 'entity',
      comp: { eid: SESSION, num: 22575, created_at: '' },
    },
    { eid: SESSION, name: 'session', comp: { id: 'sess-y', cwd: '/w' } },
  ]
  assertThrows(() => mintedIn(applied, NEW), Error, 'not confirmed')
})

Deno.test('fetched dedupes and bounds address batches', async () => {
  let unique = Array.from({ length: 51 }, (_, i) => `name-${i}`)
  let calls: string[][] = []
  await fetched([...unique, ...unique], ['.kind=person'], (filters) => {
    calls.push(filters)
    return Promise.resolve([])
  })
  assertEquals(calls.map((c) => c[0].slice(3).split(',').length), [50, 1])
  assertEquals(calls.flatMap((c) => c[0].slice(3).split(',')), unique)
  assertEquals(calls.every((c) => c[1] == '.kind=person'), true)
})

Deno.test('rows: canonical Session facets win, including null', () => {
  let projected = rows({
    changes: [
      { eid: S, name: 'entity', comp: { eid: S, num: 1 } },
      {
        eid: S,
        name: 'session',
        comp: { id: 'sess-x', provider: 'claude', cwd: '/stale', pid: 7 },
      },
      { eid: S, name: 'spawn', comp: { provider: 'codex' } },
      { eid: S, name: 'worktree', comp: { cwd: null } },
      { eid: S, name: 'runtime', comp: { pid: null } },
    ],
  })[0].comps.session
  assertEquals(projected?.provider, 'codex')
  assertEquals(projected?.cwd, null)
  assertEquals(projected?.pid, null)
})

Deno.test('rows hide quarantine unless the caller explicitly reveals it', () => {
  let snap = {
    changes: [
      { eid: T1, name: 'entity', comp: { eid: T1, num: 2 } },
      { eid: T1, name: 'doc', comp: { title: 'unsafe', body: 'hidden' } },
      { eid: T1, name: 'quarantined', comp: { at: 'now' } },
    ],
    deps: [],
  }
  assertEquals(rows(snap), [])
  assertEquals(rows(snap, true)[0].comps.doc.body, 'hidden')
})

Deno.test('jsonOf: an entity is its components without SQL join keys', () => {
  let r: Row = {
    eid: T1,
    num: 2,
    kind: 'task',
    comps: {
      entity: { eid: T1, num: 2 },
      doc: { eid: T1, title: 'First', body: '' },
      task: { eid: T1, status: 'wip', priority: 0 },
      kind: { eid: T1, value: 'reserved' },
    },
  }
  assertEquals(jsonOf(r), {
    kind: 'task',
    entity: { eid: T1, num: 2 },
    doc: { title: 'First', body: '' },
    task: { status: 'wip', priority: 0 },
  })
})

// `task docs` orders the architecture docs root-first: the root `contains` the
// leaves, so a doc that is the CHILD end of a contains edge within the set is a
// leaf and sinks; the root leads, and leaves fall to num order. An edge whose
// parent lies OUTSIDE the set (P-19 contains the root) must not demote the root.
Deno.test('rootFirst: the containing doc leads, its contents follow by num', () => {
  let doc = (eid: string, num: number, title: string): Row => ({
    eid,
    num,
    kind: 'doc',
    comps: { entity: { eid, num }, doc: { eid, title, body: '' } },
  })
  let root = doc('R', 10, 'the map')
  let leafA = doc('LA', 25, 'sessions')
  let leafB = doc('LB', 18, 'the wire')
  let deps: Dep[] = [
    // P-19 contains the root — parent outside the set, so the root stays a root.
    { parent: 'P19', type: 'contains' as const, child: 'R' },
    { parent: 'R', type: 'contains' as const, child: 'LA' },
    { parent: 'R', type: 'contains' as const, child: 'LB' },
  ]
  // Fed in scrambled order, it comes back root-first then leaves ascending.
  let sorted = rootFirst([leafA, root, leafB], deps)
  assertEquals(sorted.map((r) => r.eid), ['R', 'LB', 'LA'])
})

// The grammar, as a case table: arg → routed {comp, prop, value} or error.
let CASES: [string, { comp: string; prop: string; value: unknown } | RegExp][] =
  [
    ['.title=Hi', { comp: 'doc', prop: 'title', value: 'Hi' }],
    ['.status=done', { comp: 'task', prop: 'status', value: 'done' }],
    ['.status=WIP', { comp: 'task', prop: 'status', value: 'wip' }],
    ['.domain=Eng', { comp: 'task', prop: 'domain', value: 'Eng' }],
    ['.proposed.at=2026-08-01T00:00:00.000Z', {
      comp: 'proposed',
      prop: 'at',
      value: '2026-08-01T00:00:00.000Z',
    }],
    ['.operator=YES', { comp: 'session', prop: 'operator', value: 1 }],
    ['.provider=fake', {
      comp: 'session',
      prop: 'provider',
      value: 'fake',
    }],
    ['.persona=N-1', {
      comp: 'session',
      prop: 'persona',
      value: 'N-1',
    }],
    ['.spawn.provider=fake', {
      comp: 'spawn',
      prop: 'provider',
      value: 'fake',
    }],
    ['.cwd=/tmp/tree', {
      comp: 'session',
      prop: 'cwd',
      value: '/tmp/tree',
    }],
    ['.worktree.cwd=/tmp/tree', {
      comp: 'worktree',
      prop: 'cwd',
      value: '/tmp/tree',
    }],
    ['.runtime.pid=42', {
      comp: 'runtime',
      prop: 'pid',
      value: 42,
    }],
    ['.priority=1.5', { comp: 'task', prop: 'priority', value: 1.5 }],
    // priority speaks P<n> at the write door too (T-6741/T-7143): 'P2' and
    // '2' both store the integer 2; garbage is a loud error, not bad data.
    ['.priority=P2', { comp: 'task', prop: 'priority', value: 2 }],
    ['.priority=2', { comp: 'task', prop: 'priority', value: 2 }],
    ['.priority=P0', { comp: 'task', prop: 'priority', value: 0 }],
    ['.task.priority=P1', { comp: 'task', prop: 'priority', value: 1 }],
    ['.priority=banana', /priority is a finite number/],
    ['.priority=P', /priority is a finite number/],
    ['.pin.x=12', { comp: 'pin', prop: 'x', value: 12 }],
    ['.assignee=jeff', { comp: 'task', prop: 'assignee', value: 'jeff' }],
    // a shared ref name filters as any-of, but a WRITE must aim
    ['.actor=jeff', /ambiguous for writes/],
    ['.session.actor=jeff', {
      comp: 'session',
      prop: 'actor',
      value: 'jeff',
    }],
    ['.x=12', /ambiguous/],
    ['.nope=1', /unknown prop/],
    // Hyphenated names must ROUTE (and fail) rather than slip the
    // pattern: a name the regex rejected returned null, and cli.ts's
    // split() files every non-param token under `words` — so
    // `.blocked-by=T-1` became part of the task's TITLE, no edge and no
    // error. No column is hyphenated, so nothing new resolves.
    ['.blocked-by=T-1', /unknown prop/],
    // The refusal names the component's columns and their types, the same
    // sentence the graph doors answer with (C-32675 item 3).
    [
      '.doc.nope=1',
      /^no such prop: \.doc\.nope — doc has title \(text\), body \(text\)$/,
    ],
    // An optional enum clears on empty like any other scalar (T-16491).
    ['.venture.paused_from=', {
      comp: 'venture',
      prop: 'paused_from',
      value: null,
    }],
  ]
Deno.test('dot-param routing', () => {
  for (let [arg, want] of CASES) {
    if (want instanceof RegExp) {
      // The WORDS, not just the throw: a refusal is read by whoever asked.
      assertMatch(
        String(
          (assertThrows(() => param(arg), Error, undefined, arg) as Error)
            .message,
        ),
        want,
        arg,
      )
    } else assertEquals(param(arg), want, arg)
  }
  assertEquals(param('bare word'), null)
  assertEquals(patches([param('.title=a')!, param('.status=wip')!]), {
    doc: { title: 'a' },
    task: { status: 'wip' },
  })
})

// A bare facet used to reach propAt() with an empty prop and dereference
// undefined — `Cannot read properties of undefined (reading 'type')` landed on
// the operator (T-12981). Now it teaches the write spelling. Assert the MESSAGE,
// not just that it throws: the old crash threw too.
Deno.test('param: a bare facet teaches instead of crashing (T-12981)', () => {
  // Assert the MESSAGE, not just that it throws — the old crash threw too (a
  // raw TypeError, "Cannot read properties of undefined"). A facet with columns
  // names its write spelling; a column-less one says it's server-stamped.
  assertThrows(() => param('.proposed='), Error, '.proposed.at=')
  assertThrows(() => param('.decided='), Error, '.decided.at=')
  assertThrows(() => param('.archived='), Error, 'server-stamped mark')
})

// A `$edit` block passed as a dot-param value used to be STORED as the body,
// clobbering the doc it was meant to patch (T-33926). The `$` sigil is
// reserved for operators at every door, so the update doors route the same
// operator graph_apply takes, and apply() owns every refusal.
Deno.test('param: a $-sigil JSON value routes as the field operator', () => {
  let edit = { $edit: { old: 'teh', new: 'the' } }
  assertEquals(param(`.body=${JSON.stringify(edit)}`), {
    comp: 'doc',
    prop: 'body',
    value: edit,
  })
  // Multi-hunk, whitespace and all — JSON.parse reads it, not the eye.
  assertEquals(
    param('.body= {"$edit": [{"old": "a", "new": "b", "all": true}]}')?.value,
    { $edit: [{ old: 'a', new: 'b', all: true }] },
  )
  // An operator on a reference column stays an operator: apply() refuses it
  // by column, rather than deref failing on '[object Object]'.
  assertEquals(param(`.project=${JSON.stringify(edit)}`)?.value, edit)
  assertEquals(derefParams([], [param(`.project=${JSON.stringify(edit)}`)!]), [
    { comp: 'task', prop: 'project', value: edit },
  ])
  // Only the sigil is reserved. Ordinary prose — JSON prose included — is a
  // literal, so a body that happens to be an object still stores verbatim.
  let plain = '{"old": "teh", "new": "the"}'
  assertEquals(param(`.body=${plain}`)?.value, plain)
  assertEquals(param('.body={not json')?.value, '{not json')
})

Deno.test('param: empty writable facets compile Boolean presence', () => {
  assertEquals(param('.verifier=true'), {
    comp: 'verifier',
    prop: '',
    value: true,
  })
  assertEquals(param('.noverify=false'), {
    comp: 'noverify',
    prop: '',
    value: false,
  })
  assertEquals(
    patches([
      param('.verifier=true')!,
      param('.noverify=false')!,
    ]),
    { verifier: {}, noverify: null },
  )
  assertThrows(
    () => param('.verifier=maybe'),
    Error,
    "verifier is a boolean (true, false, 1, 0, yes, no) — got 'maybe'",
  )
})

Deno.test('find: T-num, bare num, eid, alias slug', () => {
  assertEquals(find(all, 'T-2')?.eid, T1)
  assertEquals(find(all, '3')?.eid, T2)
  assertEquals(find(all, T1)?.eid, T1)
  assertEquals(find(all, 'old-board-slug')?.eid, T2)
  assertEquals(find(all, 'extra')?.eid, T2) // an additional slug resolves too
  assertEquals(find(all, 'T-99'), undefined)
})

Deno.test('notices: claimed-work comments + direct-session compatibility', () => {
  let B = 'aaaaaaaa-0000-4000-8000-000000000010' // another session
  let P = 'aaaaaaaa-0000-4000-8000-000000000011' // their shared actor
  let mk = (
    eid: string,
    target: string,
    via: string,
    at: string,
    body: string,
  ) => [
    { eid, name: 'entity', comp: { eid, num: 90 } },
    { eid, name: 'created', comp: { at, by: P, via } },
    { eid, name: 'doc', comp: { title: '', body } },
    { eid, name: 'comment', comp: { target: target } },
  ]
  let busSnap: Snapshot = {
    changes: [
      ...snap.changes,
      { eid: P, name: 'entity', comp: { eid: P, num: 81 } },
      { eid: P, name: 'doc', comp: { title: 'Task Graph', body: '' } },
      { eid: P, name: 'project', comp: {} },
      {
        eid: S,
        name: 'session',
        comp: { id: 'sess-x', cwd: '/w', actor: P },
      },
      {
        eid: T1,
        name: 'claim',
        comp: { session: S, claimed_at: '2026-01-01' },
      },
      { eid: B, name: 'entity', comp: { eid: B, num: 80, created_at: '' } },
      { eid: B, name: 'session', comp: { id: 'sess-b', actor: P } },
      // the lease took everything already on the task
      ...mk('c-0', T1, B, '2025-12-31', 'older than the claim'),
      // on the claimed task, after the cutoff: heard
      ...mk('c-1', T1, B, '2026-01-02', 'heads up'),
      { eid: 'c-1', name: 'review', comp: { verdict: 'approved' } },
      // aimed at the session itself: heard (a message TO sess-x)
      ...mk('c-2', S, B, '2026-01-03', 'ping'),
      // spoken via the listener: never echoed back
      ...mk('c-3', T1, S, '2026-01-04', 'my own note'),
      // on an unclaimed task: not ours to hear
      ...mk('c-4', T2, B, '2026-01-05', 'elsewhere'),
    ],
    deps: snap.deps,
  }
  let n = noticesFor(busSnap, 'sess-x')
  assertEquals(n.lines.length, 2)
  assertEquals(n.lines[0].includes('heads up'), true)
  assertEquals(n.lines.some((line) => line.includes('older than')), false)
  assertEquals(n.lines[0].includes('[approved]'), true)
  assertEquals(n.lines[1].includes('P-81 · via S-80: ping'), true)
  assertEquals(n.eids.sort(), ['c-1', 'c-2'])
  // Human inbox state cannot hide work from an agent.
  let pre: Snapshot = {
    changes: [...busSnap.changes, { eid: 'c-1', name: 'notified', comp: {} }],
    deps: snap.deps,
  }
  assertEquals(noticesFor(pre, 'sess-x').lines.length, 2)
  // The retired session cursor cannot hide them either.
  let acked: Snapshot = {
    changes: busSnap.changes.map((c) =>
      c.eid == S && c.name == 'session'
        ? { ...c, comp: { ...c.comp, acked_at: '2099-01-01' } }
        : c
    ),
    deps: snap.deps,
  }
  assertEquals(noticesFor(acked, 'sess-x').lines.length, 2)
  // unknown session: silent
  assertEquals(noticesFor(busSnap, 'sess-nobody'), {
    lines: [],
    eids: [],
    at: '',
  })
})

Deno.test('notices: comments, acted knocks, and verified operator mail surface together', () => {
  let P = 'aaaaaaaa-0000-4000-8000-000000000041'
  let B = 'aaaaaaaa-0000-4000-8000-000000000042'
  let C = 'aaaaaaaa-0000-4000-8000-000000000043'
  let K = 'aaaaaaaa-0000-4000-8000-000000000044'
  let M = 'aaaaaaaa-0000-4000-8000-000000000045'
  let U = 'aaaaaaaa-0000-4000-8000-000000000046'
  let g: Snapshot = {
    changes: [
      ...snap.changes,
      { eid: P, name: 'entity', comp: { eid: P, num: 41 } },
      { eid: P, name: 'doc', comp: { title: 'Home', body: '' } },
      { eid: P, name: 'project', comp: {} },
      { eid: B, name: 'entity', comp: { eid: B, num: 42 } },
      { eid: B, name: 'session', comp: { id: 'sender' } },
      {
        eid: S,
        name: 'session',
        comp: { id: 'sess-x', cwd: '/w', actor: P, operator: 1 },
      },
      { eid: C, name: 'entity', comp: { eid: C, num: 43 } },
      { eid: C, name: 'created', comp: { at: '2026-01-02', by: P, via: B } },
      { eid: C, name: 'doc', comp: { title: '', body: 'review this' } },
      { eid: C, name: 'comment', comp: { target: T1 } },
      { eid: K, name: 'entity', comp: { eid: K, num: 44 } },
      // born now: the bus drops a knock older than a week
      { eid: K, name: 'created', comp: { at: new Date().toISOString() } },
      { eid: K, name: 'knock', comp: { target: T1 } },
      { eid: K, name: 'deliver', comp: { to: S } }, // WHO — the shared facet
      // The outcome is the shared error facet now (D-14945); the inbox
      // surfaces the knock regardless, the same as its old acted_at receipt.
      {
        eid: K,
        name: 'error',
        comp: { at: '2026-01-03', message: 'no channel' },
      },
      { eid: M, name: 'entity', comp: { eid: M, num: 45 } },
      { eid: M, name: 'created', comp: { at: '2026-01-04' } },
      { eid: M, name: 'doc', comp: { title: 'hello', body: 'mail body' } },
      {
        eid: M,
        name: 'mail',
        comp: {
          target: P,
          from: 'friend@example.test',
          received_at: '2026-01-04',
          message_id: 'm-1',
          verified: 1,
        },
      },
      { eid: U, name: 'entity', comp: { eid: U, num: 46 } },
      { eid: U, name: 'created', comp: { at: '2026-01-05' } },
      { eid: U, name: 'doc', comp: { title: 'bad', body: 'unverified' } },
      {
        eid: U,
        name: 'mail',
        comp: {
          target: P,
          received_at: '2026-01-05',
          message_id: 'm-2',
          verified: 0,
        },
      },
    ],
    deps: snap.deps,
  }
  let n = noticesFor(g, 'sess-x')
  assertEquals(n.lines.length, 3)
  assertEquals(n.lines.every((line) => line.startsWith('UNTRUSTED ')), true)
  assertEquals(n.lines.some((line) => line.includes('review this')), true)
  assertEquals(
    n.lines.some((line) => line.includes('knock K-44: look at T-2')),
    true,
  )
  assertEquals(n.lines.some((line) => line.includes('mail body')), true)
  assertEquals(n.lines.some((line) => line.includes('unverified')), false)
  assertEquals(n.eids.sort(), [C, K, M].sort())
  let ordinary: Snapshot = {
    ...g,
    changes: g.changes.map((change) =>
      change.eid == S && change.name == 'session'
        ? { ...change, comp: { ...change.comp, operator: 0 } }
        : change
    ),
  }
  let direct = noticesFor(ordinary, 'sess-x').lines
  assertEquals(direct.some((line) => line.includes('mail body')), false)
  assertEquals(direct.some((line) => line.includes('review this')), true)
  assertEquals(
    direct.some((line) => line.includes('knock K-44: look at T-2')),
    true,
  )
})

Deno.test('notices: an explicit context read is bounded and stateless', () => {
  let comments = Array.from({ length: 22 }, (_, i) => {
    let eid = `comment-${String(i).padStart(2, '0')}`
    return [
      { eid, name: 'entity', comp: { eid, num: 100 + i } },
      {
        eid,
        name: 'created',
        comp: { at: `2026-01-${String(i + 1).padStart(2, '0')}` },
      },
      { eid, name: 'doc', comp: { title: '', body: `message ${i}` } },
      { eid, name: 'comment', comp: { target: S } },
    ]
  }).flat()
  let g: Snapshot = { changes: [...snap.changes, ...comments], deps: snap.deps }
  let first = noticesFor(g, 'sess-x')
  assertEquals(first.lines.length, 11) // 10 items + overflow summary
  assertEquals(first.eids.length, 10)
  assertEquals(noticesFor(g, 'sess-x'), first)
})

Deno.test('notices: human stamps cannot drain an agent query', () => {
  let B = 'aaaaaaaa-0000-4000-8000-000000000030'
  let mk = (eid: string, at: string, body: string) => [
    { eid, name: 'entity', comp: { eid, num: 90 } },
    { eid, name: 'created', comp: { at, via: B } },
    { eid, name: 'doc', comp: { title: '', body } },
    { eid, name: 'comment', comp: { target: S } },
  ]
  let g: Snapshot = {
    changes: [
      ...snap.changes,
      { eid: B, name: 'entity', comp: { eid: B, num: 30, created_at: '' } },
      { eid: B, name: 'session', comp: { id: 'sess-b' } },
      ...mk('m-1', '2026-01-02', 'first ping'),
      ...mk('m-2', '2026-01-03', 'second ping'),
    ],
    deps: snap.deps,
  }
  let drained: Snapshot = {
    changes: [
      ...g.changes.map((c) =>
        c.eid == S && c.name == 'session'
          ? { ...c, comp: { ...c.comp, acked_at: '2099-01-01' } }
          : c
      ),
      { eid: 'm-1', name: 'notified', comp: {} },
    ],
    deps: snap.deps,
  }
  let n = noticesFor(drained, 'sess-x')
  assertEquals(n.lines.length, 2)
  assertEquals(n.eids, ['m-1', 'm-2'])
})

Deno.test('rows filter through the query grammar + byBoard', () => {
  assertEquals(matchQuery(by(T1).comps, parseQuery('.status=wip')), true)
  assertEquals(matchQuery(by(T1).comps, parseQuery('.status=done')), false)
  let review = {
    comment: { target: T1 },
    review: { verdict: 'approved' },
  }
  assertEquals(
    matchQuery(
      review,
      // bare .verdict went ambiguous when decided grew one (T-21319)
      parseQuery(`.comment.target=${T1}&.review.verdict=approved`),
    ),
    true,
  )
  assertEquals([...all.filter((r) => r.comps.task)].sort(byBoard)[0].eid, T2) // open before wip
})

Deno.test('byList: named values sort either way and missing values stay last', () => {
  let row = (
    eid: string,
    num: number,
    priority?: number,
    created?: string,
  ) => ({
    eid,
    num,
    kind: 'task',
    comps: {
      task: { priority },
      ...(created ? { created: { at: created } } : {}),
    },
  })
  let a = row('a', 1, 2, '2026-01-01T00:00:00.000Z')
  let b = row('b', 2, 1, '2026-02-01T00:00:00.000Z')
  let empty = row('empty', 3)
  assertEquals([a, empty, b].sort(byList('priority')).map((r) => r.eid), [
    'b',
    'a',
    'empty',
  ])
  assertEquals([a, empty, b].sort(byList('-created')).map((r) => r.eid), [
    'b',
    'a',
    'empty',
  ])
})

Deno.test('taskChanges: defaults + grouped comps ride along', () => {
  let cs = taskChanges('E', { doc: { title: 'x' }, pin: { x: 1 } })
  assertEquals(cs.map((c) => c.name), ['doc', 'task', 'pin'])
  assertEquals(cs[0].comp, { body: '', title: 'x' })
  // Born open: no status mark (D-24102) — status is derived, not stored.
  assertEquals(cs[1].comp, {})
})

Deno.test('statusChanges replaces conflicting lifecycle facets', () => {
  assertEquals(statusChanges(T1, 'done'), [
    { eid: T1, name: 'cancelled', comp: null },
    { eid: T1, name: 'completed', comp: {} },
  ])
  assertEquals(statusChanges(T1, 'wip', S), [
    { eid: T1, name: 'completed', comp: null },
    { eid: T1, name: 'cancelled', comp: null },
    { eid: T1, name: 'claim', comp: { session: S } },
  ])
  assertEquals(statusChanges(T1, 'open'), [
    { eid: T1, name: 'completed', comp: null },
    { eid: T1, name: 'cancelled', comp: null },
    { eid: T1, name: 'claim', comp: null },
  ])
})

Deno.test('patchChanges expands virtual status and preserves siblings', () => {
  assertEquals(
    patchChanges(by(T2), {
      task: { status: 'done', priority: 2 },
      doc: { body: 'shipped' },
    }),
    [
      { eid: T2, name: 'task', comp: { priority: 2 } },
      { eid: T2, name: 'doc', comp: { body: 'shipped' } },
      { eid: T2, name: 'cancelled', comp: null },
      { eid: T2, name: 'completed', comp: {} },
    ],
  )
  assertThrows(
    () => patchChanges(by(T2), { task: { status: 'wip' } }),
    Error,
    'wip status needs a resolved session',
  )
  assertThrows(
    () => patchChanges(by(S), { task: { status: 'done' } }),
    Error,
    'cannot set task status on S-1',
  )
})

Deno.test('taskTreePlan: one rooted batch covers new and existing nodes', async () => {
  let P = 'cccccccc-0000-4000-8000-000000000019'
  let OLD = 'cccccccc-0000-4000-8000-000000000003'
  let pool: Row[] = [
    {
      eid: P,
      num: 19,
      kind: 'project',
      comps: { project: {}, doc: { title: 'Task Graph' } },
    },
    {
      eid: OLD,
      num: 3,
      kind: 'task',
      comps: {
        task: { project: P },
        doc: { title: 'Initiative' },
      },
    },
  ]
  let q = (filters: string[]) => {
    let ids = filters[0].slice(3).split(',')
    return Promise.resolve(
      pool.filter((r) => ids.some((id) => find(pool, id) == r)),
    )
  }
  let plan = await taskTreePlan({
    project: 'P-19',
    nodes: [
      { key: 'initiative', id: 'T-3' },
      {
        key: 'build',
        title: 'Build the primitive',
        parent: 'initiative',
        relation: 'requires',
        params: ['.priority=P1'],
      },
    ],
  }, q)
  let made = plan.nodes.find((n) => n.key == 'build')!
  assertEquals(
    plan.changes.filter((c) => c.name == 'edge' || typeOf[c.name]),
    [
      ...link(P, 'wants', OLD),
      ...link(OLD, 'requires', made.eid),
    ],
  )
  assertEquals(
    plan.changes.find((c) => c.eid == made.eid && c.name == 'task')?.comp,
    { project: P, priority: 1 },
  )
  assertEquals(
    taskTreeText(plan),
    'P-19 Task Graph\n└─ wants T-3 Initiative\n   └─ requires [build] Build the primitive',
  )
  assertEquals(
    taskTreeText(plan, [
      ...plan.changes,
      {
        eid: made.eid,
        name: 'entity',
        comp: { eid: made.eid, num: 42 },
      },
    ]),
    'P-19 Task Graph\n└─ wants T-3 Initiative\n   └─ requires T-42 Build the primitive',
  )
})

Deno.test('taskTreePlan: duplicate, dangling, and cyclic keys cannot write', async () => {
  let P = 'dddddddd-0000-4000-8000-000000000019'
  let project: Row = {
    eid: P,
    num: 19,
    kind: 'project',
    comps: { project: {}, doc: { title: 'Task Graph' } },
  }
  let q = () => Promise.resolve([project])
  await assertRejects(
    () =>
      taskTreePlan({
        project: 'P-19',
        nodes: [{ key: 'x', title: 'A' }, { key: 'x', title: 'B' }],
      }, q),
    Error,
    'duplicate tree key: x',
  )
  await assertRejects(
    () =>
      taskTreePlan({
        project: 'P-19',
        nodes: [{ key: 'x', title: 'A', parent: 'missing', relation: 'reads' }],
      }, q),
    Error,
    'no tree key: missing',
  )
  await assertRejects(
    () =>
      taskTreePlan({
        project: 'P-19',
        nodes: [
          { key: 'a', title: 'A', parent: 'b', relation: 'requires' },
          { key: 'b', title: 'B', parent: 'a', relation: 'requires' },
        ],
      }, q),
    Error,
    'literal cycle',
  )
})

Deno.test('normalizeLiterals: nested aliases compile to one canonical batch', () => {
  let P = 'eeeeeeee-0000-4000-8000-000000000019'
  let M = 'eeeeeeee-0000-4000-8000-000000000020'
  let minted = [
    'eeeeeeee-0000-4000-8000-000000000001',
    'eeeeeeee-0000-4000-8000-000000000002',
    'eeeeeeee-0000-4000-8000-000000000003',
  ]
  let known: Record<string, string> = { 'P-19': P, 'M-20': M }
  let was = { title: 'old-title-hash' }
  let plan = normalizeLiterals([
    { key: 'project', id: 'P-19' },
    { key: 'memory', id: 'M-20' },
    {
      key: 'goal',
      comps: {
        doc: { title: 'Goal' },
        task: { project: 'project' },
      },
      was: { doc: was },
      deps: {
        requires: [{
          key: 'gate',
          comps: {
            doc: { title: 'Gate' },
            task: { project: 'project' },
          },
          deps: { reads: ['memory'] },
        }],
      },
    },
    {
      key: 'recall',
      comps: { recalled: { source: 'memory' } },
      deps: { recalled: ['memory'] },
    },
  ], {
    resolve: (id) => known[id],
    mint: () => minted.shift()!,
  })
  assertEquals(plan.aliases, {
    project: P,
    memory: M,
    goal: 'eeeeeeee-0000-4000-8000-000000000001',
    gate: 'eeeeeeee-0000-4000-8000-000000000002',
    recall: 'eeeeeeee-0000-4000-8000-000000000003',
  })
  assertEquals(plan.changes[0].was === was, true, 'was rides unchanged')
  // The recalling edge is an EVENT, so its tag carries the moment it was
  // said — compared for its shape, not for a clock two calls apart.
  let recalled = plan.changes.find((c) => c.name == 'recalled' && c.comp?.at)
  assertMatch(String(recalled?.comp?.at), /^20\d\d-/)
  let timeless = (c: Change) =>
    c.name == 'recalled' && c.comp && 'at' in c.comp ? { ...c, comp: {} } : c
  assertEquals(plan.changes.map(timeless), [
    {
      eid: plan.aliases.goal,
      name: 'doc',
      comp: { title: 'Goal' },
      was: { title: 'old-title-hash' },
    },
    {
      eid: plan.aliases.goal,
      name: 'task',
      comp: { project: P },
    },
    {
      eid: plan.aliases.gate,
      name: 'doc',
      comp: { title: 'Gate' },
    },
    {
      eid: plan.aliases.gate,
      name: 'task',
      comp: { project: P },
    },
    {
      eid: plan.aliases.recall,
      name: 'recalled',
      comp: { source: M },
    },
    ...link(plan.aliases.goal, 'requires', plan.aliases.gate),
    ...link(plan.aliases.gate, 'reads', M),
    ...link(plan.aliases.recall, 'recalled', M).map(timeless),
  ])
})

Deno.test('normalizeLiterals: the read shape writes — $alias, nesting, human ids, was', () => {
  let P = 'ffffffff-0000-4000-8000-000000000019'
  let T = 'ffffffff-0000-4000-8000-000000000030'
  // Minted in visit order: goal, its nested gate, space, the note, its
  // nested memory.
  let [goal, gate, space, note, m] = [1, 2, 3, 4, 5].map((n) =>
    `ffffffff-0000-4000-8000-00000000000${n}`
  )
  let minted = [goal, gate, space, note, m]
  let known: Record<string, string> = { 'P-19': P, 'T-3': T }
  let was = { title: 'old-title-hash' }
  let plan = normalizeLiterals([
    {
      // A forward $alias in a ref column: $space is defined below, yet its
      // changes land first, so the column names a spine that exists.
      entity: { eid: '$goal' },
      doc: { title: 'Goal' },
      task: { project: '$space' },
      was: { doc: was },
      edges: [
        { type: 'requires', child: 'T-3' },
        {
          type: 'requires',
          child: { entity: { eid: '$gate' }, doc: { title: 'Gate' } },
        },
      ],
    },
    { entity: { eid: '$space' }, doc: { title: 'Space' }, project: {} },
    {
      // A read sent back: its projections and stamps ride along and drop.
      kind: 'task',
      entity: { eid: 'T-3', num: 3 },
      task: { status: 'open', priority: 1 },
      created: { at: '2026-09-02T00:00:00Z', by: 'P-19' },
      refs: [],
      backrefs: [],
      comments: [],
    },
    {
      // A nested bundle where an eid goes; a reference bundle is just its eid.
      comment: { target: { entity: { eid: 'P-19' } }, body: 'note' },
      recalled: { source: { entity: { eid: '$m' }, memory: {} } },
    },
  ], {
    resolve: (id) => known[id],
    mint: () => minted.shift()!,
  })
  assertEquals(plan.aliases, { $goal: goal, $gate: gate, $space: space, $m: m })
  assertEquals(plan.changes[2].was === was, true, 'was rides unchanged')
  assertEquals(plan.changes, [
    // Comps within an entity emit in alphabetical vocabulary order (compOrder
    // is derived alphabetically): created before task, comment before recalled.
    { eid: space, name: 'doc', comp: { title: 'Space' } },
    { eid: space, name: 'project', comp: {} },
    { eid: goal, name: 'doc', comp: { title: 'Goal' }, was },
    { eid: goal, name: 'task', comp: { project: space } },
    { eid: gate, name: 'doc', comp: { title: 'Gate' } },
    { eid: T, name: 'created', comp: { at: '2026-09-02T00:00:00Z', by: P } },
    { eid: T, name: 'task', comp: { priority: 1 } },
    { eid: m, name: 'memory', comp: {} },
    { eid: note, name: 'comment', comp: { target: P, body: 'note' } },
    { eid: note, name: 'recalled', comp: { source: m } },
    ...link(goal, 'requires', T),
    ...link(goal, 'requires', gate),
  ])
  let bad: [string, Record<string, unknown>[], string][] = [
    [
      'dangling $alias',
      [{ doc: { title: 'x' }, task: { project: '$nowhere' } }],
      'no entity or literal key: $nowhere (.task.project)',
    ],
    [
      'double definition',
      [
        { entity: { eid: '$a' }, doc: {} },
        { entity: { eid: '$a' }, doc: {} },
      ],
      'duplicate literal key: $a',
    ],
    [
      'a $alias with nothing to define',
      [{ entity: { eid: '$a' } }],
      'a new entity literal needs at least one component',
    ],
    [
      'column cycle among new entities',
      [
        { entity: { eid: '$a' }, comment: { target: '$b' } },
        { entity: { eid: '$b' }, comment: { target: '$a' } },
      ],
      'literal cycle at $a',
    ],
    [
      'shapeless edge',
      [{ doc: {}, edges: { type: 'requires' } }],
      'an edge is {type, child}',
    ],
  ]
  for (let [name, literals, message] of bad) {
    assertThrows(
      () => normalizeLiterals(literals, { mint: () => crypto.randomUUID() }),
      Error,
      message,
      name,
    )
  }
})

Deno.test('normalizeLiterals: a bundle wearing tombstone deletes the entity', () => {
  let T = 'dddddddd-0000-4000-8000-000000000003'
  let plan = normalizeLiterals(
    [
      { entity: { eid: 'T-3' }, tombstone: {} },
      { entity: { eid: '$note' }, doc: { title: 'after' } },
    ],
    {
      resolve: (id) => id == 'T-3' ? T : undefined,
      mint: () => 'dddddddd-0000-4000-8000-000000000009',
    },
  )
  assertEquals(plan.changes, [
    { eid: T, name: 'entity', comp: null },
    {
      eid: 'dddddddd-0000-4000-8000-000000000009',
      name: 'doc',
      comp: { title: 'after' },
    },
  ])
  // A dead entity takes no patch, and there is nothing to kill in an entity
  // this batch is minting. (That a LATER batch for a dead eid is void is the
  // db's own rule — db_test 'entity delete tombstones; nothing resurrects'.)
  let bad: [string, Record<string, unknown>[], string][] = [
    [
      'beside a component',
      [{ entity: { eid: 'T-3' }, tombstone: {}, doc: { title: 'x' } }],
      'a dead entity takes no patch: tombstone cannot ride beside doc',
    ],
    [
      'beside an edge',
      [{
        entity: { eid: 'T-3' },
        tombstone: {},
        edges: { type: 'requires', child: 'T-3' },
      }],
      'a dead entity takes no patch: tombstone cannot ride beside requires',
    ],
    [
      'a $alias eid',
      [{ entity: { eid: '$gone' }, tombstone: {} }],
      'tombstone needs entity.eid to name an entity',
    ],
    [
      'no eid at all',
      [{ tombstone: {} }],
      'tombstone needs entity.eid to name an entity',
    ],
  ]
  for (let [name, literals, message] of bad) {
    assertThrows(
      () =>
        normalizeLiterals(literals, {
          resolve: (id) => id == 'T-3' ? T : undefined,
          mint: () => crypto.randomUUID(),
        }),
      Error,
      message,
      name,
    )
  }
})

Deno.test('normalizeLiterals: a bundle mints at a client-chosen eid', () => {
  let T = 'cccccccc-0000-4000-8000-000000000003'
  let plan = (literals: Record<string, unknown>[]) =>
    normalizeLiterals(literals, {
      resolve: (id) => id == 'T-3' || id == T ? T : undefined,
      mint: () => 'cccccccc-0000-4000-8000-00000000000f',
    })
  // A uuid nothing wears yet, carrying comps, IS the new entity's eid — and
  // an eid the batch names resolves for everything else in it. Uppercase in,
  // canonical lowercase out, the shape db.ts stores.
  let mine = 'CCCCCCCC-0000-4000-8000-0000000000AA'
  let hash = 'a'.repeat(64)
  // A commit is named by its git sha (40 hex) the way a blob is by its
  // content hash (64) — both are whole eids the bundle door may mint at.
  let sha = 'B'.repeat(40)
  assertEquals(
    plan([
      { entity: { eid: mine }, doc: { title: 'mine' } },
      { comment: { target: mine, body: 'about mine' } },
      { entity: { eid: sha }, commit: { target: mine, sha, repo: 'tasks' } },
      // The old literal shape's `id` follows the same rule.
      { id: hash, comps: { blob: { bytes: 1 } } },
    ]).changes,
    [
      { eid: mine.toLowerCase(), name: 'doc', comp: { title: 'mine' } },
      {
        eid: 'cccccccc-0000-4000-8000-00000000000f',
        name: 'comment',
        comp: { target: mine.toLowerCase(), body: 'about mine' },
      },
      {
        eid: sha.toLowerCase(),
        name: 'commit',
        comp: { target: mine.toLowerCase(), sha, repo: 'tasks' },
      },
      { eid: hash, name: 'blob', comp: { bytes: 1 } },
    ],
  )
  // Everything else unresolved is a typo, not a new entity: only an eid's own
  // shape licenses minting, and an eid with nothing to define is a reference.
  let bad: [string, Record<string, unknown>[], string][] = [
    [
      'a human id',
      [{ entity: { eid: 'T-9' }, doc: { title: 'x' } }],
      'no entity: T-9',
    ],
    [
      'a bare num',
      [{ entity: { eid: '9' }, doc: { title: 'x' } }],
      'no entity: 9',
    ],
    [
      'a slug',
      [{ entity: { eid: 'nowhere' }, doc: { title: 'x' } }],
      'no entity: nowhere',
    ],
    [
      'an eid with no components',
      [{ entity: { eid: 'cccccccc-0000-4000-8000-0000000000bb' } }],
      'no entity: cccccccc-0000-4000-8000-0000000000bb',
    ],
    [
      'an unresolved eid where an eid goes',
      [{ comment: { target: { entity: { eid: hash } }, body: 'x' } }],
      `no entity or literal key: ${hash} (.comment.target)`,
    ],
  ]
  for (let [name, literals, message] of bad) {
    assertThrows(() => plan(literals), Error, message, name)
  }
})

Deno.test('normalizeLiterals: an edge bundle under $alias mints at edgeEid', () => {
  let A = 'dddddddd-0000-4000-8000-00000000000a'
  let B = 'dddddddd-0000-4000-8000-00000000000b'
  let known: Record<string, string> = { 'T-1': A, 'T-2': B, [A]: A, [B]: B }
  let plan = (literals: Record<string, unknown>[]) =>
    normalizeLiterals(literals, {
      resolve: (id) => known[id],
      // A uuid nothing derives — if it ever appears, the eid was CHOSEN
      // where it should have been derived.
      mint: () => 'dddddddd-0000-4000-8000-00000000000f',
    })
  // A $alias asks the door to choose; for a sentence, choosing is deriving,
  // so the alias reports the eid apply() demands (db.ts, 'must be edgeEid').
  let said = edgeEid(A, 'requires', B)
  let out = plan([
    {
      entity: { eid: '$said' },
      edge: { from: 'T-1', to: 'T-2' },
      requires: {},
    },
  ])
  assertEquals(out.aliases, { $said: said })
  assertEquals(out.changes, [
    { eid: said, name: 'edge', comp: { from: A, to: B } },
    { eid: said, name: 'requires', comp: {} },
  ])
  // The ends may be anything an eid may be spelled as, a bundle this batch
  // mints included — the derivation waits for what it names.
  let minted = 'dddddddd-0000-4000-8000-00000000000f'
  assertEquals(
    plan([{
      entity: { eid: '$said' },
      edge: { from: { entity: { eid: '$doc' }, doc: { title: 'end' } }, to: A },
      about: {},
    }]).aliases,
    { $doc: minted, $said: edgeEid(minted, 'about', A) },
  )
  // A sentence that would have to name itself has no eid to derive.
  assertThrows(
    () =>
      plan([{
        entity: { eid: '$said' },
        edge: { from: '$said', to: A },
        about: {},
      }]),
    Error,
    'literal cycle at $said',
  )
})

Deno.test('normalizeLiterals: invalid aliases, references, keys, and cycles reject', () => {
  let cases: [string, Record<string, unknown>[], string][] = [
    [
      'duplicate',
      [{ key: 'same', comps: { doc: {} } }, {
        key: 'same',
        comps: { doc: {} },
      }],
      'duplicate literal key: same',
    ],
    [
      'dangling edge',
      [{ key: 'a', comps: { doc: {} }, deps: { reads: ['missing'] } }],
      'no entity or literal key: missing',
    ],
    [
      'dangling component reference',
      [{ key: 'a', comps: { task: { project: 'missing' } } }],
      'no entity or literal key: missing (.task.project)',
    ],
    [
      'unknown component',
      [{ key: 'a', comps: { invented: {} } }],
      'unknown component: invented',
    ],
    [
      'unknown edge type',
      [{ key: 'a', deps: { invented: [] } }],
      'unknown edge type: invented',
    ],
    [
      'cycle',
      [
        {
          key: 'a',
          comps: { doc: {} },
          deps: { requires: ['b'] },
        },
        {
          key: 'b',
          comps: { doc: {} },
          deps: { requires: ['a'] },
        },
      ],
      'literal cycle at a',
    ],
  ]
  for (let [name, literals, message] of cases) {
    assertThrows(
      () => normalizeLiterals(literals, { mint: () => crypto.randomUUID() }),
      Error,
      message,
      name,
    )
  }
  assertThrows(
    () =>
      normalizeLiterals([{ key: 'taken', comps: { doc: {} } }], {
        resolve: (id) => id == 'taken' ? T1 : undefined,
      }),
    Error,
    'literal key is also an entity: taken',
  )
})

Deno.test('taskTreeWarning: only a long prerequisite-free leaf gets adoption feedback', () => {
  let long = 'x'.repeat(TASK_TREE_ADOPTION.longBody + 1)
  assertEquals(taskTreeWarning('short body', 0, 'cli'), '')
  assertEquals(taskTreeWarning(long, 1, 'cli'), '')
  let cli = taskTreeWarning(long, 0, 'cli')
  assertMatch(cli, /warning: this long leaf has no prerequisite children/)
  assertMatch(cli, /3\+ steps/)
  assertEquals(cli.includes(TASK_TREE_ADOPTION.cli), true)
  assertEquals(cli.includes(taskTreeExample('cli')), true)
  let mcp = taskTreeWarning(long, 0, 'mcp')
  assertMatch(mcp, /task_tree/)
  assertMatch(mcp, /"dry_run":true/)
  assertEquals(mcp.includes(TASK_TREE_ADOPTION.cli), false)
})

Deno.test('sessionFor: reuse, mint, cwd + pid refresh', () => {
  assertEquals(sessionFor(all, 'sess-x').changes, []) // known, same cwd
  assertEquals(sessionFor(all, 'sess-x', '/elsewhere').changes, [
    { eid: S, name: 'session', comp: { cwd: '/elsewhere' } },
    { eid: S, name: 'worktree', comp: { cwd: '/elsewhere' } },
  ])
  let minted = sessionFor(all, 'sess-new', '/w2', 4242)
  assertEquals(minted.changes, [
    {
      eid: minted.eid,
      name: 'session',
      comp: { id: 'sess-new', cwd: '/w2', pid: 4242 },
    },
    { eid: minted.eid, name: 'worktree', comp: { cwd: '/w2' } },
    { eid: minted.eid, name: 'runtime', comp: { pid: 4242 } },
  ])
  // an unstamped row gains its pid; a re-run with the same pid is silent
  assertEquals(sessionFor(all, 'sess-x', '/w', 4242).changes, [
    { eid: S, name: 'session', comp: { pid: 4242 } },
    { eid: S, name: 'runtime', comp: { pid: 4242 } },
  ])
})

Deno.test('sessionFor: task context fills only a missing actor', () => {
  let actor = 'aaaaaaaa-0000-4000-8000-000000000004'
  assertEquals(
    sessionFor(all, 'sess-x', undefined, undefined, { actor: actor })
      .changes,
    [{ eid: S, name: 'session', comp: { actor: actor } }],
  )
  let worn = rows({
    changes: [
      ...snap.changes,
      {
        eid: S,
        name: 'session',
        comp: { id: 'sess-x', cwd: '/w', actor: T2 },
      },
    ],
  })
  assertEquals(
    sessionFor(worn, 'sess-x', undefined, undefined, { actor: actor })
      .changes,
    [],
  )
})

Deno.test('me: provider ids name external sessions; launchers name managed ones', () => {
  let env = (vals: Record<string, string>) => (k: string) => vals[k]
  assertEquals(
    me(env({
      CLAUDE_CODE_SESSION_ID: 'rotating',
      TASKS_SESSION: 'stale',
      CODEX_THREAD_ID: 'codex',
    })),
    'rotating',
  )
  assertEquals(
    me(env({ TASKS_SESSION: 'launcher', CODEX_THREAD_ID: 'codex' })),
    'launcher',
  )
  assertEquals(me(env({ CODEX_THREAD_ID: 'codex' })), 'codex')
  assertEquals(me(env({})), undefined)
})

Deno.test('me: a delegated child in a worktree is that tree, not the inherited id', () => {
  let env = (vals: Record<string, string>) => (k: string) => vals[k]
  let wt = '/home/a/.wt/agent-1'
  // child + linked worktree → the worktree wins over the inherited operator id
  assertEquals(
    me(
      env({ CLAUDE_CODE_CHILD_SESSION: '1', CLAUDE_CODE_SESSION_ID: 'op' }),
      () => wt,
    ),
    wt,
  )
  // child in the main checkout (no linked worktree) → the inherited id stands
  assertEquals(
    me(
      env({ CLAUDE_CODE_CHILD_SESSION: '1', CLAUDE_CODE_SESSION_ID: 'op' }),
      () => undefined,
    ),
    'op',
  )
  // not a child → the worktree is irrelevant, the inherited id stands
  assertEquals(me(env({ CLAUDE_CODE_SESSION_ID: 'op' }), () => wt), 'op')
})

Deno.test('me: the launcher voucher names a managed spawn despite the CHILD mark', () => {
  let env = (vals: Record<string, string>) => (k: string) => vals[k]
  let tree = '/home/a/.tasks/trees/repo/u-1'
  let spawn = {
    CLAUDE_CODE_CHILD_SESSION: '1', // claude stamps its own -p tools too
    CLAUDE_CODE_SESSION_ID: 'u-1',
    TASKS_SESSION: 'u-1',
    TASKS_TREE: tree,
  }
  // the vouched conversation, standing in the vouched tree → the spawn itself
  assertEquals(me(env(spawn), () => tree), 'u-1')
  // a child delegated inside it stands in its OWN worktree → tree identity
  let wt = '/home/a/repo/.claude/worktrees/agent-1'
  assertEquals(me(env(spawn), () => wt), wt)
  // a nested interactive launch holds a DIFFERENT conversation → not vouched
  assertEquals(
    me(env({ ...spawn, CLAUDE_CODE_SESSION_ID: 'u-2' }), () => tree),
    tree,
  )
  // an old launcher that named no tree → today's child behavior, unchanged
  let { TASKS_TREE: _, ...unvouched } = spawn
  assertEquals(me(env(unvouched), () => tree), tree)
})

Deno.test('sessionFor: a child records its operator parent, once', () => {
  // a fresh child carries the parent it was born under
  assertEquals(
    (sessionFor(all, 'child-1', '/wt', undefined, { parent: S })
      .changes[0].comp as Record<string, unknown>).parent,
    S,
  )
  // an existing session keeps the parent it already wears — a later reify
  // never relabels lineage
  let worn = rows({
    changes: [
      { eid: S, name: 'entity', comp: { eid: S, num: 1, created_at: '' } },
      {
        eid: S,
        name: 'session',
        comp: { id: 'child-1', parent: 'op-eid' },
      },
    ],
  })
  assertEquals(
    sessionFor(worn, 'child-1', undefined, undefined, { parent: 'other' })
      .changes,
    [],
  )
})

Deno.test('claimChanges points at the session entity', () => {
  let cs = claimChanges(all, T2, 'sess-x')
  assertEquals(cs, [{ eid: T2, name: 'claim', comp: { session: S } }])
})

Deno.test('workClaimMutation exposes only the guarded writer intent', () => {
  assertEquals(
    workClaimMutation('T-3', 'worker', { approve: true, cwd: '/work' }),
    {
      mutation: 'claim_work',
      target: 'T-3',
      session: 'worker',
      mode: 'approve',
      cwd: '/work',
    },
  )
})

Deno.test('spawnChanges: request speaks canonical and rollback frames', () => {
  let made = spawnChanges(all, {
    task: 'T-3', // human id resolves
    provider: 'claude',
    model: 'claude-fable-5',
    effort: 'high',
    persona: 'old-board-slug', // aliases resolve too
  })
  assertEquals(made.changes.length, 2)
  let c = made.changes[0]
  assertEquals(c.name, 'session')
  assertEquals(c.comp?.provider, 'claude')
  assertEquals(c.comp?.model, 'claude-fable-5')
  assertEquals(c.comp?.effort, 'high')
  assertEquals(c.comp?.requested_task, T2)
  assertEquals(c.comp?.persona, T2)
  assertMatch(String(c.comp?.id), /^[0-9a-f-]{36}$/)
  assertEquals(made.changes[1], {
    eid: made.eid,
    name: 'spawn',
    comp: {
      provider: 'claude',
      model: 'claude-fable-5',
      effort: 'high',
      persona: T2,
    },
  })
  assertThrows(() =>
    spawnChanges(all, { task: 'T-99', provider: 'x', model: 'y' })
  )
  // an id that is not a TASK is refused — a spawn needs work to do
  assertThrows(() =>
    spawnChanges(all, { task: 'S-1', provider: 'x', model: 'y' })
  )
  assertThrows(() =>
    spawnChanges(all, {
      task: 'T-3',
      provider: 'x',
      model: 'y',
      persona: 'nope',
    })
  )
})

Deno.test('spawnChanges: a chat has a prompt and no requested task', () => {
  let made = spawnChanges(all, {
    prompt: 'Compare these approaches',
    provider: 'codex',
    model: 'gpt-5.6-sol',
  })
  assertEquals(made.changes[0].comp?.requested_task, undefined)
  assertEquals(made.changes.at(-1), {
    eid: made.eid,
    name: 'doc',
    comp: { title: '', body: 'Compare these approaches' },
  })
})

Deno.test("spawnChanges: the actor chain — owner, then the task's project, then the caller", () => {
  let J = 'aaaaaaaa-0000-4000-8000-000000000021' // person
  let O = 'aaaaaaaa-0000-4000-8000-000000000022' // operator project
  let P = 'aaaaaaaa-0000-4000-8000-000000000023' // persona O contains
  let Q = 'aaaaaaaa-0000-4000-8000-000000000024' // persona about O
  let R = 'aaaaaaaa-0000-4000-8000-000000000025' // unowned persona
  let W = 'aaaaaaaa-0000-4000-8000-000000000026' // caller session
  let T = 'aaaaaaaa-0000-4000-8000-000000000027' // projectless task
  let V = 'aaaaaaaa-0000-4000-8000-000000000028' // another project
  let U = 'aaaaaaaa-0000-4000-8000-000000000029' // task of V
  let g: Snapshot = {
    changes: [
      { eid: J, name: 'entity', comp: { eid: J, num: 21, created_at: '' } },
      { eid: J, name: 'doc', comp: { title: 'Jeff', body: '' } },
      { eid: J, name: 'person', comp: {} },
      { eid: O, name: 'entity', comp: { eid: O, num: 22, created_at: '' } },
      { eid: O, name: 'doc', comp: { title: 'Ops', body: '' } },
      { eid: O, name: 'project', comp: {} },
      { eid: P, name: 'entity', comp: { eid: P, num: 23, created_at: '' } },
      { eid: P, name: 'doc', comp: { title: 'Envoy', body: '' } },
      { eid: Q, name: 'entity', comp: { eid: Q, num: 24, created_at: '' } },
      { eid: Q, name: 'doc', comp: { title: 'Herald', body: '' } },
      { eid: R, name: 'entity', comp: { eid: R, num: 25, created_at: '' } },
      { eid: R, name: 'doc', comp: { title: 'Drifter', body: '' } },
      { eid: W, name: 'entity', comp: { eid: W, num: 26, created_at: '' } },
      { eid: W, name: 'session', comp: { id: 'sess-w', actor: J } },
      { eid: T, name: 'entity', comp: { eid: T, num: 27, created_at: '' } },
      { eid: T, name: 'doc', comp: { title: 'work', body: '' } },
      { eid: T, name: 'task', comp: { priority: 0 } },
      { eid: V, name: 'entity', comp: { eid: V, num: 28, created_at: '' } },
      { eid: V, name: 'doc', comp: { title: 'Video', body: '' } },
      { eid: V, name: 'project', comp: {} },
      { eid: U, name: 'entity', comp: { eid: U, num: 29, created_at: '' } },
      { eid: U, name: 'doc', comp: { title: 'cut', body: '' } },
      {
        eid: U,
        name: 'task',
        comp: {
          priority: 0,
          project: V,
        },
      },
    ],
    deps: [
      { parent: O, type: 'contains', child: P },
      { parent: Q, type: 'about', child: O },
    ],
  }
  let world = rows(g)
  let spawn = (o: Record<string, unknown> = {}) =>
    spawnChanges(world, {
      task: 'T-27',
      provider: 'x',
      model: 'y',
      by: 'sess-w',
      deps: g.deps,
      ...o,
    }).changes[0].comp
  // a projectless task: the child works for whoever the caller works for
  assertEquals(spawn()?.actor, J)
  // a persona owned by an operator: the spawn acts AS the operator,
  // whichever way the ownership edge is spelled
  assertEquals(spawn({ persona: P })?.actor, O)
  assertEquals(spawn({ persona: Q })?.actor, O)
  // an unowned persona changes nothing — inheritance still holds
  assertEquals(spawn({ persona: R })?.actor, J)
  // a task WITH a project: the run acts for the project, not the person
  // who pressed spawn (T-7081) — a persona's owner still outranks it
  assertEquals(spawn({ task: 'T-29' })?.actor, V)
  assertEquals(spawn({ task: 'T-29', persona: P })?.actor, O)
  // no caller, no owner, no project: the spawn stays unattributed
  assertEquals('actor' in (spawn({ by: undefined }) ?? {}), false)
})

Deno.test('hookClaim: an unclaimed task claims, anything else is quiet', () => {
  assertEquals(hookClaim(all, 'T-3', 'sess-x', '/w'), [
    { eid: T2, name: 'claim', comp: { session: S } },
  ])
  assertEquals(hookClaim(all, 'T-2', 'sess-x'), []) // already held
  assertEquals(hookClaim(all, 'T-99', 'sess-x'), []) // no such task
  assertEquals(hookClaim(all, undefined, 'sess-x'), []) // no TASKS_TASK
})

Deno.test('commentChanges: doc + aim, session reified for server stamping', () => {
  let cs = commentChanges(all, T1, 'hi', 'sess-x')
  assertEquals(cs.length, 2)
  assertEquals(cs[1].comp, { target: T1 })
  assertEquals(commentChanges(all, T1, 'hi')[1].comp, { target: T1 })
  let review = commentChanges(all, T1, '', 'sess-x', {
    verdict: 'approved',
  })
  assertEquals(review.slice(-2), [
    { eid: review[0].eid, name: 'comment', comp: { target: T1 } },
    { eid: review[0].eid, name: 'review', comp: { verdict: 'approved' } },
  ])
})

Deno.test('task interaction anchors a tool-only session to the project', () => {
  let project = 'aaaaaaaa-0000-4000-8000-000000000004'
  let g = rows({
    changes: [
      ...snap.changes,
      { eid: project, name: 'project', comp: {} },
      { eid: T2, name: 'task', comp: { project: project } },
    ],
  })
  let actor = { eid: S, name: 'session', comp: { actor: project } }
  assertEquals(claimChanges(g, T2, 'sess-x'), [
    actor,
    { eid: T2, name: 'claim', comp: { session: S } },
  ])
  assertEquals(commentChanges(g, T2, 'project words', 'sess-x')[0], actor)
})

Deno.test('claimant resolves through the session entity', () => {
  assertEquals(claimant(all, by(T1)), 'sess-x')
  assertEquals(claimant(all, by(T2)), undefined)
})

Deno.test('wrapChanges: unfinished gets the trail, done goes quiet', () => {
  let cs = wrapChanges(all, 'sess-x') // T1 is wip → notice + release
  assertEquals(cs.filter((c) => c.name == 'claim').length, 1)
  // A lease lapse is machinery, not speech (D-13858): a NOTICE, never a comment.
  assertEquals(cs.filter((c) => c.name == 'comment').length, 0)
  assertEquals(cs.filter((c) => c.name == 'notice').length, 1)
  assertEquals(
    cs.find((c) => c.name == 'doc')?.comp?.body,
    '⚑ lease lapsed: session S-1 ended before this was done',
  )
  assertEquals(cs.find((c) => c.name == 'notice')?.comp, {
    target: T1,
    event: 'lapse',
  })
  let done = structuredClone(snap)
  // Done is DERIVED (D-24102): mint the completed mark, not a status column.
  done.changes.push({ eid: T1, name: 'completed', comp: {} })
  let quiet = wrapChanges(rows(done), 'sess-x')
  // finished work releases without a notice — only the brief rides along
  // (fixture S is docless and held a claim, so it earns the stub)
  assertEquals(quiet.filter((c) => c.name == 'notice'), [])
  assertEquals(quiet[0], { eid: T1, name: 'claim', comp: null })
  assertEquals(wrapChanges(all, 'sess-unknown'), [])
})

// The 9× re-lapse (T-20056): a managed session that keeps losing and
// re-claiming its lease is reaped afresh each cycle, so reapLeases called
// lapseChanges again over a re-created claim and minted ANOTHER identical
// "session S-1 ended" notice each time. The session ends once, so the notice
// is minted once — a target already wearing this exact lapse is skipped, while
// the claim still releases.
Deno.test('lapseChanges: one lapse notice per session, never a re-mint', () => {
  let body = '⚑ lease lapsed: session S-1 ended before this was done'
  // First lapse mints the notice and releases the claim.
  let first = lapseChanges(all, by(S))
  assertEquals(first.filter((c) => c.name == 'notice').length, 1)
  assertEquals(first.find((c) => c.name == 'doc')?.comp?.body, body)
  assertEquals(first.filter((c) => c.name == 'claim' && !c.comp).length, 1)

  // The session reclaims T1 and lapses again while its FIRST notice still
  // stands in the graph. The reap must release but mint no second notice.
  let N = 'aaaaaaaa-0000-4000-8000-000000000090'
  let notice: Change[] = [
    { eid: N, name: 'entity', comp: { eid: N, num: 9 } },
    { eid: N, name: 'doc', comp: { title: '', body } },
    { eid: N, name: 'notice', comp: { target: T1, event: 'lapse' } },
  ]
  let relapsed = rows({ changes: [...snap.changes, ...notice] })
  let again = lapseChanges(relapsed, relapsed.find((r) => r.eid == S)!)
  assertEquals(again.filter((c) => c.name == 'notice'), [])
  assertEquals(again.filter((c) => c.name == 'doc'), [])
  assertEquals(again, [{ eid: T1, name: 'claim', comp: null }])

  // A DIFFERENT session lapsing on the same task is a distinct message and
  // still rings — the dedup is keyed by the body that names the session.
  let other = 'aaaaaaaa-0000-4000-8000-000000000042'
  let two = rows({
    changes: [
      ...snap.changes,
      ...notice,
      { eid: other, name: 'entity', comp: { eid: other, num: 42 } },
      { eid: other, name: 'session', comp: { id: 'sess-y' } },
      { eid: T1, name: 'claim', comp: { session: other } },
    ],
  })
  let dist = lapseChanges(two, two.find((r) => r.eid == other)!)
  assertEquals(dist.filter((c) => c.name == 'notice').length, 1)
  assertEquals(
    dist.find((c) => c.name == 'doc')?.comp?.body,
    '⚑ lease lapsed: session S-42 ended before this was done',
  )
})

Deno.test('wrap brief: a docless working session gets the stub', () => {
  let AT = Date.UTC(2026, 6, 20)
  let doc = wrapChanges(all, 'sess-x', AT)
    .find((c) => c.name == 'doc' && c.eid == S)
  assertEquals(doc?.comp?.title, 'Work session 2026-07-20')
  assertMatch(String(doc?.comp?.body), /- T-2 \(wip\) First/)
  // a session that already wrote its brief keeps it
  let named = structuredClone(snap)
  named.changes.push({
    eid: S,
    name: 'doc',
    comp: { title: 'Mine', body: 'my own words' },
  })
  assertEquals(
    wrapChanges(rows(named), 'sess-x', AT)
      .some((c) => c.name == 'doc' && c.eid == S),
    false,
  )
  // an idle session — no claims, no comments — leaves nothing behind
  let idle = structuredClone(snap)
  idle.changes = idle.changes.filter((c) => c.name != 'claim')
  assertEquals(wrapChanges(rows(idle), 'sess-x', AT), [])
})

Deno.test('wrap brief: the final message IS the brief when captured', () => {
  let AT = Date.UTC(2026, 6, 20)
  let out = wrapChanges(all, 'sess-x', AT, [], 'Shipped the thing.\n\nNext: x')
  let brief = out.find((c) => c.name == 'brief' && c.eid == S)
  // it lands on the first-class brief component, NOT the session doc — which
  // stays free for the scribe's narrative (D-19459).
  assertEquals(brief?.comp?.text, 'Shipped the thing.\n\nNext: x')
  assertEquals(out.some((c) => c.name == 'doc' && c.eid == S), false)
  // a deliberate brief already written is never clobbered
  let briefed = structuredClone(snap)
  briefed.changes.push({
    eid: S,
    name: 'brief',
    comp: { text: 'my own words' },
  })
  assertEquals(
    wrapChanges(rows(briefed), 'sess-x', AT, [], 'captured')
      .some((c) => c.name == 'brief' && c.eid == S),
    false,
  )
  // an idle session's final message is not worth a brief
  let idle = structuredClone(snap)
  idle.changes = idle.changes.filter((c) => c.name != 'claim')
  assertEquals(wrapChanges(rows(idle), 'sess-x', AT, [], 'captured'), [])
})

Deno.test('spawnDefaults: the caller session lends all four fields', () => {
  let mine = structuredClone(snap)
  mine.changes.find((c) => c.eid == S && c.name == 'session')!.comp = {
    id: 'sess-x',
    provider: 'claude',
    model: 'claude-opus-4-8',
    effort: 'high',
    persona: T2,
  }
  assertEquals(spawnDefaults(rows(mine), 'sess-x'), {
    provider: 'claude',
    model: 'claude-opus-4-8',
    effort: 'high',
    persona: T2,
  })
  // a row with neither, an unknown session, no session: all default to none
  let none = {
    provider: undefined,
    model: undefined,
    effort: undefined,
    persona: undefined,
  }
  assertEquals(spawnDefaults(all, 'sess-x'), none)
  assertEquals(spawnDefaults(all, 'sess-unknown'), none)
  assertEquals(spawnDefaults(all), none)
})

// A provider table for the precedence helper: codex (with a `sol` default and
// an effort axis), claude, and one model both providers host (the ambiguity).
let table = [
  {
    name: 'codex',
    models: ['gpt-5.6-sol', 'gpt-5.6-med', 'shared'],
    efforts: ['low', 'medium', 'high'],
  },
  { name: 'claude', models: ['claude-opus-4-8', 'claude-fable-5', 'shared'] },
]
// A caller session (codex/sol/high, wearing persona T2) and a task carrying a
// spawn HINT (claude/opus/low). rows() merges the canonical facet over the
// session aliases, so the caller reads spawn-preferred.
let planRows = () =>
  rows({
    changes: [
      { eid: S, name: 'entity', comp: { eid: S, num: 1 } },
      {
        eid: S,
        name: 'session',
        comp: {
          id: 'caller',
          provider: 'codex',
          model: 'gpt-5.6-sol',
          effort: 'high',
          persona: T2,
        },
      },
      { eid: T1, name: 'entity', comp: { eid: T1, num: 2 } },
      { eid: T1, name: 'task', comp: { priority: 0 } },
      {
        eid: T1,
        name: 'spawn',
        comp: { provider: 'claude', model: 'claude-opus-4-8', effort: 'low' },
      },
      { eid: T2, name: 'entity', comp: { eid: T2, num: 3 } },
    ],
  })

Deno.test('spawnPlan: the caller session lends its whole spec', () => {
  assertEquals(spawnPlan(planRows(), table, { session: 'caller' }), {
    provider: 'codex',
    model: 'gpt-5.6-sol',
    effort: 'high',
    persona: T2,
  })
})

Deno.test('spawnPlan: the task hint outranks the caller', () => {
  let plan = spawnPlan(planRows(), table, { task: 'T-2', session: 'caller' })
  assertEquals(plan.provider, 'claude')
  assertEquals(plan.model, 'claude-opus-4-8')
  assertEquals(plan.effort, 'low')
  // persona rides precedence independent of provider: the hint names none, so
  // the caller's still carries.
  assertEquals(plan.persona, T2)
})

Deno.test('spawnPlan: an explicit ask outranks hint and caller', () => {
  let plan = spawnPlan(planRows(), table, {
    task: 'T-2',
    session: 'caller',
    ask: { provider: 'codex', model: 'gpt-5.6-med', effort: 'medium' },
  })
  assertEquals(plan.provider, 'codex')
  assertEquals(plan.model, 'gpt-5.6-med')
  assertEquals(plan.effort, 'medium')
})

Deno.test('spawnPlan: an explicit provider sheds a model/effort from another tier', () => {
  // Only a provider is asked; the caller's codex model/effort belong to codex,
  // never claude, so they drop and the table defaults claude's model.
  let plan = spawnPlan(planRows(), table, {
    session: 'caller',
    ask: { provider: 'claude' },
  })
  assertEquals(plan.provider, 'claude')
  assertEquals(plan.model, 'claude-opus-4-8')
  assertEquals(plan.effort, undefined)
  assertEquals(plan.persona, T2) // persona is not provider-coupled
})

Deno.test('spawnPlan: an explicit model infers its provider when unambiguous', () => {
  let plan = spawnPlan(planRows(), table, {
    session: 'caller',
    ask: { model: 'claude-opus-4-8' },
  })
  assertEquals(plan.provider, 'claude') // inferred, codex caller shed
  assertEquals(plan.model, 'claude-opus-4-8')
})

Deno.test('spawnPlan: an ambiguous model keeps the lower tier provider', () => {
  // `shared` runs on both, so no inference — the caller's codex disambiguates.
  let plan = spawnPlan(planRows(), table, {
    session: 'caller',
    ask: { model: 'shared' },
  })
  assertEquals(plan.provider, 'codex')
  assertEquals(plan.model, 'shared')
})

Deno.test('spawnPlan: nothing named falls to the provider-table default', () => {
  let plan = spawnPlan(planRows(), table, {})
  assertEquals(plan.provider, 'codex') // gpt-5.6-sol's host
  assertEquals(plan.model, 'gpt-5.6-sol')
})

Deno.test('spawnPlan: readiness routes the default around a blocked provider', () => {
  // sol is only on codex here; blocking codex forces the fallback host.
  let solo = [
    { name: 'codex', models: ['gpt-5.6-sol'] },
    { name: 'codex-cli', models: ['gpt-5.6-sol'], fallback: true },
  ]
  let plan = spawnPlan(planRows(), solo, {
    ask: { model: 'gpt-5.6-sol' },
    blocked: (name) => name == 'codex',
  })
  assertEquals(plan.model, 'gpt-5.6-sol')
  assertEquals(plan.provider, 'codex-cli')
})

Deno.test('facetsFor: capability tokens gate the canonical facets', () => {
  let facets = ['spawn', 'worktree', 'runtime', 'run', 'settled', 'yield']
  assertEquals(facetsFor(undefined), facets)
  assertEquals(facetsFor(['spawn', 'session-facets']), [
    ...facets,
  ])
  assertEquals(facetsFor(['spawn']), ['spawn'])
  assertEquals(facetsFor(['session-facets']), facets.slice(1))
  assertEquals(facetsFor([]), [])
})

Deno.test('spawnChanges: an old server gets the legacy request, no unknown component', () => {
  let now = planRows()
  let ask = { task: 'T-2', provider: 'claude', model: 'claude-opus-4-8' }
  // A capable server: session + canonical spawn frames both ride.
  let neu = spawnChanges(now, ask, ['spawn', 'session-facets'])
  assertEquals(neu.changes.filter((c) => c.name == 'spawn').length, 1)
  // An old server (no spawn capability): only the legacy session frame, and
  // the four fields still land as its dormant aliases.
  let old = spawnChanges(now, ask, [])
  assertEquals(old.changes.some((c) => c.name == 'spawn'), false)
  let session = old.changes.find((c) => c.name == 'session')!
  assertEquals(session.comp?.provider, 'claude')
  assertEquals(session.comp?.model, 'claude-opus-4-8')
  // Omitted caps stay optimistic — every facet, today's behavior.
  let dflt = spawnChanges(now, ask)
  assertEquals(dflt.changes.some((c) => c.name == 'spawn'), true)
})

Deno.test('contextDigest: claimed set with gates, or open board', () => {
  let d = contextDigest(snap, 'sess-x')
  assertEquals(d.split('\n').length <= 20, true)
  assertEquals(d.includes('T-2'), true)
  assertEquals(d.includes('  - requires → T-3 (open)'), true)
  let fresh = contextDigest(snap, 'sess-nobody')
  assertEquals(fresh.includes('nothing claimed'), true)
  assertEquals(fresh.includes('T-3'), true) // open unclaimed work suggested
  // the shared fixture carries no modified_at — nothing is recent, so the
  // lately tier says nothing at all
  assertEquals(d.includes('## lately'), false)
})

Deno.test('contextDigest: current claims lead newest first', () => {
  let current = structuredClone(snap)
  current.changes.push(
    {
      eid: T1,
      name: 'claim',
      comp: { session: S, claimed_at: '2026-07-18' },
    },
    {
      eid: T2,
      name: 'claim',
      comp: { session: S, claimed_at: '2026-07-20' },
    },
  )
  let d = contextDigest(current, 'sess-x')
  assertEquals(d.indexOf('T-3') < d.indexOf('T-2'), true)
})

Deno.test('contextDigest: a non-operator remains a normal graph participant', () => {
  let target = structuredClone(snap)
  target.changes.find((c) => c.eid == S && c.name == 'session')!.comp = {
    id: 'sess-x',
    operator: 0,
    origin: 'external',
  }
  let out = contextDigest(target, 'sess-x')
  assertEquals(out.includes('T-2'), true)
  assertEquals(out.includes('claim:'), true)
  assertEquals(out.includes('observation-only'), false)
})

// `## previously` — the successor reads its predecessor's handoff (D-19459).
// The brief is a first-class component now, shown IN FULL: no 4-line cap and
// no 96-char per-line snip, which is why briefs never worked before. It falls
// back to a managed run's final_text, and NEVER scrapes the session doc.body.
let ACT = 'aaaaaaaa-0000-4000-8000-0000000000a1'
let CUR = 'aaaaaaaa-0000-4000-8000-0000000000c1'
let PREV = 'aaaaaaaa-0000-4000-8000-0000000000d1'
// CUR (actor ACT) wakes after PREV (same actor) left the given session comp +
// extra rows; return CUR's boot digest.
let previously = (session: Record<string, unknown>, extra: Change[] = []) =>
  contextDigest({
    changes: [
      { eid: ACT, name: 'entity', comp: { eid: ACT, num: 90, created_at: '' } },
      { eid: ACT, name: 'person', comp: {} },
      { eid: CUR, name: 'entity', comp: { eid: CUR, num: 91, created_at: '' } },
      { eid: CUR, name: 'session', comp: { id: 'cur', actor: ACT } },
      {
        eid: PREV,
        name: 'entity',
        comp: { eid: PREV, num: 92, created_at: '' },
      },
      {
        eid: PREV,
        name: 'session',
        comp: { id: 'prev', actor: ACT, ...session },
      },
      ...extra,
    ],
    deps: [],
  }, 'cur')

Deno.test('## previously: a multi-line brief comp renders in full', () => {
  let long = 'A handoff line long past ninety-six characters, so the old ' +
    'per-line snip would have cut it here and dropped everything after.'
  let body = [
    'Line one of the handoff.',
    long,
    'Line three.',
    'Line four.',
    'Line five — past the old four-line cap.',
    'Line six.',
  ].join('\n')
  let d = previously({}, [{ eid: PREV, name: 'brief', comp: { text: body } }])
  assertEquals(d.includes('## previously'), true)
  assertEquals(d.includes(long), true) // full line, not snipped to 96
  assertEquals(d.includes('Line five — past the old four-line cap.'), true)
  assertEquals(d.includes('Line six.'), true) // past the old slice(0, 4)
})

Deno.test('## previously: falls back to a managed run final_text', () => {
  let d = previously({ final_text: 'Managed run summary line.' })
  assertEquals(d.includes('## previously'), true)
  assertEquals(d.includes('Managed run summary line.'), true)
})

Deno.test('## previously: the session doc.body is never scraped', () => {
  let d = previously({}, [{
    eid: PREV,
    name: 'doc',
    comp: { title: 'Prev', body: 'Narrative that is not a handoff brief.' },
  }])
  assertEquals(d.includes('## previously'), false)
  assertEquals(d.includes('Narrative that is not a handoff brief.'), false)
})

// Handoff is operator-to-operator (T-19469). Since actor == project, a builder
// spawned here shares the operator's actor; its captured brief must not shadow
// the operator's deliberate handoff just by being newer. The NEWER builder
// brief loses to the OLDER operator:true one. (The fallback — a lone
// non-operator brief still shows — is held by the tests above, whose PREV
// carries no operator.)
Deno.test('## previously: an operator brief wins over a newer builder brief', () => {
  let OP = 'aaaaaaaa-0000-4000-8000-0000000000e1'
  let BLD = 'aaaaaaaa-0000-4000-8000-0000000000f1'
  let d = contextDigest({
    changes: [
      { eid: ACT, name: 'entity', comp: { eid: ACT, num: 90, created_at: '' } },
      { eid: ACT, name: 'person', comp: {} },
      { eid: CUR, name: 'entity', comp: { eid: CUR, num: 91, created_at: '' } },
      { eid: CUR, name: 'session', comp: { id: 'cur', actor: ACT } },
      // OLDER operator session — the deliberate handoff.
      { eid: OP, name: 'entity', comp: { eid: OP, num: 92, created_at: '' } },
      { eid: OP, name: 'session', comp: { id: 'op', actor: ACT, operator: 1 } },
      { eid: OP, name: 'created', comp: { at: '2026-08-01T00:00:00Z' } },
      { eid: OP, name: 'brief', comp: { text: 'Operator handoff line.' } },
      // NEWER builder (non-operator) session with its own captured summary.
      { eid: BLD, name: 'entity', comp: { eid: BLD, num: 93, created_at: '' } },
      {
        eid: BLD,
        name: 'session',
        comp: { id: 'bld', actor: ACT, operator: 0 },
      },
      { eid: BLD, name: 'created', comp: { at: '2026-08-15T00:00:00Z' } },
      { eid: BLD, name: 'brief', comp: { text: 'Builder captured summary.' } },
    ],
    deps: [],
  }, 'cur')
  assertEquals(d.includes('## previously'), true)
  assertEquals(d.includes('Operator handoff line.'), true)
  assertEquals(d.includes('Builder captured summary.'), false)
})

// The digest's frontmatter lead (T-4554): a reified session's own meta —
// S-num first, so an agent can address its own session doc. Only what's
// known prints; an unknown sid prints nothing at all.
Deno.test('sessionMeta: the YAML lead — known fields only, or nothing', () => {
  let S2 = 'aaaaaaaa-0000-4000-8000-000000000021'
  let PN = 'aaaaaaaa-0000-4000-8000-000000000022'
  let g = rows({
    changes: [
      { eid: S2, name: 'entity', comp: { eid: S2, num: 21, created_at: '' } },
      {
        eid: S2,
        name: 'session',
        comp: {
          id: 'sess-m',
          cwd: '/w',
          provider: 'claude',
          model: 'claude-opus-4-8',
          effort: 'high',
          persona: PN,
        },
      },
      { eid: PN, name: 'entity', comp: { eid: PN, num: 22, created_at: '' } },
      { eid: PN, name: 'doc', comp: { title: 'Scribe', body: '' } },
      { eid: PN, name: 'persona', comp: {} },
    ],
  })
  assertEquals(
    sessionMeta(g, 'sess-m'),
    [
      '---',
      'session: S-21',
      'sid: sess-m',
      'provider: claude',
      'model: claude-opus-4-8',
      'effort: high',
      'cwd: /w',
      'persona: N-22 Scribe',
      '---',
    ].join('\n'),
  )
  // the shared fixture's session carries only id + cwd — no empty lines ride
  assertEquals(
    sessionMeta(all, 'sess-x'),
    '---\nsession: S-1\nsid: sess-x\ncwd: /w\n---',
  )
  assertEquals(sessionMeta(all, 'sess-nobody'), '')
})

// taskBlock renders one task the way the digest's "claimed by you" does —
// the task line plus its unresolved gates. Extracted so the subagent hook
// shares the exact renderer.
Deno.test('taskBlock: task line + unresolved gate, who holds it', () => {
  let b = taskBlock(all, snap.deps, by(T1))
  assertEquals(b[0], '- T-2 wip — First')
  assertEquals(b[1], '  - requires → T-3 (open)')
  assertEquals(b.length, 2)
})

let contextEntity = (
  eid: string,
  num: number,
  comps: Record<string, Record<string, unknown>>,
): Change[] => [
  { eid, name: 'entity', comp: { eid, num } },
  ...Object.entries(comps).map(([name, comp]) => ({ eid, name, comp })),
]

Deno.test('taskContextBlock: cycles terminate and every project root is explainable', () => {
  let P1 = 'context-p1', P2 = 'context-p2'
  let A = 'context-a', B = 'context-b', C = 'context-c', TARGET = 'context-t'
  let changes = [
    ...contextEntity(P1, 101, { doc: { title: 'One' }, project: {} }),
    ...contextEntity(P2, 102, { doc: { title: 'Two' }, project: {} }),
    ...contextEntity(A, 103, {
      doc: { title: 'A' },
      task: { project: P1 },
    }),
    ...contextEntity(B, 104, {
      doc: { title: 'B' },
      task: { project: P2 },
    }),
    ...contextEntity(C, 105, {
      doc: { title: 'C' },
      task: { project: P1 },
    }),
    ...contextEntity(TARGET, 106, {
      doc: { title: 'Target' },
      task: { status: 'wip', project: P1 },
    }),
  ]
  let deps: Dep[] = [
    { parent: P1, type: 'wants', child: A },
    { parent: A, type: 'requires', child: TARGET },
    { parent: P2, type: 'wants', child: B },
    { parent: B, type: 'delegates', child: TARGET },
    // A detached cycle hangs off a rooted ancestor; it must neither loop nor
    // replace either shortest root→task explanation.
    { parent: A, type: 'about', child: C },
    { parent: C, type: 'about', child: A },
  ]
  let all = rows({ changes })
  let target = all.find((r) => r.eid == TARGET)!
  assertEquals(taskContextBlock(all, deps, target), [
    '  - path: P-101 -wants→ T-103 -requires→ T-106; P-102 -wants→ T-104 -delegates→ T-106',
  ])
})

Deno.test('taskContextBlock: inherited rulings, memory, gates, and corrections stay scoped and bounded', () => {
  let P = 'governed-p', FOREIGN = 'governed-foreign'
  let A = 'governed-a', TARGET = 'governed-target', BLOCK = 'governed-block'
  let OLD = 'governed-old', NEW = 'governed-new', NO = 'governed-no'
  let MEMORY = 'governed-memory', LEAK = 'governed-leak'
  let changes = [
    ...contextEntity(P, 201, { doc: { title: 'Ours' }, project: {} }),
    ...contextEntity(FOREIGN, 202, { doc: { title: 'Theirs' }, project: {} }),
    ...contextEntity(A, 203, {
      doc: { title: 'Parent' },
      task: { project: P },
    }),
    ...contextEntity(TARGET, 204, {
      doc: { title: 'Target' },
      task: { status: 'wip', project: P },
    }),
    ...contextEntity(BLOCK, 205, {
      doc: { title: 'Open blocker' },
      task: { project: P },
    }),
    ...contextEntity(OLD, 206, {
      doc: { title: 'Old ruling', body: 'Use the stable door.' },
      design: {},
      decided: { at: '2026-01-01T00:00:00Z', verdict: 'approved' },
    }),
    ...contextEntity(NEW, 207, {
      doc: { title: 'Correction', body: 'Use the replacement door.' },
      design: {},
      decided: { at: '2026-03-01T00:00:00Z', verdict: 'approved' },
    }),
    ...contextEntity(NO, 208, {
      doc: { title: 'Declined shortcut', body: 'Do not bypass the graph.' },
      design: {},
      decided: { at: '2026-02-01T00:00:00Z', verdict: 'declined' },
    }),
    ...contextEntity(MEMORY, 209, {
      doc: { title: 'Scoped lesson', body: 'Keep the project boundary.' },
      memory: { scope: P },
    }),
    ...contextEntity(LEAK, 210, {
      doc: { title: 'Foreign secret', body: 'Must not cross projects.' },
      memory: { scope: FOREIGN },
    }),
  ]
  let deps: Dep[] = [
    { parent: P, type: 'wants', child: A },
    { parent: A, type: 'delegates', child: TARGET },
    { parent: A, type: 'reads', child: OLD },
    { parent: A, type: 'reads', child: NO },
    { parent: A, type: 'reads', child: MEMORY },
    { parent: A, type: 'requires', child: BLOCK },
    { parent: NEW, type: 'supersedes', child: OLD },
    { parent: FOREIGN, type: 'reads', child: LEAK },
  ]
  let all = rows({ changes })
  let target = all.find((r) => r.eid == TARGET)!
  let out = taskContextBlock(all, deps, target).join('\n')
  assertMatch(out, /path: P-201 -wants→ T-203 -delegates→ T-204/)
  assertMatch(
    out,
    /decision \[approved\] D-206 — Old ruling · Use the stable door\./,
  )
  assertMatch(
    out,
    /decision \[declined\] D-208 — Declined shortcut · Do not bypass the graph\./,
  )
  assertMatch(out, /memory M-209 — Scoped lesson · Keep the project boundary\./)
  assertMatch(out, /prerequisite T-205 \(open\) — Open blocker/)
  assertMatch(out, /correction D-207 supersedes D-206 — Correction/)
  assertEquals(out.includes('Foreign secret'), false)
  assertEquals(out.split('\n').length, 6)
})

Deno.test('taskContextGraph: reverse ancestry and correction reads are bounded and cycle-safe', async () => {
  let P = 'graph-p', A = 'graph-a', TARGET = 'graph-target'
  let OLD = 'graph-old', NEW = 'graph-new'
  let all = rows({
    changes: [
      ...contextEntity(P, 301, { project: {}, doc: { title: 'P' } }),
      ...contextEntity(A, 302, {
        task: { project: P },
        doc: { title: 'A' },
      }),
      ...contextEntity(TARGET, 303, {
        task: { project: P },
        doc: { title: 'T' },
      }),
      ...contextEntity(OLD, 304, {
        design: {},
        doc: { title: 'Old' },
        decided: { verdict: 'approved' },
      }),
      ...contextEntity(NEW, 305, {
        design: {},
        doc: { title: 'New' },
        decided: { verdict: 'approved' },
      }),
    ],
  })
  let deps: Dep[] = [
    { parent: P, type: 'wants', child: A },
    { parent: A, type: 'requires', child: TARGET },
    { parent: TARGET, type: 'about', child: A },
    { parent: A, type: 'reads', child: OLD },
    { parent: NEW, type: 'supersedes', child: OLD },
  ]
  let byEid = new Map(all.map((r) => [r.eid, r]))
  let calls = 0
  let q = (filters: string[]) => {
    let ids = (filters.find((f) => f.startsWith('id=')) ?? '').slice(3).split(
      ',',
    )
    return Promise.resolve(ids.flatMap((id) => byEid.get(id) ?? []))
  }
  let depsFn = (ids: string[]) => {
    calls++
    let set = new Set(ids)
    return Promise.resolve(
      deps.filter((d) => set.has(d.parent) || set.has(d.child)),
    )
  }
  let graph = await taskContextGraph([TARGET], all, q, depsFn)
  assertEquals(graph.deps.some((d) => d.type == 'supersedes'), true)
  assertEquals(graph.rows.some((r) => r.eid == NEW), true)
  let target = graph.rows.find((r) => r.eid == TARGET)!
  let block = taskContextBlock(graph.rows, graph.deps, target).join('\n')
  assertMatch(block, /P-301 -wants→ T-302 -requires→ T-303/)
  assertMatch(block, /decision \[approved\] D-304 — Old/)
  assertMatch(block, /correction D-305 supersedes D-304 — New/)
  assertEquals(calls < 10, true)
})

// Read state derives, never stored: arrived-and-unmarked is unread,
// outbound never counts, and the digest says the count in one line —
// scoped to mail aimed at the project, all of it when unscoped.
Deno.test('unreadMail + digest: unread counts, read/outbound stay quiet', () => {
  let M1 = 'aaaaaaaa-0000-4000-8000-000000000021' // inbound, unread
  let M2 = 'aaaaaaaa-0000-4000-8000-000000000022' // inbound, read
  let M3 = 'aaaaaaaa-0000-4000-8000-000000000023' // outbound
  let P = 'aaaaaaaa-0000-4000-8000-000000000024' // a project scope
  let M4 = 'aaaaaaaa-0000-4000-8000-000000000025' // inbound, to ME
  let A = 'aaaaaaaa-0000-4000-8000-000000000026' // the actor sess-x acts for
  let mk = (eid: string, num: number, mail: Record<string, unknown>) => [
    { eid, name: 'entity', comp: { eid, num, created_at: '' } },
    { eid, name: 'doc', comp: { title: `mail ${num}`, body: '' } },
    { eid, name: 'mail', comp: mail },
  ]
  let g: Snapshot = {
    changes: [
      ...snap.changes,
      {
        eid: S,
        name: 'session',
        comp: { id: 'sess-x', cwd: '/w', operator: 1, actor: A },
      },
      { eid: A, name: 'entity', comp: { eid: A, num: 26, created_at: '' } },
      { eid: A, name: 'doc', comp: { title: 'Operator', body: '' } },
      { eid: A, name: 'email', comp: { address: 'me@x.test' } },
      { eid: P, name: 'entity', comp: { eid: P, num: 24, created_at: '' } },
      { eid: P, name: 'doc', comp: { title: 'Venture', body: '' } },
      { eid: P, name: 'project', comp: {} },
      ...mk(M1, 21, {
        to_addr: 'v@x.test',
        message_id: 'msg:1:<a@x>',
        target: P,
      }),
      ...mk(M2, 22, {
        to_addr: 'v@x.test',
        message_id: 'msg:2:<b@x>',
        target: P,
      }),
      // read-state now rides the `opened` stamp (T-7006), not mail.read_at
      { eid: M2, name: 'opened', comp: { at: '2026-07-22T00:00:00Z' } },
      ...mk(M3, 23, {}), // outbound, born read
      // addressed to ME by address, ABOUT some other entity — the case
      // the old target-only screen dropped on the floor
      ...mk(M4, 25, {
        to_addr: 'me@x.test',
        message_id: 'msg:4:<d@x>',
        target: T2,
      }),
    ],
    deps: snap.deps,
  }
  let all = rows(g)
  let is = (eid: string) => unreadMail(all.find((r) => r.eid == eid)!)
  assertEquals(is(M1), true)
  assertEquals(is(M2), false) // read
  assertEquals(is(M3), false) // outbound is born read
  // `task mail` is a SLICE of the inbox, never a second screen: unread
  // inbound, kept only if the inbox would have shown it anyway
  let mailOnly = (scope?: string) =>
    all.filter((r) =>
      unreadMail(r) && inboxItem(readerFor(all, 'sess-x', '/w', scope))(r)
    ).map((r) => r.eid)
  assertEquals(mailOnly(P), [M1, M4])
  assertEquals(mailOnly(T2), [M4])
  assertEquals(mailOnly(), [M4]) // scopeless: only what my address holds
  // Session digests are model context, so human inbox counts stay out.
  assertEquals(
    contextDigest(g, 'sess-x', Date.now(), P).includes('## inbox'),
    false,
  )
  assertEquals(contextDigest(g, 'sess-x').includes('## inbox'), false)
  // Human previews retain the exogenous read-state count.
  assertMatch(
    contextDigest(g, undefined, Date.now(), P),
    /## inbox — 1 unread \(task inbox\)/,
  )
  // nothing addressed, nothing said
  assertEquals(contextDigest(snap, 'sess-x').includes('## inbox'), false)
})

// The inbox generalizes the mail predicates over every addressed-to-me
// source (T-7006): comment→session, comment→claimed, comment→actor,
// knock→actor, mail→project. Membership is NOT archived; unread is NOT opened. Only
// `archived` hides — the inbox is drain-proof.
Deno.test('inbox: every source, archived hides, opened marks read', () => {
  let Sx = 'aaaaaaaa-0000-4000-8000-000000000101' // my session
  let A = 'aaaaaaaa-0000-4000-8000-000000000102' //  my actor
  let P = 'aaaaaaaa-0000-4000-8000-000000000103' //  my project
  let TC = 'aaaaaaaa-0000-4000-8000-000000000104' // a task I claim
  let c1 = 'aaaaaaaa-0000-4000-8000-000000000111' // comment → session
  let c2 = 'aaaaaaaa-0000-4000-8000-000000000112' // comment → claimed task
  let kn = 'aaaaaaaa-0000-4000-8000-000000000113' // knock → actor
  let ml = 'aaaaaaaa-0000-4000-8000-000000000114' // mail → project (arrived)
  let cAc = 'aaaaaaaa-0000-4000-8000-000000000119' // comment → my actor
  let cO = 'aaaaaaaa-0000-4000-8000-000000000115' // comment aimed elsewhere
  let cA = 'aaaaaaaa-0000-4000-8000-000000000116' // to session, archived
  let cR = 'aaaaaaaa-0000-4000-8000-000000000117' // to session, opened
  let cN = 'aaaaaaaa-0000-4000-8000-000000000118' // to session, notified only
  let g = rows({
    changes: [
      { eid: Sx, name: 'entity', comp: { eid: Sx, num: 101, created_at: '' } },
      {
        eid: Sx,
        name: 'session',
        comp: { id: 'me', actor: A, cwd: '/w', operator: 1 },
      },
      { eid: P, name: 'entity', comp: { eid: P, num: 103, created_at: '' } },
      { eid: P, name: 'project', comp: {} },
      { eid: TC, name: 'entity', comp: { eid: TC, num: 104, created_at: '' } },
      { eid: TC, name: 'task', comp: {} },
      { eid: TC, name: 'claim', comp: { session: Sx } },
      { eid: c1, name: 'comment', comp: { target: Sx } },
      { eid: c2, name: 'comment', comp: { target: TC } },
      { eid: kn, name: 'knock', comp: { target: TC } },
      { eid: kn, name: 'deliver', comp: { to: A } },
      {
        eid: ml,
        name: 'mail',
        comp: { to_addr: 'm@x', message_id: 'm:1', target: P },
      },
      { eid: cAc, name: 'comment', comp: { target: A } }, // said to the venture
      { eid: cO, name: 'comment', comp: { target: P } }, // not addressed to me
      { eid: cA, name: 'comment', comp: { target: Sx } },
      { eid: cA, name: 'archived', comp: { at: 'now' } },
      { eid: cR, name: 'comment', comp: { target: Sx } },
      { eid: cR, name: 'opened', comp: { at: 'now' } },
      { eid: cN, name: 'comment', comp: { target: Sx } },
      { eid: cN, name: 'notified', comp: { at: 'now' } }, // told, not dealt with
    ],
  })
  let who = readerFor(g, 'me', '/w', P)
  assertEquals(who, {
    session: Sx,
    actor: A,
    scope: P,
    operator: true,
    claims: new Set([TC]),
    addrs: new Set([A]), // the actor's own eid; it carries no address here
    watching: new Set<string>(), // no standing instruction either way
    muting: new Set<string>(),
  })
  // all four sources arrive; a comment aimed elsewhere and an archived one
  // don't. `notified` (cN) does NOT hide — being told keeps it in the inbox.
  let inbox = g.filter(inboxItem(who)).map((r) => r.eid).sort()
  assertEquals(inbox, [c1, c2, cAc, kn, ml, cR, cN].sort())
  // unread within: the opened one counts as read; a `notified`-only item is
  // still unread (told != opened); the rest are unread
  let unread = g.filter(inboxItem(who)).filter(isUnread).map((r) => r.eid)
    .sort()
  assertEquals(unread, [c1, c2, cAc, kn, ml, cN].sort())
})

// A person reads a browser inbox with no session and no project to stand
// in. The arm that finds their letters is their ADDRESS — and the arm that
// must not fire is the project one, or an unscoped reader matches every
// arrived letter in the graph (1338 of them in a week, live).
Deno.test("readerAt: a person hears their own letters, not the fleet's", () => {
  let ME = 'bbbbbbbb-0000-4000-8000-000000000201' // a person, addressed
  let VENTURE = 'bbbbbbbb-0000-4000-8000-000000000202' // someone else's
  let mine = 'bbbbbbbb-0000-4000-8000-000000000211' // to me@x, arrived
  let byEid = 'bbbbbbbb-0000-4000-8000-000000000212' // to my EID, arrived
  let theirs = 'bbbbbbbb-0000-4000-8000-000000000213' // to the venture
  let sent = 'bbbbbbbb-0000-4000-8000-000000000214' // to me, never arrived
  let kn = 'bbbbbbbb-0000-4000-8000-000000000215' // knock at me
  let said = 'bbbbbbbb-0000-4000-8000-000000000216' // comment at me
  let g = rows({
    changes: [
      { eid: ME, name: 'entity', comp: { eid: ME, num: 201, created_at: '' } },
      { eid: ME, name: 'person', comp: {} },
      { eid: ME, name: 'email', comp: { address: 'me@x' } },
      {
        eid: VENTURE,
        name: 'entity',
        comp: { eid: VENTURE, num: 202, created_at: '' },
      },
      { eid: VENTURE, name: 'project', comp: {} },
      {
        eid: mine,
        name: 'mail',
        comp: { to_addr: 'me@x', message_id: 'm:1' },
      },
      // arrived at the reader's own eid — addrs carries it, so to_addr matches
      { eid: byEid, name: 'mail', comp: { to_addr: ME, message_id: 'm:2' } },
      {
        eid: theirs,
        name: 'mail',
        comp: { to_addr: 'v@x', message_id: 'm:3', target: VENTURE },
      },
      { eid: sent, name: 'mail', comp: { to_addr: 'me@x' } },
      { eid: kn, name: 'knock', comp: { target: VENTURE } },
      { eid: kn, name: 'deliver', comp: { to: ME } },
      { eid: said, name: 'comment', comp: { target: ME } },
    ],
  })
  let who = readerAt(g, ME)
  assertEquals(who.operator, true) // browsing your own graph IS the loop
  assertEquals(who.scope, undefined) // a person stands in no project
  let inbox = g.filter(inboxItem(who)).map((r) => r.eid).sort()
  // Sent mail never arrived, and the venture's letter is not this person's
  // — that exclusion is the whole point of the address arm.
  assertEquals(inbox, [mine, byEid, kn, said].sort())
})

// The same constructor pointed at a PROJECT: it stands in itself, so the
// scope arm is the one that speaks and project mail lands.
Deno.test('readerAt: a project reads its own project mail', () => {
  let P2 = 'bbbbbbbb-0000-4000-8000-000000000221'
  let ml = 'bbbbbbbb-0000-4000-8000-000000000222'
  let g = rows({
    changes: [
      { eid: P2, name: 'entity', comp: { eid: P2, num: 221, created_at: '' } },
      { eid: P2, name: 'project', comp: {} },
      {
        eid: ml,
        name: 'mail',
        comp: { to_addr: 'p@x', message_id: 'm:9', target: P2 },
      },
    ],
  })
  let who = readerAt(g, P2)
  assertEquals(who.scope, P2)
  assertEquals(g.filter(inboxItem(who)).map((r) => r.eid), [ml])
})

// A letter to the session itself is DIRECT address, so it lands whatever
// loop the reader runs — the rule comments and knocks already follow.
// Sessions are addressable by id (`S-31@bot.test`), and gating this on
// `operator` would resolve the address perfectly and then tell nobody.
Deno.test('addressed: a letter to my session reaches me without operator', () => {
  let S = 'bbbbbbbb-0000-4000-8000-000000000331'
  let mine = 'bbbbbbbb-0000-4000-8000-000000000332'
  let theirs = 'bbbbbbbb-0000-4000-8000-000000000333'
  let P3 = 'bbbbbbbb-0000-4000-8000-000000000334'
  let g = rows({
    changes: [
      {
        eid: mine,
        name: 'mail',
        comp: { to_addr: 'S-31@bot.test', message_id: 'm:31', target: S },
      },
      // Project mail stays operator-only — this arm is unchanged.
      {
        eid: theirs,
        name: 'mail',
        comp: { to_addr: 'p@x', message_id: 'm:32', target: P3 },
      },
    ],
  })
  let who = { session: S, scope: P3, operator: false }
  assertEquals(g.filter(inboxItem(who)).map((r) => r.eid), [mine])
  // An operator in the same seat gets both, so nothing was traded away.
  let boss = { session: S, scope: P3, operator: true }
  assertEquals(
    g.filter(inboxItem(boss)).map((r) => r.eid).sort(),
    [
      mine,
      theirs,
    ].sort(),
  )
})

// A letter still going OUT is not an arrival, whoever it names.
Deno.test('addressed: an unsent letter to my session is not in my inbox', () => {
  let S = 'bbbbbbbb-0000-4000-8000-000000000341'
  let out = 'bbbbbbbb-0000-4000-8000-000000000342'
  let g = rows({
    changes: [{ eid: out, name: 'mail', comp: { to: 'x', target: S } }],
  })
  assertEquals(g.filter(inboxItem({ session: S, operator: false })).length, 0)
})

// Project-wide attention is a positive capability. No session means a
// deliberate preview, but an unmarked session is an ordinary participant.
Deno.test('isOperator: only an explicit eligible session is an operator', () => {
  assertEquals(isOperator(undefined), true) // no session → preview
  assertEquals(isOperator({}), false)
  assertEquals(isOperator({ origin: 'external' }), false)
  assertEquals(isOperator({ origin: 'external', operator: false }), false)
  assertEquals(isOperator({ origin: 'external', operator: true }), true)
  assertEquals(isOperator({ origin: 'managed', operator: true }), false)
  assertEquals(
    isOperator({ origin: 'managed', operator: true, role: 'R' }),
    true,
  )
  assertEquals(
    isOperator({ requested_task: 'T', operator: true }),
    false,
  )
})

Deno.test('project mail reaches the operator, not a specialist; direct address always', () => {
  let Op = 'aaaaaaaa-0000-4000-8000-000000000201' // operator session
  let Sp = 'aaaaaaaa-0000-4000-8000-000000000202' // specialist (managed)
  let P = 'aaaaaaaa-0000-4000-8000-000000000203' //  the project
  let ml = 'aaaaaaaa-0000-4000-8000-000000000204' // mail → project (arrived)
  let cm = 'aaaaaaaa-0000-4000-8000-000000000205' // comment → specialist itself
  let ka = 'aaaaaaaa-0000-4000-8000-000000000206' // knock → project actor
  let kd = 'aaaaaaaa-0000-4000-8000-000000000207' // knock → specialist
  let g = rows({
    changes: [
      { eid: Op, name: 'entity', comp: { eid: Op, num: 201, created_at: '' } },
      {
        eid: Op,
        name: 'session',
        comp: { id: 'op', actor: P, cwd: '/w', operator: 1 },
      },
      { eid: Sp, name: 'entity', comp: { eid: Sp, num: 202, created_at: '' } },
      {
        eid: Sp,
        name: 'session',
        // a managed spawn: origin stamped, started on a task
        comp: {
          id: 'sp',
          actor: P,
          cwd: '/w',
          origin: 'managed',
          requested_task: 'aaaaaaaa-0000-4000-8000-000000000299',
        },
      },
      { eid: P, name: 'entity', comp: { eid: P, num: 203, created_at: '' } },
      { eid: P, name: 'project', comp: {} },
      {
        eid: ml,
        name: 'mail',
        comp: { to_addr: 'm@x', message_id: 'm:1', target: P },
      },
      { eid: cm, name: 'comment', comp: { target: Sp } }, // aimed at the specialist
      { eid: ka, name: 'knock', comp: {} },
      { eid: ka, name: 'deliver', comp: { to: P } },
      { eid: kd, name: 'knock', comp: {} },
      { eid: kd, name: 'deliver', comp: { to: Sp } },
    ],
  })
  let inbox = (id: string) =>
    g.filter(inboxItem(readerFor(g, id, '/w', P))).map((r) => r.eid).sort()
  // the operator gets the project's mail; the specialist does not
  assertEquals(inbox('op'), [ka, ml].sort())
  // the specialist still gets the comment aimed at its OWN session — direct
  // address is always delivered, only project mail is gated
  assertEquals(inbox('sp'), [cm, kd].sort())
  // the mail-only door is that same predicate sliced, so the gate holds
  // there too: the specialist sees no project mail, the operator does
  let mailOnly = (id: string) =>
    g.filter((r) => unreadMail(r) && inboxItem(readerFor(g, id, '/w', P))(r))
      .map((r) => r.eid)
  assertEquals(mailOnly('sp'), [])
  assertEquals(mailOnly('op'), [ml])
})

// A standing instruction overrides the addressed-to default, on what the
// item is ABOUT. Three branches, and the one that matters most is mute
// beating direct address — a thread the operator has declared finished.
Deno.test('watch adds, mute subtracts, absent leaves addressed() alone', () => {
  let A = 'aaaaaaaa-0000-4000-8000-000000000201' // the actor
  let Sx = 'aaaaaaaa-0000-4000-8000-000000000202' // its session
  let far = 'aaaaaaaa-0000-4000-8000-000000000203' // a task nothing aims at me
  let mine = 'aaaaaaaa-0000-4000-8000-000000000204' // a task I claim
  let cFar = 'aaaaaaaa-0000-4000-8000-000000000205'
  let cMine = 'aaaaaaaa-0000-4000-8000-000000000206'
  let cDirect = 'aaaaaaaa-0000-4000-8000-000000000207' // said to my session
  let sub = 'aaaaaaaa-0000-4000-8000-000000000208'
  let base: Change[] = [
    { eid: A, name: 'doc', comp: { title: 'Operator' } },
    { eid: A, name: 'project', comp: {} },
    { eid: Sx, name: 'session', comp: { id: 'me', operator: 1, actor: A } },
    { eid: far, name: 'task', comp: { priority: 0 } },
    { eid: mine, name: 'task', comp: { priority: 0 } },
    { eid: mine, name: 'claim', comp: { session: Sx } },
    { eid: cFar, name: 'comment', comp: { target: far } },
    { eid: cMine, name: 'comment', comp: { target: mine } },
    { eid: cDirect, name: 'comment', comp: { target: Sx } },
  ]
  let seen = (extra: Change[]) => {
    let g = rows({ changes: [...base, ...extra] })
    return g.filter(inboxItem(readerFor(g, 'me', '/w', A))).map((r) => r.eid)
      .sort()
  }
  // absent: today's rule, unchanged — the far task's comment is nobody's
  assertEquals(seen([]), [cMine, cDirect].sort())
  // watch: the far one arrives although nothing was aimed at me
  assertEquals(
    seen([{
      eid: sub,
      name: 'subscription',
      comp: { actor: A, target: far, mode: 'watch' },
    }]),
    [cFar, cMine, cDirect].sort(),
  )
  // mute: a task I CLAIM goes quiet — the instruction beats the default
  assertEquals(
    seen([{
      eid: sub,
      name: 'subscription',
      comp: { actor: A, target: mine, mode: 'mute' },
    }]),
    [cDirect],
  )
  // and mute beats DIRECT address too: my own session, silenced
  assertEquals(
    seen([{
      eid: sub,
      name: 'subscription',
      comp: { actor: A, target: Sx, mode: 'mute' },
    }]),
    [cMine],
  )
  // another actor's instruction is not mine
  assertEquals(
    seen([{
      eid: sub,
      name: 'subscription',
      comp: { actor: far, target: mine, mode: 'mute' },
    }]),
    [cMine, cDirect].sort(),
  )
})

// Saying it twice is idempotent and changing your mind is a change, not a
// second opinion — both fall out of reusing the existing row's eid.
Deno.test('subChanges: one row per (actor, target), --gone removes it', () => {
  let A = 'aaaaaaaa-0000-4000-8000-000000000301'
  let T = 'aaaaaaaa-0000-4000-8000-000000000302'
  let sub = 'aaaaaaaa-0000-4000-8000-000000000303'
  let none = rows({ changes: [] })
  let first = subChanges(none, A, T, 'watch')
  assertEquals(first.length, 1)
  assertEquals(first[0].comp, { actor: A, target: T, mode: 'watch' })
  let had = rows({
    changes: [{
      eid: sub,
      name: 'subscription',
      comp: { actor: A, target: T, mode: 'watch' },
    }],
  })
  assertEquals(subChanges(had, A, T, 'mute')[0].eid, sub) // the same row
  assertEquals(subChanges(had, A, T, null), [
    { eid: sub, name: 'entity', comp: null },
  ])
  assertEquals(subChanges(none, A, T, null), []) // nothing to undo
})

Deno.test('sessionFor: hook identity round-trips and refreshes only on change', () => {
  let self = {
    agent_type: 'reviewer',
    source: 'startup',
    operator: false,
    pane: '%42',
    turn: 'idle',
    role: 'role',
  }
  let minted = sessionFor(all, 'sess-new', '/w2', 4242, self)
  assertEquals(minted.changes[0].comp, {
    id: 'sess-new',
    cwd: '/w2',
    pid: 4242,
    agent_type: 'reviewer',
    source: 'startup',
    turn: 'idle',
    pane: '%42',
    operator: 0,
    role: 'role',
  })
  // a known session already wearing the same agent_type is silent for it;
  // only the still-absent source patches.
  let g = rows({
    changes: [
      { eid: S, name: 'entity', comp: { eid: S, num: 1, created_at: '' } },
      {
        eid: S,
        name: 'session',
        comp: {
          id: 'sess-x',
          cwd: '/w',
          agent_type: 'reviewer',
          pane: '%42',
          turn: 'idle',
          operator: false,
          role: 'role',
        },
      },
    ],
  })
  assertEquals(sessionFor(g, 'sess-x', '/w', undefined, self).changes, [
    { eid: S, name: 'session', comp: { source: 'startup' } },
  ])
  assertEquals(
    sessionFor(g, 'sess-x', '/w', undefined, { pane: null }).changes,
    [
      { eid: S, name: 'session', comp: { pane: null } },
      { eid: S, name: 'runtime', comp: { pane: null } },
    ],
  )
})

// One derivation for every caller-aware door: the repo whose path
// prefixes the cwd is the project you stand in.
Deno.test('repoAt: path prefix names the project you stand in', () => {
  let R = 'aaaaaaaa-0000-4000-8000-000000000031'
  let g = rows({
    changes: [
      { eid: R, name: 'entity', comp: { eid: R, num: 31, created_at: '' } },
      { eid: R, name: 'repo', comp: { path: '/code/app' } },
    ],
  })
  assertEquals(repoAt(g, '/code/app/deep/dir')?.eid, R)
  assertEquals(repoAt(g, '/elsewhere'), undefined)
  assertEquals(repoAt(g), undefined)
})

Deno.test('repoAt: the fleet worktree path names its main repo', () => {
  let R = 'aaaaaaaa-0000-4000-8000-000000000034'
  let g = rows({
    changes: [
      { eid: R, name: 'entity', comp: { eid: R, num: 34, created_at: '' } },
      { eid: R, name: 'repo', comp: { path: '/code/tasks' } },
    ],
  })
  assertEquals(repoAt(g, '/home/me/.tasks/worktrees/tasks/S-42')?.eid, R)
  assertEquals(repoAt(g, '/home/me/.tasks/worktrees/tasks/S-42/src')?.eid, R)
  assertEquals(repoAt(g, '/home/me/tasks-worktrees/tasks/S-42')?.eid, R)
  assertEquals(repoAt(g, '/home/me/tasks-worktrees/tasks/S-42/src')?.eid, R)
  assertEquals(repoAt(g, '/home/me/.tasks/worktrees/tasks/'), undefined)
  assertEquals(repoAt(g, '/code/tasksmith'), undefined)
})

// Nested repos: the LONGEST path prefix wins, so an inner repo claims a cwd
// under it rather than the outer one that also prefixes it.
Deno.test('repoAt: longest prefix wins for nested repos', () => {
  let out = 'aaaaaaaa-0000-4000-8000-000000000032'
  let inn = 'aaaaaaaa-0000-4000-8000-000000000033'
  let g = rows({
    changes: [
      { eid: out, name: 'entity', comp: { eid: out, num: 32, created_at: '' } },
      { eid: out, name: 'repo', comp: { path: '/code' } },
      { eid: inn, name: 'entity', comp: { eid: inn, num: 33, created_at: '' } },
      { eid: inn, name: 'repo', comp: { path: '/code/app' } },
    ],
  })
  assertEquals(repoAt(g, '/code/app/x')?.eid, inn)
  assertEquals(repoAt(g, '/code/other')?.eid, out)
})

Deno.test('repoAt: an ambiguous worktree basename stays unplaced', () => {
  let one = 'aaaaaaaa-0000-4000-8000-000000000035'
  let two = 'aaaaaaaa-0000-4000-8000-000000000036'
  let g = rows({
    changes: [
      { eid: one, name: 'entity', comp: { eid: one, num: 35, created_at: '' } },
      { eid: one, name: 'repo', comp: { path: '/code/one/app' } },
      { eid: two, name: 'entity', comp: { eid: two, num: 36, created_at: '' } },
      { eid: two, name: 'repo', comp: { path: '/code/two/app' } },
    ],
  })
  assertEquals(repoAt(g, '/home/me/.tasks/worktrees/app/S-42'), undefined)
})

// One resolution for every caller-aware door, in falling priority: an
// explicit arg, the cwd's repo (longest prefix), the worn persona's home,
// the actor when it stands for a project, else undefined.
Deno.test('scopeFor: arg > cwd-repo > persona-home > actor-project > none', () => {
  let id = (n: number) =>
    `eeeeeeee-0000-4000-8000-${String(n).padStart(12, '0')}`
  let [P, Q, R, PER, SESS] = [1, 2, 3, 4, 5].map(id)
  let g = rows({
    changes: [
      { eid: P, name: 'entity', comp: { eid: P, num: 1, created_at: '' } },
      { eid: P, name: 'project', comp: {} },
      { eid: P, name: 'repo', comp: { path: '/code/p' } },
      { eid: Q, name: 'entity', comp: { eid: Q, num: 2, created_at: '' } },
      { eid: Q, name: 'project', comp: {} }, // persona's home
      { eid: R, name: 'entity', comp: { eid: R, num: 3, created_at: '' } },
      { eid: R, name: 'project', comp: {} }, // the actor, standing for a project
      { eid: PER, name: 'entity', comp: { eid: PER, num: 4, created_at: '' } },
      { eid: PER, name: 'persona', comp: { home: Q } },
      {
        eid: SESS,
        name: 'entity',
        comp: { eid: SESS, num: 5, created_at: '' },
      },
      {
        eid: SESS,
        name: 'session',
        comp: { id: 's', persona: PER, actor: R },
      },
    ],
  })
  let sess = g.find((r) => r.eid == SESS)
  // arg wins over everything the session could resolve
  assertEquals(scopeFor(g, sess, '/code/p/deep', 'ARG'), 'ARG')
  // no arg: the cwd's repo (P), longest-prefix
  assertEquals(scopeFor(g, sess, '/code/p/deep'), P)
  // the fleet worktree layout names the same repo
  assertEquals(scopeFor(g, sess, '/home/me/.tasks/worktrees/p/S-42'), P)
  // cwd places nothing: the worn persona's home (Q)
  assertEquals(scopeFor(g, sess, '/nowhere'), Q)
  // no persona: the actor, since it IS a project (R)
  let noPer = { ...sess!, comps: { session: { id: 's', actor: R } } }
  assertEquals(scopeFor(g, noPer, '/nowhere'), R)
  // nothing places it: undefined
  let bare = { ...sess!, comps: { session: { id: 's' } } }
  assertEquals(scopeFor(g, bare, '/nowhere'), undefined)
  assertEquals(scopeFor(g, undefined, ''), undefined)
})

// The mail builders: `to` stays as typed (delivery resolves), a reply
// aims at the far side and threads by eid, Re: never piles up.
Deno.test('mailChanges/replyChanges: to as given, Re: derived, thread edge set', () => {
  let made = mailChanges({ to: 'P-20', subject: 'Hello', body: 'hi' })
  assertEquals(made.changes[0].comp, { title: 'Hello', body: 'hi' })
  // WHERE it goes is the shared deliver.to; the thread stays on mail.
  assertEquals(made.changes[1].comp, { to: 'P-20' }) // unresolved on purpose
  // No sender rides along: `from` is off the wire, stamped by the server
  // from the writing actor, so a builder cannot offer to sign the letter.
  let full = mailChanges({
    to: 'x@y.test',
    subject: 's',
    replyTo: 'some-eid',
  })
  assertEquals(full.changes[1].comp, { to: 'x@y.test' })
  assertEquals(full.changes[2].comp, { reply_to: 'some-eid' })
  assertEquals(reSubject('question'), 'Re: question')
  assertEquals(reSubject('Re: Re: question'), 'Re: question')
  assertEquals(reSubject('FWD: fw: re: question'), 'Re: question')
  let inbound = {
    eid: 'm1',
    num: 1,
    kind: 'mail',
    comps: {
      doc: { title: 'Re: asked', body: '' },
      mail: {
        to_addr: 'us@x.test',
        from: 'them@y.test',
        message_id: 'msg:1:<a>',
      },
    },
  }
  let r = replyChanges(inbound, 'answer')
  assertEquals(r.changes[1].comp?.to, 'them@y.test') // the sender → deliver.to
  assertEquals(r.changes[2].comp?.reply_to, 'm1')
  assertEquals(r.changes[0].comp?.title, 'Re: asked')
  // our own sent letter: the far side is its recipient, the shared deliver.to
  let sent = {
    eid: 'm2',
    num: 2,
    kind: 'mail',
    comps: {
      doc: { title: 'opener', body: '' },
      deliver: { to: 'them@y.test' },
    },
  }
  assertEquals(replyChanges(sent, 'more').changes[1].comp?.to, 'them@y.test')
})

// The misroute homelab reported: a letter that ARRIVED but carries no
// sender used to fall back to the address it was delivered to — our own
// inbox — so the reply looked sent and went nowhere near the writer.
Deno.test('a reply to an unsigned letter refuses, it does not guess', () => {
  let unsigned = {
    eid: 'm3',
    num: 3,
    kind: 'mail',
    comps: {
      doc: { title: 'asked', body: '' },
      mail: { to: 'us@x.test', message_id: 'local:1:m3' },
    },
  }
  assertThrows(
    () => replyChanges(unsigned, 'answer'),
    Error,
    'carries no sender',
  )
})

// The thread walk: up the reply chain and down through every answer,
// chronological by arrival/birth.
Deno.test('threadOf: both directions, in time order', () => {
  let mk = (
    eid: string,
    num: number,
    at: string,
    mail: Record<string, unknown>,
  ) => ({
    eid,
    num,
    kind: 'mail',
    comps: {
      entity: { eid, num },
      created: { eid, at },
      doc: { title: `m${num}`, body: '' },
      mail: { to: 'x@y', ...mail },
    },
  })
  let a = mk('a', 1, '2026-07-20T00:00:00Z', {})
  let b = mk('b', 2, '2026-07-21T00:00:00Z', { reply_to: 'a' })
  let c = mk('c', 3, '2026-07-22T00:00:00Z', { reply_to: 'b' })
  let lone = mk('d', 4, '2026-07-22T01:00:00Z', {})
  let g = [c, lone, a, b] // scrambled on purpose
  for (let start of ['a', 'b', 'c']) {
    assertEquals(threadOf(g, start).map((r) => r.eid), ['a', 'b', 'c'], start)
  }
  assertEquals(threadOf(g, 'd').map((r) => r.eid), ['d'])
  assertEquals(mailAt(b), '2026-07-21T00:00:00Z')
  assertEquals(
    mailAt(mk('e', 5, '2026-07-01T00:00:00Z', {
      received_at: '2026-07-19T00:00:00Z',
    })),
    '2026-07-19T00:00:00Z', // arrival outranks birth
  )
})

Deno.test('mailLine: unread dot, unverified mark, direction', () => {
  let NOW = Date.parse('2026-07-22T12:00:00Z')
  let inbound = {
    eid: 'x',
    num: 9,
    kind: 'mail',
    comps: {
      entity: { eid: 'x', num: 9, created_at: '' },
      doc: { title: 'Invoice', body: '' },
      mail: {
        to_addr: 'us@x.test',
        from: 'them@y.test',
        message_id: 'msg:1:<a>',
        received_at: '2026-07-22T10:00:00Z',
        verified: 1,
      },
    },
  }
  assertMatch(
    mailLine(inbound, NOW),
    /^E-9 {4}● them@y.test → us@x.test — Invoice \(2h\)$/,
  )
  let read = {
    ...inbound,
    comps: {
      ...inbound.comps,
      mail: { ...inbound.comps.mail, verified: 0 },
      opened: { eid: 'x', at: 'now' }, // read-state rides the stamp (T-7006)
    },
  }
  assertMatch(mailLine(read, NOW), /· !unverified them@y.test/)
  let sent = {
    eid: 'y',
    num: 10,
    kind: 'mail',
    comps: {
      entity: { eid: 'y', num: 10 },
      created: { eid: 'y', at: '2026-07-22T11:00:00Z' },
      doc: { title: 'Ping', body: '' },
      mail: { to_addr: 'venture@x.test' },
    },
  }
  assertMatch(mailLine(sent, NOW), /^E-10 {3}· → venture@x.test — Ping \(1h\)$/)
  // a stored encoded-word subject renders decoded (rfc2047_test has the table)
  let encoded = {
    ...inbound,
    comps: {
      ...inbound.comps,
      doc: { title: '=?UTF-8?Q?Re=3A_caf=C3=A9?=', body: '' },
    },
  }
  assertMatch(mailLine(encoded, NOW), /— Re: café \(2h\)$/)
})

// The project pulse against a fixed clock: tasks in the scope you stand in
// that MOVED this week, newest first — and NOTHING else. A foreign project's
// task, a mail letter, a work-session brief, a board: none are pulse
// material (the CrayonBloom bleed, pinned — the old belongs() catch-all let
// mail/session/board docs ride into every project's tier). Older than a week
// is silent too.
Deno.test('contextDigest: pulse — scoped tasks that moved, no foreign bleed', () => {
  let NOW = Date.parse('2026-07-20T12:00:00Z')
  let ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString()
  let num = 30
  let mk = (
    eid: string,
    mod: string,
    parts: Record<string, Record<string, unknown>>,
  ) => [
    { eid, name: 'entity', comp: { eid, num: num++ } },
    { eid, name: 'created', comp: { at: mod } },
    ...Object.entries(parts).map(([name, comp]) => ({ eid, name, comp })),
  ]
  let eid = (i: number) => `bbbbbbbb-0000-4000-8000-00000000000${i}`
  let P = eid(9) // the project we stand in
  let PF = eid(8) // a foreign project
  let late: Snapshot = {
    changes: [
      ...mk(P, ago(1), { doc: { title: 'Ours' }, project: {} }),
      ...mk(PF, ago(1), { doc: { title: 'Theirs' }, project: {} }),
      ...mk(eid(1), ago(2), {
        doc: { title: 'Ours moved', body: '' },
        task: { status: 'wip', priority: 0, project: P },
      }),
      // foreign-project task: must NOT bleed into our pulse
      ...mk(eid(2), ago(1), {
        doc: { title: 'Foreign task', body: '' },
        task: { status: 'wip', priority: 0, project: PF },
      }),
      // a mail letter — doc but no task comp: never pulse material
      ...mk(eid(3), ago(1), {
        doc: { title: 'A letter', body: '' },
        mail: { to: 'v@x.test', message_id: 'm:1:<a@x>' },
      }),
      // a foreign session brief: scoped by nothing, must stay out
      ...mk(eid(4), ago(1), {
        session: { id: 'ws-brief' },
        doc: { title: 'Work session', body: 'landed it' },
      }),
      // a board: a saved query, not pulse material
      ...mk(eid(5), ago(1), {
        doc: { title: 'A board' },
        board: { query: '' },
      }),
      // our project, but the touch is older than a week: silent. Claimed,
      // so the open-work suggestions skip it too — its absence is the
      // pulse's age gate alone, nothing else.
      ...mk(eid(6), ago(24 * 9), {
        doc: { title: 'Ours stale', body: '' },
        task: { status: 'wip', priority: 1, project: P },
        claim: { session: eid(7) },
      }),
    ],
    deps: [],
  }
  let d = contextDigest(late, undefined, NOW, P)
  let lines = d.split('\n')
  assertEquals(lines.length <= 48, true)
  assertEquals(d.includes('## lately'), true)
  assertEquals(d.includes('Ours moved'), true)
  // the bleed, pinned shut: no foreign task, mail, brief, or board
  assertEquals(d.includes('Foreign task'), false)
  assertEquals(d.includes('A letter'), false)
  assertEquals(d.includes('Work session'), false)
  assertEquals(d.includes('A board'), false)
  // older than a week is silent
  assertEquals(d.includes('Ours stale'), false)
})

// `## decided` orders by decided.at, NOT by heat or by when a thing was
// filed — the oldest decision here is the most recently created row, and it
// still sorts last. An entity with no stamp is absent from the section, and
// the stamp is a facet, so a task and a memory both qualify.
Deno.test('contextDigest: ## decided — by decision date, stamp-only', () => {
  let NOW = Date.parse('2026-07-20T12:00:00Z')
  let num = 60
  let eid = (i: number) => `cccccccc-0000-4000-8000-00000000000${i}`
  let P = eid(9)
  let mk = (
    e: string,
    born: string,
    parts: Record<string, Record<string, unknown>>,
  ) => [
    { eid: e, name: 'entity', comp: { eid: e, num: num++ } },
    { eid: e, name: 'created', comp: { at: born } },
    ...Object.entries(parts).map(([name, comp]) => ({ eid: e, name, comp })),
  ]
  let snap: Snapshot = {
    changes: [
      ...mk(P, '2026-07-01T00:00:00Z', { doc: { title: 'Ours' }, project: {} }),
      ...mk(eid(1), '2026-07-19T00:00:00Z', {
        doc: { title: 'Ship weekly' },
        task: { status: 'done', priority: 0, project: P },
        decided: { at: '2026-05-04T00:00:00Z' },
      }),
      ...mk(eid(2), '2026-07-02T00:00:00Z', {
        doc: { title: 'Bill quarterly' },
        memory: { type: 'project', scope: P },
        decided: { at: '2026-06-30T00:00:00Z' },
      }),
      // no stamp: absent from the section, whatever its age
      ...mk(eid(3), '2026-07-19T00:00:00Z', {
        doc: { title: 'Still arguing' },
        task: { priority: 0, project: P },
      }),
      // decided in another project: not ours
      ...mk(eid(4), '2026-07-19T00:00:00Z', {
        doc: { title: 'Their call' },
        task: { status: 'done', priority: 0, project: eid(8) },
        decided: { at: '2026-07-01T00:00:00Z' },
      }),
    ],
    deps: [],
  }
  let d = contextDigest(snap, undefined, NOW, P)
  let said = d.split('\n').filter((l) => l.startsWith('- 2026-'))
  assertEquals(said.length, 2)
  assertMatch(said[0], /^- 2026-06-30 .* Bill quarterly$/)
  assertMatch(said[1], /^- 2026-05-04 .* Ship weekly$/)
  assertEquals(d.includes('Still arguing') && d.includes('## decided'), true)
  assertEquals(said.some((l) => l.includes('Still arguing')), false)
  assertEquals(d.includes('Their call'), false)
})

// The scope test the `## decided` block and `task decided` share. Each kind
// names its project its own way, and an UNSCOPED memory belongs to every one
// of them — a fleet-wide ruling binds the project you stand in hardest, so
// scoping a door must never be what hides it.
Deno.test('belongs: a project reads each kind, and the fleet rides along', () => {
  let P = 'p', Q = 'q'
  let row = (comps: Record<string, Record<string, unknown>>): Row => ({
    eid: 'e',
    num: 1,
    kind: 'thing',
    comps,
  })
  let task = row({ task: { project: P } })
  let mine = row({ memory: { scope: P } })
  let fleet = row({ memory: {} })
  let doc = row({ doc: { title: 'a note' } })
  assertEquals([task, mine, fleet, doc].map((r) => belongs(r, P)), [
    true,
    true,
    true,
    true,
  ])
  assertEquals([task, mine, fleet, doc].map((r) => belongs(r, Q)), [
    false,
    false,
    true,
    true,
  ])
  // No scope is every scope — the `--all` view, and a cwd that places nobody.
  assertEquals([task, mine].map((r) => belongs(r)), [true, true])
  // A project entity is its own scope; a persona belongs to its home.
  assertEquals(belongs({ ...row({ project: {} }), eid: P }, P), true)
  assertEquals(belongs({ ...row({ project: {} }), eid: P }, Q), false)
  assertEquals(belongs(row({ persona: { home: Q } }), Q), true)
})

Deno.test('spec: a typed task — leading P, params anywhere, body below', () => {
  let s = spec(
    'P1 .domain=Eng Build a thing ' +
      '.proposed.at=2026-08-01T00:00:00.000Z blah blah\n' +
      'line two\nline three',
  )
  assertEquals(s.title, 'Build a thing blah blah')
  assertEquals(s.body, 'line two\nline three')
  assertEquals(s.grouped.task, { priority: 1, domain: 'Eng' })
  assertEquals(s.grouped.proposed, { at: '2026-08-01T00:00:00.000Z' })
  // P mid-title is a WORD — only a leading P is a setter
  assertEquals(spec('Fix the P2 endpoint').title, 'Fix the P2 endpoint')
  assertEquals(spec('Fix the P2 endpoint').grouped.task, undefined)
  // params still parse after words; fractional P too
  assertEquals(spec('Ship it .status=wip').grouped.task, { status: 'wip' })
  assertEquals(spec('p0.5 Urgent').grouped.task?.priority, 0.5)
  // a malformed dot-word stays a word — mid-typing is not an error
  assertEquals(spec('touch .env file').title, 'touch .env file')
  assertEquals(spec('').title, '')
})

Deno.test('spec: read is the door’s value convention, and it throws', () => {
  let f = Deno.makeTempFileSync()
  Deno.writeTextFileSync(f, 'the whole brief\n')
  // no reader: the value is what was typed
  assertEquals(spec(`Ship it .body=@${f}`).grouped.doc, { body: `@${f}` })
  assertEquals(
    spec(`Ship it .body=@${f}`, inflate).grouped.doc,
    { body: 'the whole brief\n' },
  )
  // a missing file is LOUD — never a word swallowed into the title
  assertThrows(
    () => spec('Ship it .body=@/no/such/file', inflate),
    Error,
    'no such file',
  )
  Deno.removeSync(f)
})

// ---- the memory doors' pure halves ----

Deno.test('memoryChanges: doc face + memory comp, session writer and scope', () => {
  let { changes } = memoryChanges(all, {
    title: 'Prefers terse tests',
    scope: 'T-3',
    session: 'sess-x',
  })
  assertEquals(changes.length, 2) // the session exists: nothing minted
  assertEquals(changes[0].comp?.title, 'Prefers terse tests')
  assertEquals(changes[1].name, 'memory')
  assertEquals(changes[1].comp, { scope: T2 })
  assertThrows(() =>
    memoryChanges(all, { title: 'x', scope: 'P-99', session: 'sess-x' })
  )
})

// The retired enum's one surviving value, as a facet: `feedback` names WHO
// gave it, resolved like any reference, and a bare '' still tags the memory
// — the source being unknown is not a reason to lose the fact.
Deno.test('memoryChanges: the feedback tag carries its source, or none', () => {
  let named = memoryChanges(all, {
    title: 'Prefers terse tests',
    feedback: 'T-3',
    session: 'sess-x',
  }).changes
  assertEquals(named.at(-1)?.name, 'feedback')
  assertEquals(named.at(-1)?.comp, { by: T2 })
  let bare = memoryChanges(all, {
    title: 'Somebody said this once',
    feedback: '',
    session: 'sess-x',
  }).changes
  assertEquals(bare.at(-1)?.comp, {})
  // A handle that names nothing is refused, never stored as text.
  assertThrows(() =>
    memoryChanges(all, { title: 'x', feedback: 'nobody', session: 'sess-x' })
  )
  // Untagged is the default: a memory carrying no correction wears nothing.
  let plain = memoryChanges(all, { title: 'a fact', session: 'sess-x' }).changes
  assertEquals(plain.some((c) => c.name == 'feedback'), false)
})

Deno.test('memoryChanges: an unknown session is minted alongside', () => {
  let { changes } = memoryChanges(all, { title: 'x', session: 'newcomer' })
  assertEquals(changes.length, 3)
  assertEquals(changes[0].name, 'session')
  assertEquals(changes[2].comp, { scope: null })
})

// ---- the goal door's pure half ----

Deno.test('goalChanges: a doc and the tag, fleet-wide when unscoped', () => {
  let { changes } = goalChanges(all, {
    title: 'Reduce noise, amplify signal',
    session: 'sess-x',
  })
  assertEquals(changes.length, 2) // the session exists: nothing minted
  assertEquals(changes[0].comp, {
    title: 'Reduce noise, amplify signal',
    body: '',
  })
  assertEquals(changes[1].name, 'goal')
  assertEquals(changes[1].comp, { scope: null })
  // Guidance, not work: no status, no proposed mark, nothing to decide.
  assertEquals(changes.some((c) => c.name == 'task'), false)
  assertEquals(changes.some((c) => c.name == 'proposed'), false)
})

Deno.test('goalChanges: scope resolves to the project it guides', () => {
  let { changes } = goalChanges(all, {
    title: 'A useful TUI',
    body: 'why',
    session: 'sess-x',
    scope: 'T-3',
  })
  assertEquals(changes.at(-1)?.comp, { scope: T2 })
  assertEquals(changes[0].comp?.body, 'why')
  assertThrows(
    () => goalChanges(all, { title: 'x', session: 'sess-x', scope: 'P-999' }),
    Error,
    'no entity: P-999',
  )
})

// ---- the design door's pure half ----

Deno.test('designChanges: a doc, the tag, and the proposed mark', () => {
  let { changes } = designChanges(all, {
    title: 'Mail is local-first for fleet recipients',
    body: 'The sent entity gains its arrival stamp in-graph.',
    session: 'sess-x',
  })
  assertEquals(changes.length, 3) // the session exists: nothing minted
  assertEquals(
    changes[0].comp?.title,
    'Mail is local-first for fleet recipients',
  )
  assertEquals(changes[1].name, 'design')
  assertEquals(changes[1].comp, {}) // a tag says only its name
  assertEquals(changes[2].name, 'proposed')
  assertEquals(changes[2].comp, {}) // bare: the column dates it now
  // No decided mark — proposing is not deciding, and the spawn gate reads
  // exactly that difference.
  assertEquals(changes.some((c) => c.name == 'decided'), false)
})

// A design carried in from a file was written before the row existed, and
// created.at is server-stamped, so the day it was written has nowhere else
// to live. The phrase rides the wire; apply() resolves it once.
Deno.test('designChanges: `at` says when it was written', () => {
  let { changes } = designChanges(all, {
    title: 'Boot partition',
    at: '2026-07-23',
    session: 'sess-x',
  })
  assertEquals(changes.at(-1)?.comp, { at: '2026-07-23' })
  assertEquals(changes[0].comp?.body, '') // a design may be all title
})

Deno.test('designChanges: an unknown session is minted alongside', () => {
  let { changes } = designChanges(all, { title: 'x', session: 'newcomer' })
  assertEquals(changes.length, 4)
  assertEquals(changes[0].name, 'session')
})

// The standard property grammar rides onto the design: `.project`/`.priority`
// group under `task` (patches()) and land as one more component beside the
// tag — the design outranks task in kindOrder, so it stays a design (M-15635).
Deno.test('designChanges: routed props ride onto the entity', () => {
  let { eid, changes } = designChanges(all, {
    title: 'Local-first mail',
    session: 'sess-x',
    props: { task: { project: 'proj-eid', priority: 2 }, doc: { body: 'why' } },
  })
  let doc = changes.find((c) => c.name == 'doc')
  assertEquals(doc?.comp, { title: 'Local-first mail', body: 'why' })
  let task = changes.find((c) => c.name == 'task')
  assertEquals(task, {
    eid,
    name: 'task',
    comp: { project: 'proj-eid', priority: 2 },
  })
  // Tag and mark still stand, and nothing became a decided design.
  assertEquals(changes.some((c) => c.name == 'design'), true)
  assertEquals(changes.some((c) => c.name == 'proposed'), true)
})

Deno.test('recallIndex: warmest first, index lines only, filtered', () => {
  let M1 = 'aaaaaaaa-0000-4000-8000-000000000011'
  let M2 = 'aaaaaaaa-0000-4000-8000-000000000012'
  let NOW = Date.parse('2026-07-20T12:00:00Z')
  let D = 86_400_000
  let at = (ago: number) => new Date(NOW - ago).toISOString()
  let mems = rows({
    changes: [
      { eid: M1, name: 'entity', comp: { eid: M1, num: 11, created_at: '' } },
      { eid: M1, name: 'doc', comp: { title: 'cold fact', body: 'long ago' } },
      { eid: M1, name: 'memory', comp: { scope: null } },
      {
        eid: M1,
        name: 'recall',
        comp: { count: 1, first_at: at(60 * D), last_at: at(60 * D) },
      },
      { eid: M2, name: 'entity', comp: { eid: M2, num: 12, created_at: '' } },
      { eid: M2, name: 'doc', comp: { title: 'warm fact', body: 'today' } },
      {
        eid: M2,
        name: 'memory',
        comp: { last_confirmed_at: at(D) },
      },
      { eid: M2, name: 'feedback', comp: {} },
      {
        eid: M2,
        name: 'recall',
        comp: { count: 5, first_at: at(30 * D), last_at: at(2 * 3_600_000) },
      },
    ],
  })
  let lines = recallIndex(mems, [], NOW)
  assertEquals(lines.length, 2)
  assertMatch(lines[0], /^M-12 /) // the warm one leads
  assertMatch(lines[0], /warm fact/)
  assertMatch(lines[0], /5×/)
  assertMatch(lines[0], /confirmed 2026-07-19/)
  assertEquals(lines[0].includes('today'), false) // bodies stay home
  // The tag is what the head says now — the retired enum's other values
  // said only what the line already carried.
  assertMatch(lines[0], /M-12 [\d.]+ feedback: warm fact/)
  assertMatch(lines[1], /M-11 [\d.]+ cold fact/)
  assertEquals(recallIndex(mems, parseQuery('.title~=cold'), NOW).length, 1)
})

Deno.test('derefParams: reference values resolve at the door', () => {
  let one = (s: string) => derefParams(all, [param(s)!])[0].value
  assertEquals(one('.assignee=old-board-slug'), T2) // alias slug
  assertEquals(one('.assignee=T-2'), T1) // human id
  assertEquals(one('.assignee=3'), T2) // bare num
  assertEquals(one(`.assignee=${T1}`), T1) // an eid passes through
  assertEquals(one('.assignee='), null) // an optional scalar clear is null
  assertEquals(one('.title=jeff'), 'jeff') // not a reference
  assertThrows(
    () => one('.assignee=ghost'),
    Error,
    'assignee is a human id / alias / UUID',
  )
})

Deno.test('derefParams: project references accept P-nums and eids', () => {
  let p = 'aaaaaaaa-0000-4000-8000-000000000004'
  let graph = rows({
    changes: [
      ...snap.changes,
      { eid: p, name: 'entity', comp: { eid: p, num: 4 } },
      { eid: p, name: 'project', comp: {} },
    ],
  })
  let one = (s: string) => derefParams(graph, [param(s)!])[0].value
  assertEquals(one('.project=P-4'), p)
  assertEquals(one(`.project=${p}`), p)
})

// `(no matches)` for a handle that names nothing reads as "that project
// has no tasks", not "there is no such project" — the quiet half of the
// same typo the write door already teaches.
Deno.test('checkRefs: an unresolvable handle in a filter is a typo, not an empty list', () => {
  let p = 'aaaaaaaa-0000-4000-8000-000000000004'
  let graph = rows({
    changes: [
      ...snap.changes,
      { eid: p, name: 'entity', comp: { eid: p, num: 30 } },
      { eid: p, name: 'doc', comp: { title: 'bindery', body: '' } },
      { eid: p, name: 'alias', comp: { slug: 'bindery' } },
      { eid: p, name: 'project', comp: {} },
    ],
  })
  let ask = (q: string) =>
    checkRefs(graph, resolveRefs(parseQuery(q), (id) => find(graph, id)?.eid))
  assertThrows(
    () => ask('.project=bindry'),
    Error,
    "no entity: bindry (.project) — did you mean 'bindery' (P-30, bindery)?",
  )
  assertThrows(() => ask('.project=zzzznope'), Error, 'no entity: zzzznope')
  // lists check every part; != is the same claim about the same handle
  assertThrows(() => ask('.project=bindery,zzzznope'), Error, 'zzzznope')
  assertThrows(() => ask('.project!=zzzznope'), Error, 'zzzznope')
  // and everything that does NOT name an entity passes through untouched
  ask('.project=bindery') // resolves
  ask('.project=') // empty IS absent, the documented spelling
  ask('.project~=bind') // contains is literal
  ask('.priority<=1') // not a reference at all
  ask('.title~=zzzznope')
  ask('.updated.at=today')
  ask('.num=1..9')
})

// A board is a saved query: the project it names may be renamed or
// deleted long after, and a board that throws is worse than one that
// returns nothing. Stored evaluation never calls checkRefs — the forgiving
// reading stays where the query is stored, the strict one where it is typed.
Deno.test('resolveRefs stays total for a handle that is gone', () => {
  let preds = resolveRefs(parseQuery('.project=vanished'), () => undefined)
  assertEquals(preds[0].value, 'vanished') // as typed, matching nothing
  assertEquals(matchQuery({ task: { project: 'x' } }, preds), false)
})

// The failure fires exactly when someone reasons from the fleet id: the
// project called `tasks` answers to `home`. Naming the near match is safe
// only because it is checked to RESOLVE before it is offered.
Deno.test('derefParams: a failed project names the alias that would work', () => {
  let p = 'aaaaaaaa-0000-4000-8000-000000000004'
  let q = 'aaaaaaaa-0000-4000-8000-000000000005'
  let graph = rows({
    changes: [
      ...snap.changes,
      { eid: p, name: 'entity', comp: { eid: p, num: 19 } },
      { eid: p, name: 'doc', comp: { title: 'Task Graph', body: '' } },
      { eid: p, name: 'alias', comp: { slug: 'home' } },
      { eid: p, name: 'project', comp: {} },
      { eid: q, name: 'entity', comp: { eid: q, num: 20 } },
      { eid: q, name: 'doc', comp: { title: 'holdco', body: '' } },
      { eid: q, name: 'alias', comp: { slug: 'holdco' } },
      { eid: q, name: 'project', comp: {} },
    ],
  })
  let one = (s: string) => derefParams(graph, [param(s)!])[0].value
  assertEquals(one('.project=home'), p) // the handle that works
  assertThrows(
    () => one('.project=tasks'),
    Error,
    "no project 'tasks' — did you mean 'home' (P-19, Task Graph)?",
  )
  assertThrows(
    () => one('.project=holdc'),
    Error,
    "did you mean 'holdco' (P-20, holdco)?",
  )
  // Nothing close: the grammar line, plainly — never a guess that routes
  // nowhere, because the caller is already confused when they read it.
  assertThrows(
    () => one('.project=flux'),
    Error,
    "project is a human id / alias / UUID — got 'flux'",
  )
  // Two things keep a task out of the answer. The declared target narrows
  // `.project=` to projects; and a task's TITLE is a sentence about work,
  // never a handle, so even the untargeted `.assignee=` stays silent.
  assertThrows(() => one('.project=Frist'), Error, 'a human id / alias / UUID')
  assertThrows(() => one('.assignee=Frist'), Error, 'a human id / alias / UUID')
  // Its ALIAS is a handle whatever wears it, so that still answers.
  assertThrows(
    () => one('.assignee=old-board-slig'),
    Error,
    "did you mean 'old-board-slug' (T-3, Second)?",
  )
})

Deno.test('edgesOf: both directions, ids humanized', () => {
  let all = rows(snap)
  let out = edgesOf(snap, all, T1)
  assertEquals(out.refs, [{ type: 'requires', child: 'T-3' }])
  assertEquals(out.backrefs, [])
  let back = edgesOf(snap, all, T2)
  assertEquals(back.refs, [])
  assertEquals(back.backrefs, [{ type: 'requires', parent: 'T-2' }])
})

Deno.test('showMd: frontmatter, edge sentences, claim holder, body', () => {
  let row = by(T1)
  let typed = {
    ...row,
    comps: { ...row.comps, mail: { verified: 1 } },
  }
  let md = showMd(snap, all, typed)
  assertMatch(md, /^---\nid: T-2\nkind: task\n/)
  // the spine renders as a comp: raw eid + num under entity:
  assertMatch(md, new RegExp(`entity:\n {2}eid: ${T1}\n {2}num: `))
  // comps serialize nested — status is DERIVED, not a stored task column, so
  // the frontmatter carries only real columns; wip shows through the claim below
  assertMatch(md, /task:\n {2}priority: P0/)
  assertEquals(md.includes('task.status:'), false)
  assertEquals(md.includes('status: wip'), false)
  assertMatch(md, /mail:\n {2}verified: true/)
  assertMatch(md, /claim: sess-x/) // the holder's session id, not an eid
  assertMatch(md, /requires:\n {2}- T-3 \(open\) — Second/)
  assertMatch(md, /# First/)
  // the entity block is the ONE place a uuid reaches the reader
  assertEquals(md.split('aaaaaaaa').length, 2)
  assertEquals(JSON.parse(JSON.stringify(typed)).comps.mail.verified, 1)
  let back = showMd(snap, all, by(T2))
  assertMatch(back, /referenced by:\n {2}- T-2 \(wip\) — First · requires this/)
})

Deno.test('showMd exposes acceptance criteria as their own facet', () => {
  let eid = 'bbbbbbbb-0000-4000-8000-000000000001'
  let graph: Snapshot = {
    changes: [
      { eid, name: 'entity', comp: { eid, num: 41 } },
      { eid, name: 'doc', comp: { title: 'Ship it', body: 'Build notes' } },
      { eid, name: 'task', comp: {} },
      { eid, name: 'accept', comp: { body: '- exits zero' } },
    ],
    deps: [],
  }
  let all = rows(graph)
  let md = showMd(graph, all, all[0])
  assertMatch(md, /accept:\n {2}body: - exits zero/)
  assertMatch(md, /# Ship it\n\nBuild notes/)
})

Deno.test('provenance exposes actors, model settings, persona, and decisions', () => {
  let actor = crypto.randomUUID(), session = crypto.randomUUID()
  let persona = crypto.randomUUID(), task = crypto.randomUUID()
  let graph: Snapshot = {
    changes: [
      { eid: actor, name: 'entity', comp: { eid: actor, num: 30 } },
      { eid: actor, name: 'doc', comp: { title: 'Jeff' } },
      { eid: actor, name: 'person', comp: {} },
      { eid: persona, name: 'entity', comp: { eid: persona, num: 31 } },
      { eid: persona, name: 'doc', comp: { title: 'Scribe' } },
      { eid: persona, name: 'persona', comp: {} },
      { eid: session, name: 'entity', comp: { eid: session, num: 32 } },
      { eid: session, name: 'session', comp: { id: 'agent-run' } },
      {
        eid: session,
        name: 'spawn',
        comp: {
          provider: 'claude',
          model: 'haiku',
          effort: 'low',
          persona,
        },
      },
      { eid: task, name: 'entity', comp: { eid: task, num: 33 } },
      { eid: task, name: 'doc', comp: { title: 'An agent idea' } },
      { eid: task, name: 'task', comp: {} },
      {
        eid: task,
        name: 'created',
        comp: { at: '2026-08-01', by: actor, via: session },
      },
      {
        eid: task,
        name: 'updated',
        comp: { at: '2026-08-04', by: actor, via: session },
      },
      {
        eid: task,
        name: 'proposed',
        comp: { at: '2026-08-02', by: actor, via: session },
      },
      {
        eid: task,
        name: 'decided',
        comp: { at: '2026-08-03', by: actor },
      },
    ],
    deps: [],
  }
  let all = rows(graph), row = all.find((r) => r.eid == task)!
  let authored = jsonAuthored(all, row)
  assertEquals(authored.created, {
    at: '2026-08-01',
    by: actor,
    via: {
      id: 'S-32',
      kind: 'session',
      provider: 'claude',
      model: 'haiku',
      effort: 'low',
      persona: { id: 'N-31', kind: 'persona', title: 'Scribe' },
    },
  })
  assertEquals(authored.proposed, {
    at: '2026-08-02',
    by: actor,
    via: {
      id: 'S-32',
      kind: 'session',
      provider: 'claude',
      model: 'haiku',
      effort: 'low',
      persona: { id: 'N-31', kind: 'persona', title: 'Scribe' },
    },
  })
  assertEquals(authored.decided, { at: '2026-08-03', by: actor })
  let shown = showMd(graph, all, row)
  assertMatch(shown, /created:\n/)
  assertMatch(shown, / {2}at: 2026-08-01T00:00:00-04:00/)
  assertMatch(shown, / {2}by: U-30 — Jeff/)
  assertMatch(
    shown,
    / {2}via: S-32 — agent-run \(claude\/haiku\/low, persona N-31 Scribe\)/,
  )
  assertEquals(shown.includes('created.by:'), false)
  assertMatch(shown, /updated:\n/)
  assertEquals(shown.includes('updated.at:'), false)
  assertEquals(shown.includes('modified:'), false)
  assertMatch(taskBlock(all, [], row)[0], /created by U-30 Jeff via S-32/)
})

Deno.test('showMd: memories name their scope and persona memberships', () => {
  let P = 'aaaaaaaa-0000-4000-8000-000000000020'
  let N = 'aaaaaaaa-0000-4000-8000-000000000021'
  let M1 = 'aaaaaaaa-0000-4000-8000-000000000022'
  let M2 = 'aaaaaaaa-0000-4000-8000-000000000023'
  let graph: Snapshot = {
    changes: [
      { eid: P, name: 'entity', comp: { eid: P, num: 20 } },
      { eid: P, name: 'doc', comp: { title: 'Atlas' } },
      { eid: P, name: 'project', comp: {} },
      { eid: N, name: 'entity', comp: { eid: N, num: 21 } },
      { eid: N, name: 'doc', comp: { title: 'Operator' } },
      { eid: N, name: 'persona', comp: { home: P } },
      { eid: M1, name: 'entity', comp: { eid: M1, num: 22 } },
      {
        eid: M1,
        name: 'memory',
        comp: { type: 'feedback', scope: null },
      },
      { eid: M2, name: 'entity', comp: { eid: M2, num: 23 } },
      {
        eid: M2,
        name: 'memory',
        comp: { type: 'project', scope: P },
      },
    ],
    deps: [
      { parent: N, type: 'contains', child: M1 },
      { parent: N, type: 'reads', child: M2 },
    ],
  }
  let people = rows(graph)
  let show = (eid: string) =>
    showMd(graph, people, people.find((r) => r.eid == eid)!)
  assertMatch(
    show(M1),
    /scope: shared[\s\S]*N-21 — Operator · contains this/,
  )
  assertMatch(
    show(M2),
    /scope: P-20 — Atlas[\s\S]*N-21 — Operator · reads this/,
  )
})

Deno.test('showMd: comments ride as a section, oldest first', () => {
  let C = 'aaaaaaaa-0000-4000-8000-000000000009'
  let snap2: Snapshot = {
    changes: [
      ...snap.changes,
      { eid: C, name: 'entity', comp: { eid: C, num: 9 } },
      { eid: C, name: 'created', comp: { at: '2t', via: S } },
      { eid: C, name: 'doc', comp: { title: '', body: 'a remark' } },
      { eid: C, name: 'comment', comp: { target: T1 } },
      { eid: C, name: 'review', comp: { verdict: 'changes_requested' } },
    ],
    deps: snap.deps,
  }
  let all2 = rows(snap2)
  let md = showMd(snap2, all2, all2.find((r) => r.eid == T1)!)
  assertMatch(
    md,
    /## Comments\n\n— 2t · S-1 — sess-x · changes requested\n\na remark/,
  )
})

Deno.test('grammar: the teaching text derives from the vocabulary', async () => {
  let { GRAMMAR, FILTERS } = await import('./grammar.ts')
  // status is DERIVED now (D-24102), no longer a writable task enum column, so
  // the vocabulary teaches it as a sentence rather than an inline enum.
  assertMatch(GRAMMAR, /Statuses: open, wip, done, cancelled/)
  assertMatch(
    GRAMMAR,
    /review: verdict\(approved\|rejected\|changes_requested\|approve\|reject\|changes\)/,
  )
  assertMatch(GRAMMAR, /typed scalars parse by their grammar/)
  assertMatch(GRAMMAR, /\.verifier=true.*\.verifier=false/)
  assertMatch(FILTERS, /time phrases/i)
})

// A day's journal slice, oldest events last (the server serves newest
// first): mint a task, claim it, comment on it, link it, finish it.
let DAY: import('./client.ts').JournalEntry[] = [
  {
    id: 4,
    ts: '2026-07-20T18:00:00Z',
    actor: 'sess-x',
    changes: [
      { eid: T1, name: 'completed', comp: {} },
      {
        eid: 'c-1',
        name: 'doc',
        comp: { title: '', body: 'status: wip → done — verified\nmore' },
      },
      { eid: 'c-1', name: 'comment', comp: { target: T1 } },
      { eid: 'c-1', name: 'entity', comp: { num: 9, created_at: '' } },
    ],
  },
  {
    id: 3,
    ts: '2026-07-20T12:00:00Z',
    actor: 'sess-x',
    changes: [
      ...link(T1, 'requires', T2),
    ],
  },
  {
    id: 2,
    ts: '2026-07-20T10:00:00Z',
    actor: 'sess-x',
    changes: [{ eid: T1, name: 'claim', comp: { session: S } }],
  },
  {
    id: 1,
    ts: '2026-07-20T09:00:00Z',
    actor: 'sess-x',
    changes: [
      { eid: T1, name: 'doc', comp: { title: 'First', body: '' } },
      { eid: T1, name: 'task', comp: {} },
      { eid: T1, name: 'entity', comp: { num: 2, created_at: '' } },
    ],
  },
]

Deno.test('ledger: the day as lived, oldest first, ids humanized', () => {
  let lines = ledger(DAY, all)
  // The span reads in local wall-clock, like every displayed stamp — built
  // through the same door so the assertion holds in any zone.
  assertEquals(
    lines[0],
    `${local('2026-07-20T09:00:00Z')} → ${
      local('2026-07-20T18:00:00Z')
    } · 4 batch(es)`,
  )
  let text = lines.join('\n')
  assertMatch(text, /\+ minted task T-2 First/)
  assertMatch(text, /⚑ claimed T-2 First/)
  assertMatch(text, /∴ linked T-2 First requires T-3 Second/)
  assertMatch(text, /→ T-2 First done/)
  assertMatch(text, /💬 on T-2 First: status: wip → done — verified/) // first line only
  // order: mint before claim before link before finish
  let at = (re: RegExp) => lines.findIndex((l) => re.test(l))
  assertEquals(at(/minted/) < at(/claimed/), true)
  assertEquals(at(/claimed/) < at(/linked/), true)
  assertEquals(ledger([], all), [])
})

Deno.test('wrap: the stub carries the ledger; a hand-written brief is never clobbered', () => {
  let AT = Date.UTC(2026, 6, 20)
  let doc = wrapChanges(all, 'sess-x', AT, DAY)
    .find((c) => c.name == 'doc' && c.eid == S)
  let body = String(doc?.comp?.body)
  assertMatch(body, /^Auto-written at wrap/)
  assertMatch(body, /## Ledger/)
  assertMatch(body, /⚑ claimed T-2/)
  assertMatch(body, /## Ended holding/)
  // an existing STUB refreshes (keeps its title), a prose brief stays
  let stubbed = structuredClone(snap)
  stubbed.changes.push({
    eid: S,
    name: 'doc',
    comp: {
      title: 'Work session 2026-07-19',
      body: 'Auto-written at wrap — old stub',
    },
  })
  let re = wrapChanges(rows(stubbed), 'sess-x', AT, DAY)
    .find((c) => c.name == 'doc' && c.eid == S)
  assertEquals(re?.comp?.title, 'Work session 2026-07-19')
  assertMatch(String(re?.comp?.body), /## Ledger/)
  let prose = structuredClone(snap)
  prose.changes.push({
    eid: S,
    name: 'doc',
    comp: { title: 'My day', body: 'I did things, thoughtfully.' },
  })
  assertEquals(
    wrapChanges(rows(prose), 'sess-x', AT, DAY)
      .some((c) => c.name == 'doc' && c.eid == S),
    false,
  )
})

Deno.test('notices: bylines read actor and instrument from the stamp', () => {
  let B = 'aaaaaaaa-0000-4000-8000-000000000010'
  let P = 'aaaaaaaa-0000-4000-8000-000000000011' // the operator project
  let mk = (eid: string, actor: string, via: string) => [
    { eid, name: 'entity', comp: { eid, num: 91 } },
    { eid, name: 'created', comp: { at: '2026-01-02', by: actor, via } },
    { eid, name: 'doc', comp: { title: '', body: 'from the operator' } },
    { eid, name: 'comment', comp: { target: T1 } },
  ]
  let s: Snapshot = {
    changes: [
      ...snap.changes,
      { eid: P, name: 'entity', comp: { eid: P, num: 81, created_at: '' } },
      { eid: P, name: 'doc', comp: { title: 'Task Graph', body: '' } },
      { eid: P, name: 'project', comp: {} },
      { eid: B, name: 'entity', comp: { eid: B, num: 82, created_at: '' } },
      { eid: B, name: 'session', comp: { id: 'sess-b', actor: P } },
      ...mk('c-9', P, B),
    ],
    deps: snap.deps,
  }
  let [line] = noticesFor(s, 'sess-x').lines
  assertMatch(line, /P-81 · via S-82/) // operator, not session id
})

Deno.test('contextDigest: sessionless is the preview — headed as one, claim line templated', () => {
  let d = contextDigest(snap)
  assertEquals(d.startsWith('# tasks · a preview'), true)
  assertEquals(d.includes('task claim <id> <session>'), true)
  assertEquals(d.includes('nothing claimed'), true)
})

// The project-aware digest: scope narrows suggestions and the pulse to the
// project you stand in; the fleet-memory front page is UNSCOPED principles
// only (a project's own scoped lessons live behind memory_recall now), and
// your claims always ride.
Deno.test('contextDigest: scope — local work, principle memory, cwd derives', () => {
  let NOW = Date.parse('2026-07-20T12:00:00Z')
  let hour = new Date(NOW - 3_600_000).toISOString()
  let id = (n: number) =>
    `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, '0')}`
  let [PA, PB, TA, TB, MA, MB, MF, SC] = [1, 2, 3, 4, 5, 6, 7, 8].map(id)
  let mk = (
    eid: string,
    num: number,
    parts: Record<string, Record<string, unknown>>,
  ) => [
    { eid, name: 'entity', comp: { eid, num } },
    { eid, name: 'created', comp: { at: hour } },
    ...Object.entries(parts).map(([name, comp]) => ({ eid, name, comp })),
  ]
  let g: Snapshot = {
    changes: [
      ...mk(PA, 1, {
        doc: { title: 'Alpha' },
        project: {},
        repo: { path: '/repo/a' },
      }),
      ...mk(PB, 2, {
        doc: { title: 'Beta' },
        project: {},
        repo: { path: '/repo/b' },
      }),
      ...mk(TA, 3, {
        doc: { title: 'A work' },
        task: { priority: 1, project: PA },
      }),
      ...mk(TB, 4, {
        doc: { title: 'B work' },
        task: { priority: 1, project: PB },
      }),
      ...mk(MA, 5, {
        doc: { title: 'A lesson' },
        memory: { type: 'project', scope: PA },
      }),
      ...mk(MB, 6, {
        doc: { title: 'B lesson' },
        memory: { type: 'project', scope: PB },
      }),
      ...mk(MF, 7, {
        doc: { title: 'A principle' },
        memory: { type: 'feedback' },
      }),
      ...mk(SC, 8, { session: { id: 'sess-in-a', cwd: '/repo/a/deep' } }),
    ],
    deps: [],
  }
  // explicit scope: Alpha's digest names itself, suggests only its work
  let d = contextDigest(g, undefined, NOW, PA)
  assertEquals(d.includes('· P-1 Alpha'), true)
  assertEquals(d.includes('open work here'), true)
  assertEquals(d.includes('A work'), true)
  assertEquals(d.includes('B work'), false)
  assertEquals(d.includes('A principle'), true) // unscoped memory rides
  assertEquals(d.includes('A lesson'), false) // a scoped lesson no longer does
  assertEquals(d.includes('B lesson'), false)
  // a session's own cwd derives the same scope
  let s = contextDigest(g, 'sess-in-a', NOW)
  assertEquals(s.includes('· P-1 Alpha'), true)
  assertEquals(s.includes('B work'), false)
  // no scope: the fleet view, both works suggested
  let f = contextDigest(g, undefined, NOW)
  assertEquals(f.includes('A work') && f.includes('B work'), true)
})

// The lines of one section: its heading and the bullet rows under it. Lets
// the parity test compare a project-layer tier across two digests without
// the session-layer noise (or the trailing claim boilerplate) between them.
let section = (d: string, head: string) => {
  let ls = d.split('\n')
  let i = ls.findIndex((l) => l.startsWith(head))
  if (i < 0) return []
  let out = [ls[i]]
  for (let j = i + 1; j < ls.length && ls[j].startsWith('- '); j++) {
    out.push(ls[j])
  }
  return out
}

// The fleet-memory front page: only UNSCOPED memories (a scoped lesson
// lives behind memory_recall), warmest first. Recognition only — the
// digest is a pure string, so listing a memory never bumps its recall
// (two identical calls, no state touched).
Deno.test('contextDigest: from the fleet — unscoped only, warmth order, no bump', () => {
  let NOW = Date.parse('2026-07-20T12:00:00Z')
  let ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString()
  let id = (n: number) =>
    `ffffffff-0000-4000-8000-${String(n).padStart(12, '0')}`
  let [P, MW, MC, MS] = [1, 2, 3, 4].map(id)
  let mk = (
    eid: string,
    num: number,
    at: string,
    parts: Record<string, Record<string, unknown>>,
  ) => [
    { eid, name: 'entity', comp: { eid, num } },
    { eid, name: 'created', comp: { at } },
    ...Object.entries(parts).map(([name, comp]) => ({ eid, name, comp })),
  ]
  let g: Snapshot = {
    changes: [
      ...mk(P, 1, ago(1), { doc: { title: 'Proj' }, project: {} }),
      ...mk(MW, 2, ago(1), { // warm: touched an hour ago
        doc: { title: 'Warm principle' },
        memory: { type: 'feedback' },
      }),
      ...mk(MC, 3, ago(100), { // cool: touched days ago
        doc: { title: 'Cool principle' },
        memory: { type: 'feedback' },
      }),
      ...mk(MS, 4, ago(1), { // scoped: never on the front page
        doc: { title: 'Scoped lesson' },
        memory: { type: 'project', scope: P },
      }),
    ],
    deps: [],
  }
  let d = contextDigest(g, undefined, NOW, P)
  let fleet = section(d, '## from the fleet').join('\n')
  assertEquals(fleet.includes('Warm principle'), true)
  assertEquals(fleet.includes('Cool principle'), true)
  assertEquals(fleet.includes('Scoped lesson'), false) // scoped stays off
  // warmest first
  assertEquals(
    fleet.indexOf('Warm principle') < fleet.indexOf('Cool principle'),
    true,
  )
  // recognition only: a pure string, no side effect — identical twice
  assertEquals(contextDigest(g, undefined, NOW, P), d)
})

// Preview parity, the owner's hard requirement: the PROJECT-layer tiers
// (pulse, from the fleet) render byte-identical whether a session rode in
// or not — so `task context` in a repo shows exactly what that project's
// operator sees, minus the session extras. By construction: those tiers
// are pure functions of scope, and the cap leaves them room to spare.
Deno.test('contextDigest: preview parity — project layer matches with/without a session', () => {
  let NOW = Date.parse('2026-07-20T12:00:00Z')
  let ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString()
  let id = (n: number) =>
    `abababab-0000-4000-8000-${String(n).padStart(12, '0')}`
  let [P, T1p, T2p, M1p, SESS] = [1, 2, 3, 4, 5].map(id)
  let mk = (
    eid: string,
    num: number,
    at: string,
    parts: Record<string, Record<string, unknown>>,
  ) => [
    { eid, name: 'entity', comp: { eid, num } },
    { eid, name: 'created', comp: { at } },
    ...Object.entries(parts).map(([name, comp]) => ({ eid, name, comp })),
  ]
  let g: Snapshot = {
    changes: [
      ...mk(P, 1, ago(1), { doc: { title: 'Proj' }, project: {} }),
      ...mk(T1p, 2, ago(2), {
        doc: { title: 'First move' },
        task: { status: 'wip', priority: 0, project: P },
      }),
      ...mk(T2p, 3, ago(5), {
        doc: { title: 'Second move' },
        task: { priority: 1, project: P },
      }),
      ...mk(M1p, 4, ago(1), {
        doc: { title: 'A principle' },
        memory: { type: 'feedback' },
      }),
      // a session that CLAIMS a project task — its digest gains the session
      // layer (claimed-by-you, onMine); the project layer must not shift.
      ...mk(SESS, 5, ago(0), { session: { id: 'sess-p' } }),
      { eid: T1p, name: 'claim', comp: { session: SESS } },
    ],
    deps: [],
  }
  let preview = contextDigest(g, undefined, NOW, P)
  let session = contextDigest(g, 'sess-p', NOW, P)
  // the session digest genuinely carries more (its claim), proving the
  // two aren't trivially equal
  assertEquals(session.includes('claimed by you'), true)
  assertEquals(preview.includes('claimed by you'), false)
  // yet the project-layer tiers are byte-identical
  assertEquals(section(preview, '## lately'), section(session, '## lately'))
  assertEquals(
    section(preview, '## from the fleet'),
    section(session, '## from the fleet'),
  )
})

Deno.test("contextDigest: previously — the same operator's last brief", () => {
  let NOW = Date.parse('2026-07-20T12:00:00Z')
  let ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString()
  let num = 50
  let mk = (
    eid: string,
    mod: string,
    parts: Record<string, Record<string, unknown>>,
  ) => [
    { eid, name: 'entity', comp: { eid, num: num++ } },
    { eid, name: 'created', comp: { at: mod } },
    ...Object.entries(parts).map(([name, comp]) => ({ eid, name, comp })),
  ]
  let eid = (i: number) => `cccccccc-0000-4000-8000-00000000000${i}`
  let OP = eid(9)
  let late: Snapshot = {
    changes: [
      ...mk(eid(1), ago(20), {
        session: { id: 'ws-old', actor: OP },
        doc: { title: 'Work session' },
        brief: { text: 'landed: everything\nnext: polish' },
      }),
      ...mk(eid(2), ago(30), {
        session: { id: 'ws-older', actor: OP },
        doc: { title: 'Older' },
        brief: { text: 'stale' },
      }),
      ...mk(eid(3), ago(4), {
        session: { id: 'ws-other', actor: eid(8) },
        doc: { title: 'Other op' },
        brief: { text: 'not yours' },
      }),
      ...mk(eid(4), ago(0), { session: { id: 'ws-new', actor: OP } }),
    ],
    deps: [],
  }
  let d = contextDigest(late, 'ws-new', NOW)
  assertMatch(d, /## previously — S-50 Work session/)
  assertEquals(d.includes('landed: everything'), true)
  // the newest same-operator brief wins — never another op's, never older
  assertEquals(d.includes('previously — S-52'), false)
  assertEquals(d.includes('stale'), false)
  // the tied session is not double-listed in lately's briefs
  assertEquals(
    d.split('\n').filter((l) => l.includes('Work session')).length,
    1,
  )
  // the session doc.body is NEVER scraped — even a real-looking body is
  // ignored; a managed run's final_text stands in when there is no brief comp
  let noBrief = structuredClone(late)
  noBrief.changes = noBrief.changes.filter(
    (c) => !(c.eid == eid(1) && c.name == 'brief'),
  )
  noBrief.changes.find((c) => c.eid == eid(1) && c.name == 'doc')!.comp!.body =
    `${STUB} — a stub, ignore me.`
  noBrief.changes.find((c) => c.eid == eid(1) && c.name == 'session')!.comp!
    .final_text = 'the closing words'
  let nb = contextDigest(noBrief, 'ws-new', NOW)
  assertEquals(nb.includes('the closing words'), true)
  assertEquals(nb.includes('a stub, ignore me'), false)
  // no operator in common: no previously line
  assertEquals(
    contextDigest(late, 'ws-other', NOW).includes('previously'),
    false,
  )
})

Deno.test('contextDigest: resume pops this actor stack before narrative memory', () => {
  let id = (n: number) =>
    `eeeeeeee-0000-4000-8000-${String(n).padStart(12, '0')}`
  let [actor, other, current, past, top, lower, foreign, active, touched] = [
    1,
    2,
    3,
    4,
    5,
    6,
    7,
    8,
    9,
  ].map(id)
  let task = (
    eid: string,
    num: number,
    title: string,
    resume?: Record<string, unknown>,
    claim?: Record<string, unknown>,
  ) => [
    { eid, name: 'entity', comp: { eid, num } },
    { eid, name: 'doc', comp: { title, body: '' } },
    { eid, name: 'task', comp: { status: 'wip', priority: num } },
    ...(resume ? [{ eid, name: 'resume', comp: resume }] : []),
    ...(claim ? [{ eid, name: 'claim', comp: claim }] : []),
  ]
  let g: Snapshot = {
    changes: [
      { eid: actor, name: 'entity', comp: { eid: actor, num: 1 } },
      { eid: other, name: 'entity', comp: { eid: other, num: 2 } },
      { eid: current, name: 'entity', comp: { eid: current, num: 3 } },
      {
        eid: current,
        name: 'session',
        comp: { id: 'resume-now', actor },
      },
      { eid: past, name: 'entity', comp: { eid: past, num: 4 } },
      {
        eid: past,
        name: 'session',
        comp: { id: 'resume-past', actor },
      },
      { eid: past, name: 'doc', comp: { title: 'Last time', body: '' } },
      { eid: past, name: 'brief', comp: { text: 'brief' } },
      ...task(top, 5, 'Incident C', { actor, at: '2026-07-20', rank: 3 }),
      ...task(lower, 6, 'Original A', { actor, at: '2026-07-18', rank: 1 }),
      ...task(foreign, 7, 'Not my yak', {
        actor: other,
        at: '2026-07-21',
        rank: 9,
      }),
      ...task(active, 8, 'Still held elsewhere', undefined, {
        session: past,
        claimed_at: '2026-07-19',
      }),
      ...task(touched, 9, 'Recently touched'),
      {
        eid: touched,
        name: 'updated',
        comp: { at: '2026-07-20', by: actor },
      },
      // A claim held by ANOTHER actor's session — the `.claim.session.actor`
      // deref must exclude it (the claim arm short-circuits the OR fallback).
      { eid: other, name: 'session', comp: { id: 'other-sess', actor: other } },
      ...task(id(10), 10, 'Held by another actor', undefined, {
        session: other,
        claimed_at: '2026-07-19',
      }),
    ],
    deps: [],
  }
  let d = contextDigest(g, 'resume-now')
  let resume = section(d, '## resume')
  assertEquals(resume[0], '## resume — pop your stack')
  assertEquals(resume.some((l) => l.includes('Not my yak')), false)
  assertEquals(resume.some((l) => l.includes('Held by another actor')), false)
  assertMatch(resume[1], /Incident C/)
  assertMatch(resume[2], /Original A/)
  assertMatch(resume[3], /Recently touched/)
  assertMatch(resume[4], /Still held elsewhere/)
  assertMatch(resume[4], /⚑ S-4/)
  assertEquals(d.indexOf('## resume') < d.indexOf('## previously'), true)
})

Deno.test('contextDigest: agent history has no read-state summary', () => {
  let NOW = Date.parse('2026-07-20T12:00:00Z')
  let ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString()
  let num = 70
  let mk = (
    eid: string,
    at: string,
    parts: Record<string, Record<string, unknown>>,
  ) => {
    let { created = {}, ...comps } = parts
    return [
      { eid, name: 'entity', comp: { eid, num: num++ } },
      { eid, name: 'created', comp: { at, ...created } },
      ...Object.entries(comps).map(([name, comp]) => ({ eid, name, comp })),
    ]
  }
  let eid = (i: number) => `dddddddd-0000-4000-8000-0000000000${10 + i}`
  let OP = eid(0)
  let OTHER = eid(1) // a foreign actor
  let note = (
    eid: string,
    target: string,
    at: string,
    by = OTHER,
  ) =>
    mk(eid, at, {
      created: { by },
      doc: { title: '', body: 'words' },
      comment: { target: target },
    })
  let base = [
    ...mk(eid(2), ago(0), { session: { id: 'u-new', actor: OP } }),
    ...mk(eid(1), ago(50), { session: { id: 'u-other', actor: OTHER } }),
    // wrapped 20h ago — birth floors what can be owed to it
    ...mk(eid(3), ago(20), { session: { id: 'u-old', actor: OP } }),
    ...mk(eid(4), ago(30), { session: { id: 'u-older', actor: OP } }),
    // beyond the week: out of "recent"
    ...mk(eid(5), ago(24 * 8), { session: { id: 'u-stale', actor: OP } }),
  ]
  let g = (extra: Snapshot['changes']): Snapshot => ({
    changes: [...base, ...extra],
    deps: [],
  })
  // Human stamps and old session comments never become an agent unread count.
  let one = g([
    ...note(eid(6), eid(3), ago(10)),
    ...note(eid(7), eid(3), ago(5)),
    ...note(eid(8), eid(3), ago(22)), // predates the session: void
    ...note(eid(10), eid(3), ago(3), OP), // own actor
    ...note(eid(11), eid(1), ago(2)), // another actor's session
    ...note(eid(12), eid(5), ago(1)), // too old a session
    // already served — the per-item stamp is what makes it heard, and it
    // sits between the two that count, so a cursor could not have hidden it
    ...note(eid(13), eid(3), ago(7)),
    { eid: eid(13), name: 'notified', comp: {} },
  ])
  let d = contextDigest(one, 'u-new', NOW)
  assertEquals(d.includes('## unheard'), false)
  let two = g([
    ...note(eid(6), eid(3), ago(10)),
    ...note(eid(7), eid(4), ago(8)),
    ...note(eid(8), eid(4), ago(31)), // before u-older existed: void
  ])
  assertEquals(contextDigest(two, 'u-new', NOW).includes('## unheard'), false)
  // no session at all stays equally free of agent read-state.
  assertEquals(contextDigest(g([]), 'u-new', NOW).includes('unheard'), false)
  assertEquals(contextDigest(one, undefined, NOW).includes('unheard'), false)
})

// A whole-digest behavior-identical guard (T-18133): a rich graph exercising
// every section at once — the cross-section ordering and budget interplay the
// per-section tests above can't see. Frozen output; a one-pass-index refactor
// of the digest helpers must not move a byte of it.
Deno.test('contextDigest: golden — every section, frozen assembly', () => {
  let NOW = Date.parse('2026-08-15T12:00:00Z')
  let ago = (h: number) => new Date(NOW - h * 3600_000).toISOString()
  let G = 'aaaaaaaa-0000-4000-8000-0000000009'
  let mkE = (n: string, num: number, at: number, by?: string): Change[] => [
    { eid: G + n, name: 'entity', comp: { eid: G + n, num } },
    {
      eid: G + n,
      name: 'created',
      comp: by ? { at: ago(at), by } : { at: ago(at) },
    },
  ]
  let mkU = (n: string, at: number): Change => ({
    eid: G + n,
    name: 'updated',
    comp: { at: ago(at) },
  })
  let P = G + 'P', S = G + 'S'
  let changes: Change[] = [
    ...mkE('P', 10, 200),
    { eid: P, name: 'doc', comp: { title: 'Proj', body: '' } },
    { eid: P, name: 'project', comp: {} },
    ...mkE('S', 1, 100),
    {
      eid: S,
      name: 'session',
      comp: { id: 'sess-x', cwd: '/w', actor: 'alice' },
    },
    ...mkE('PS', 2, 50),
    mkU('PS', 48),
    {
      eid: G + 'PS',
      name: 'session',
      comp: { id: 'sess-prev', actor: 'alice' },
    },
    {
      eid: G + 'PS',
      name: 'doc',
      comp: { title: 'Prev session', body: '' },
    },
    {
      eid: G + 'PS',
      name: 'brief',
      comp: { text: 'line one of brief\nline two\nline three' },
    },
    ...mkE('WS', 3, 60),
    mkU('WS', 55),
    {
      eid: G + 'WS',
      name: 'session',
      comp: { id: 'sess-wrap', actor: 'alice' },
    },
    {
      eid: G + 'WS',
      name: 'doc',
      comp: { title: 'Wrapped session', body: 'wrap' },
    },
    ...mkE('T1', 4, 40),
    { eid: G + 'T1', name: 'doc', comp: { title: 'First claimed', body: '' } },
    {
      eid: G + 'T1',
      name: 'task',
      comp: { priority: 0, project: P },
    },
    { eid: G + 'T1', name: 'claim', comp: { session: S, claimed_at: ago(5) } },
    ...mkE('T2', 5, 39),
    { eid: G + 'T2', name: 'doc', comp: { title: 'Second claimed', body: '' } },
    {
      eid: G + 'T2',
      name: 'task',
      comp: { priority: 1, project: P },
    },
    { eid: G + 'T2', name: 'claim', comp: { session: S, claimed_at: ago(6) } },
    ...mkE('T3', 6, 30),
    mkU('T3', 2),
    {
      eid: G + 'T3',
      name: 'doc',
      comp: { title: 'Open in project', body: '' },
    },
    {
      eid: G + 'T3',
      name: 'task',
      comp: { priority: 0, project: P },
    },
    ...mkE('T4', 7, 20, 'alice'),
    {
      eid: G + 'T4',
      name: 'doc',
      comp: { title: 'Actor created open', body: '' },
    },
    {
      eid: G + 'T4',
      name: 'task',
      comp: { priority: 2, project: P },
    },
    ...mkE('C1', 8, 1, 'bob'),
    {
      eid: G + 'C1',
      name: 'doc',
      comp: { title: '', body: 'nice work on this' },
    },
    { eid: G + 'C1', name: 'comment', comp: { target: G + 'T1' } },
    ...mkE('C2', 9, 10, 'carol'),
    {
      eid: G + 'C2',
      name: 'doc',
      comp: { title: '', body: 'a question after wrap' },
    },
    { eid: G + 'C2', name: 'comment', comp: { target: G + 'WS' } },
    ...mkE('D1', 11, 70),
    { eid: G + 'D1', name: 'doc', comp: { title: 'A decision', body: '' } },
    { eid: G + 'D1', name: 'decided', comp: { at: ago(70), by: 'jeff' } },
    {
      eid: G + 'D1',
      name: 'task',
      comp: { priority: 0, project: P },
    },
    { eid: G + 'D1', name: 'completed', comp: { at: ago(70) } },
    ...mkE('M1', 12, 80),
    {
      eid: G + 'M1',
      name: 'doc',
      comp: { title: 'A principle', body: 'body' },
    },
    { eid: G + 'M1', name: 'memory', comp: {} },
  ]
  let golden = [
    '# tasks · session sess-x',
    'claimed by you:',
    '- T-4 wip — First claimed',
    '- T-5 wip — Second claimed',
    '## resume — pop your stack',
    '- T-7 open — Actor created open',
    '## previously — S-2 Prev session',
    '> line one of brief',
    '> line two',
    '> line three',
    '## on your tasks',
    '- T-4 💬 someone: nice work on this',
    '## fleet — nowhere placed',
    '- T-6 open — Open in project',
    '- T-7 open — Actor created open',
    '- T-5 wip — Second claimed',
    '## decided',
    '- 2026-08-12 T-11 — A decision',
    '## from the fleet — read any that fit (MCP memory_recall / CLI task show <id>), adopt what helps',
    '- M-12 0.04 A principle',
    'claim: `task claim <id> sess-x` · comment: `task comment <id> "…"` · release when done or handing off',
  ].join('\n')
  assertEquals(contextDigest({ changes, deps: [] }, 'sess-x', NOW), golden)
})

// The claim read a boot digest makes must be O(1) in the actor's session
// history — it may name only the CURRENT session, never enumerate every session
// the actor ever spawned into one `.claim.session=` list (that overflowed the
// request URL past the server cap and 400'd every boot for a dogfooding actor,
// T-19393). Stub the graph door and assert every claim query names one session,
// no matter how deep the actor's history is.
Deno.test('contextSnapshot: claim read names only the current session', async () => {
  let CUR = 'aaaaaaaa-0000-4000-8000-0000000009c0' // current session entity
  let CLAIM = 'aaaaaaaa-0000-4000-8000-0000000009c1'
  let ACTOR = 'aaaaaaaa-0000-4000-8000-0000000009c2'
  let SID = 'boot-sid'
  // A deep history: many sessions for the same actor. The old enumeration
  // built a claim URL proportional to this; the fix must not.
  let history = Array.from({ length: 40 }, (_, i) => ({
    kind: 'session',
    entity: { eid: `aaaaaaaa-0000-4000-8000-${String(i).padStart(12, '3')}` },
    session: { id: `hist-${i}`, actor: ACTOR },
  }))
  let current = {
    kind: 'session',
    entity: { eid: CUR, num: 1 },
    session: { id: SID, actor: ACTOR, cwd: '/w' },
  }
  let claim = {
    kind: 'claim',
    entity: { eid: CLAIM, num: 2 },
    claim: { session: CUR },
  }
  let claimReads: string[] = []
  let real = globalThis.fetch
  let json = (rows: unknown[]) =>
    new Response(JSON.stringify(rows), { status: 200 })
  globalThis.fetch = ((input: string | URL) => {
    let u = String(input)
    let filters = (u.split('?')[1] ?? '').split('&').filter(Boolean).map(
      decodeURIComponent,
    )
    let claimF = filters.find((f) => f.startsWith('.claim.session='))
    if (claimF) {
      let val = claimF.slice('.claim.session='.length)
      claimReads.push(val)
      return Promise.resolve(json(val.split(',').includes(CUR) ? [claim] : []))
    }
    if (filters.some((f) => f.startsWith('.session.id='))) {
      return Promise.resolve(json([current]))
    }
    if (
      filters.includes('.kind=session') &&
      filters.some((f) => f.startsWith('.session.actor='))
    ) return Promise.resolve(json([current, ...history]))
    return Promise.resolve(json([]))
  }) as typeof fetch
  try {
    let snap = await contextSnapshot(SID, '/w')
    // No claim read enumerated the history — each names exactly one session.
    assertEquals(claimReads.length > 0, true)
    for (let v of claimReads) assertEquals(v, CUR)
    // mine still resolves: the current session's claim rode into the snapshot.
    assertEquals(
      snap.changes.some((c) => c.name == 'claim' && c.comp?.session == CUR),
      true,
    )
  } finally {
    globalThis.fetch = real
  }
})

Deno.test('commitChanges: the sha is the eid; a known sha is found, not minted', () => {
  let sha = 'ABCDEF0123456789abcdef0123456789abcdef01'
  let git = { sha, repo: '/r', message: 'Land it\n\nWhy.' }
  let cs = commitChanges(all, T1, git, 'sess-x')
  let last = cs.at(-1)!
  assertEquals(last.eid, sha.toLowerCase())
  assertEquals(last.name, 'commit')
  assertEquals(last.comp, { target: T1, ...git, sha: sha.toLowerCase() })
  assertEquals(commitChanges(all, T1, git).length, 1)
  let known = [...all, {
    eid: sha.toLowerCase(),
    num: 99,
    kind: 'commit',
    comps: { commit: { target: T1, sha: sha.toLowerCase() } },
  } as Row]
  assertEquals(commitChanges(known, T1, git), [])
  assertEquals(commitChanges(known, T2, git), [
    ...link(sha.toLowerCase(), 'about', T2),
  ])
})
