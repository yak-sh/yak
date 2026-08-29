// The dispatcher's pure half: what counts as ready, who holds a slot,
// the no-retry rule, and the batch a sweep would mint. The sweep itself
// is the same apply/dispatch machinery every other sweep rides.
import { type Snapshot } from './types.ts'
import { rows } from './client.ts'
import { type Provider } from './providers.ts'
import {
  approved,
  asked,
  authorized,
  backlog,
  dispatchSpawn,
  excluded,
  inFlight,
  on,
  ready,
  slots,
  wanted,
} from './dispatch.ts'
import { assertEquals } from '@std/assert'

let NOW = Date.parse('2026-08-24T12:00:00Z')
let ago = (m: number) => new Date(NOW - m * 60_000).toISOString()
let id = (n: number) => `dddddddd-0000-4000-8000-${String(n).padStart(12, '0')}`
let [P, T1, T2, T3, T4, S1, S2] = [1, 2, 3, 4, 5, 6, 7].map(id)

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

let graph = (extra: Snapshot['changes'] = []): Snapshot => ({
  changes: [
    ...mk(P, 1, ago(9999), { doc: { title: 'Task Graph' }, project: {} }),
    ...mk(T1, 2, ago(500), {
      doc: { title: 'approved and ready' },
      task: { priority: 1, project: P },
      decided: { at: ago(10) },
    }),
    ...mk(T2, 3, ago(100), {
      doc: { title: 'approved, lower priority' },
      task: { priority: 2, project: P },
      decided: { at: ago(10) },
    }),
    ...mk(T3, 4, ago(300), {
      doc: { title: 'open but never approved' },
      task: { priority: 0, project: P },
    }),
    ...extra,
  ],
  deps: [],
})

let ps: Provider[] = [{ name: 'claude', models: ['sonnet'] }]

Deno.test('approved: decided passes unless declined; absent verdict reads approved', () => {
  let all = rows(graph())
  assertEquals(approved(all.find((r) => r.eid == T1)!), true)
  assertEquals(approved(all.find((r) => r.eid == T3)!), false)
  let verdicts = rows(graph([
    ...mk(T4, 5, ago(50), {
      task: { project: P },
      decided: { at: ago(5), verdict: 'declined' },
    }),
  ]))
  assertEquals(approved(verdicts.find((r) => r.eid == T4)!), false)
  let yes = rows(graph([
    ...mk(T4, 5, ago(50), {
      task: { project: P },
      decided: { at: ago(5), verdict: 'approved' },
    }),
  ]))
  assertEquals(approved(yes.find((r) => r.eid == T4)!), true)
})

Deno.test('ready: a declined task never dispatches', () => {
  let all = rows(graph([
    { eid: T1, name: 'decided', comp: { at: ago(10), verdict: 'declined' } },
  ]))
  assertEquals(ready(all, []).map((r) => r.eid), [T2])
})

Deno.test('ready: open + unclaimed + approved + unblocked, urgent first', () => {
  // T1 (P1) outranks T2 (P2) despite T2's younger birth
  assertEquals(ready(rows(graph()), []).map((r) => r.eid), [T1, T2])
  let all = rows(graph([
    ...mk(T4, 5, ago(50), {
      doc: { title: 'approved twin of T1' },
      task: { priority: 1, project: P },
      decided: { at: ago(5) },
    }),
  ]))
  // equal priority: T1's older birth wins
  assertEquals(ready(all, []).map((r) => r.eid), [T1, T4, T2])
  // a claim, an external block, or a non-open status screens out
  let held = rows(graph([
    { eid: T1, name: 'claim', comp: { session: S1 } },
    { eid: T2, name: 'blocked', comp: { on: 'vendor' } },
  ]))
  assertEquals(ready(held, []).map((r) => r.eid), [])
})

Deno.test('ready: an open requires edge gates; a settled one does not', () => {
  let all = rows(graph())
  let dep = (child: string) => [
    { parent: T1, type: 'requires' as const, child },
  ]
  assertEquals(ready(all, dep(T3)).map((r) => r.eid), [T2]) // T3 open → gated
  let done = rows(graph([
    ...mk(T4, 5, ago(50), { task: { project: P }, completed: {} }),
  ]))
  assertEquals(ready(done, dep(T4)).map((r) => r.eid), [T1, T2])
  // a blocker the caller never fetched counts as open — spend on yes only
  assertEquals(ready(all, dep(id(99))).map((r) => r.eid), [T2])
})

Deno.test('inFlight: live sessions on approved tasks hold slots', () => {
  let all = rows(graph([
    // unstamped status = the pre-launch moment: still a slot
    ...mk(S1, 6, ago(5), { session: { id: 's1', requested_task: T1 } }),
    // settled runs free theirs
    ...mk(S2, 7, ago(60), {
      session: { id: 's2', requested_task: T2, status: 'failed' },
    }),
  ]))
  assertEquals(inFlight(all).map((r) => r.eid), [S1])
  let running = rows(graph([
    ...mk(S1, 6, ago(5), {
      session: { id: 's1', requested_task: T1, status: 'running' },
    }),
    // a live run on an UNapproved task is not the dispatcher's spend
    ...mk(S2, 7, ago(5), {
      session: { id: 's2', requested_task: T3, status: 'running' },
    }),
  ]))
  assertEquals(inFlight(running).map((r) => r.eid), [S1])
})

Deno.test('asked: one ask per task, ever — a failed Session is the record', () => {
  let all = rows(graph([
    ...mk(S1, 6, ago(60), {
      session: { id: 's1', requested_task: T1, status: 'failed' },
    }),
  ]))
  assertEquals(asked(all, T1), true)
  assertEquals(asked(all, T2), false)
})

Deno.test('slots: a count parses, anything else is the default', () => {
  assertEquals(slots('3'), 3)
  assertEquals(slots('0'), 0)
  assertEquals(slots(undefined), 2)
  assertEquals(slots('many'), 2)
  assertEquals(slots('-1'), 2)
})

Deno.test('dispatchSpawn: fills free slots, most urgent first', () => {
  let all = rows(graph())
  let sessions = (changes: ReturnType<typeof dispatchSpawn>) =>
    changes.filter((c) => c.name == 'session').map((c) => c.comp)
  let two = sessions(dispatchSpawn(all, [], ps, 2))
  assertEquals(two.map((s) => s!.requested_task), [T1, T2])
  assertEquals(two.map((s) => s!.provider), ['claude', 'claude'])
  assertEquals(two.map((s) => s!.model), ['sonnet', 'sonnet'])
  // one slot already spent leaves one spawn; cap 0 leaves none
  assertEquals(sessions(dispatchSpawn(all, [], ps, 1)).length, 1)
  assertEquals(dispatchSpawn(all, [], ps, 0), [])
})

Deno.test('excluded: names split on commas/space; empty bars nothing', () => {
  assertEquals([...excluded('codex, codex-cli')], ['codex', 'codex-cli'])
  assertEquals([...excluded('codex codex-cli')], ['codex', 'codex-cli'])
  assertEquals([...excluded('')], [])
  assertEquals([...excluded(undefined)], [])
})

Deno.test('dispatchSpawn: a task pinned to an excluded provider is skipped, not stopped', () => {
  // T1 pins codex via its spawn hint; the sweep's ps omits codex (excluded
  // upstream), so T1's plan resolves to codex — barred. T2 keeps the default
  // claude and still spawns: an excluded pin skips the task, never the sweep.
  let all = rows(graph([
    {
      eid: T1,
      name: 'spawn',
      comp: { provider: 'codex', model: 'gpt-5.6-sol' },
    },
  ]))
  let out = dispatchSpawn(all, [], ps, 2)
    .filter((c) => c.name == 'session').map((c) => c.comp!.requested_task)
  assertEquals(out, [T2])
})

Deno.test('dispatchSpawn: a held or asked-for task is skipped', () => {
  let all = rows(graph([
    ...mk(S1, 6, ago(5), {
      session: { id: 's1', requested_task: T1, status: 'running' },
    }),
  ]))
  // S1 holds a slot AND makes T1 asked-for — one slot left goes to T2
  let out = dispatchSpawn(all, [], ps, 2)
    .filter((c) => c.name == 'session').map((c) => c.comp!.requested_task)
  assertEquals(out, [T2])
  // an empty provider table spawns nothing rather than half a request
  assertEquals(dispatchSpawn(rows(graph()), [], [], 2), [])
})

// --- recursive descent: approval inherits down `requires` (T-21452) ---
// U is an approved umbrella gated by B1 + B2; none of the B* is individually
// decided, so approval reaches them only through U. B2 is itself gated by the
// deeper B3, so the unblocked frontier is B1 and B3.
let [U, B1, B2, B3] = [10, 11, 12, 13].map(id)
let tree = (approvedRoot = true) =>
  rows({
    changes: [
      ...mk(P, 1, ago(9999), { doc: { title: 'Task Graph' }, project: {} }),
      ...mk(U, 10, ago(100), {
        doc: { title: 'umbrella' },
        task: { priority: 1, project: P },
        ...(approvedRoot ? { decided: { at: ago(5) } } : {}),
      }),
      ...mk(B1, 11, ago(90), {
        doc: { title: 'unblocked blocker' },
        task: { priority: 1, project: P },
      }),
      ...mk(B2, 12, ago(90), {
        doc: { title: 'gated blocker' },
        task: { priority: 3, project: P },
      }),
      ...mk(B3, 13, ago(90), {
        doc: { title: 'deep blocker' },
        task: { priority: 2, project: P },
      }),
    ],
  })
let subtree = [
  { parent: U, type: 'requires' as const, child: B1 },
  { parent: U, type: 'requires' as const, child: B2 },
  { parent: B2, type: 'requires' as const, child: B3 },
]

Deno.test('authorized: an approved open task authorizes its whole requires subtree', () => {
  assertEquals([...authorized(tree(), subtree)].sort(), [B1, B2, B3].sort())
  // an UNapproved gated root seeds nothing — no inheritance without a yes
  assertEquals([...authorized(tree(false), subtree)], [])
})

Deno.test('authorized: a requires cycle terminates', () => {
  let cyclic = [...subtree, {
    parent: B3,
    type: 'requires' as const,
    child: B1,
  }]
  // U→B1, U→B2→B3→B1 is a cycle among the blockers; the seen guard stops it
  assertEquals([...authorized(tree(), cyclic)].sort(), [B1, B2, B3].sort())
})

Deno.test('backlog: recursive spawns the unblocked frontier; non-recursive stays root-only', () => {
  // recursive: B1 (ungated, P1) then B3 (ungated, P2); B2 gated by B3 and U
  // gated by both are excluded
  assertEquals(backlog(tree(), subtree, true).map((r) => r.eid), [B1, B3])
  // non-recursive: none individually approved, U gated → nothing (and ready()
  // is exactly the non-recursive backlog — unchanged)
  assertEquals(backlog(tree(), subtree, false).map((r) => r.eid), [])
  assertEquals(ready(tree(), subtree).map((r) => r.eid), [])
  // recursion off a NON-approved root yields nothing
  assertEquals(backlog(tree(false), subtree, true).map((r) => r.eid), [])
})

Deno.test('dispatchSpawn: recursive descent spawns the frontier then parks the umbrella; non-recursive does not', () => {
  let spawned = (cs: ReturnType<typeof dispatchSpawn>) =>
    cs.filter((c) => c.name == 'session').map((c) => c.comp!.requested_task)
  // workers first (B1, B3 — the ungated frontier), then the approved gated
  // umbrella U spawns to PARK (D-21448 T-21496). B2 is only authorized, not
  // individually approved, so it does not park — it cold-redispatches once B3
  // lands.
  assertEquals(spawned(dispatchSpawn(tree(), subtree, ps, 5, true)), [
    B1,
    B3,
    U,
  ])
  // the flag is the whole switch: off, an approved-gated umbrella spawns nothing
  // (no frontier descent, and no parked parent)
  assertEquals(dispatchSpawn(tree(), subtree, ps, 5, false), [])
  // slot cap bounds the whole spawn — workers take the slot before the parker
  assertEquals(spawned(dispatchSpawn(tree(), subtree, ps, 1, true)), [B1])
  // an un-decided gated root contributes nothing even recursively — not the
  // frontier (unauthorized) and not a parked parent (unapproved)
  assertEquals(dispatchSpawn(tree(false), subtree, ps, 5, true), [])
})

Deno.test('dispatchSpawn: recursive descent leaves a claimed or asked blocker alone', () => {
  let spawned = (cs: ReturnType<typeof dispatchSpawn>) =>
    cs.filter((c) => c.name == 'session').map((c) => c.comp!.requested_task)
  // U approved, gated by two unblocked blockers B1 (P1) and B3 (P2)
  let flat = (extra: Snapshot['changes']) =>
    rows({
      changes: [
        ...mk(P, 1, ago(9999), { doc: { title: 'g' }, project: {} }),
        ...mk(U, 10, ago(100), {
          task: { priority: 1, project: P },
          decided: { at: ago(5) },
        }),
        ...mk(B1, 11, ago(90), {
          task: { priority: 1, project: P },
        }),
        ...mk(B3, 13, ago(90), {
          task: { priority: 2, project: P },
        }),
        ...extra,
      ],
    })
  let deps = [
    { parent: U, type: 'requires' as const, child: B1 },
    { parent: U, type: 'requires' as const, child: B3 },
  ]
  // B1 claimed → left alone; B3 spawns as the worker, then U parks (still gated
  // while B1 is being worked)
  let held = flat([{ eid: B1, name: 'claim', comp: { session: S1 } }])
  assertEquals(spawned(dispatchSpawn(held, deps, ps, 5, true)), [B3, U])
  // a prior (even failed) ask on B3 leaves it alone too — B1 spawns as the
  // worker, then U parks
  let askedB3 = flat([
    ...mk(S2, 7, ago(60), {
      session: { id: 's2', requested_task: B3, status: 'failed' },
    }),
  ])
  assertEquals(spawned(dispatchSpawn(askedB3, deps, ps, 5, true)), [B1, U])
})

Deno.test('on: 1/true/on/yes enable; empty and anything else are off', () => {
  for (let v of ['1', 'true', 'on', 'yes', 'On', 'YES', ' true ']) {
    assertEquals(on(v), true)
  }
  for (let v of ['', undefined, '0', 'false', 'off', '2', 'no']) {
    assertEquals(on(v), false)
  }
})

// --- the spawn-rule queue: `wants` marks drain first, under the same cap ---

let N = id(8)
let persona = () => mk(N, 8, ago(9999), { doc: { title: 'desk' }, persona: {} })
let mark = { parent: N, type: 'wants' as const, child: T3 }
let gone = {
  eid: N,
  name: 'dependency',
  comp: { type: 'wants', child: T3, gone: true },
}

Deno.test('wanted: persona parent + task child, most urgent target first', () => {
  let all = rows(graph([...persona()]))
  let deps = [
    { parent: N, type: 'wants' as const, child: T2 },
    mark,
    // not a persona / not a task — stale marks the sweep leaves alone
    { parent: P, type: 'wants' as const, child: T1 },
    { parent: N, type: 'wants' as const, child: P },
    { parent: N, type: 'requires' as const, child: T1 },
  ]
  // T3 is priority 0, T2 priority 2
  assertEquals(wanted(all, deps).map((d) => d.child), [T3, T2])
})

Deno.test('dispatchSpawn: a mark spawns its persona onto the target and clears the edge', () => {
  let all = rows(graph([...persona()]))
  let out = dispatchSpawn(all, [mark], ps, 1)
  let s = out.find((c) => c.name == 'session')!.comp!
  // T3 is unapproved — the watch is the standing yes — and the mark
  // outranks the ready backlog (which waits: cap 1 is spent)
  assertEquals([s.requested_task, s.persona], [T3, N])
  assertEquals(out.filter((c) => c.name == 'dependency'), [gone])
  // a prior failed ask never blocks a mark — events re-instantiate
  let again = rows(graph([
    ...persona(),
    ...mk(S1, 6, ago(60), {
      session: { id: 's1', requested_task: T3, status: 'failed' },
    }),
  ]))
  let re = dispatchSpawn(again, [mark], ps, 1)
  assertEquals(re.some((c) => c.name == 'session'), true)
})

Deno.test('dispatchSpawn: a hot or settled mark clears unspent; a capped one waits', () => {
  let hot = rows(graph([
    ...persona(),
    ...mk(S1, 6, ago(5), {
      session: { id: 's1', persona: N, requested_task: T3, status: 'running' },
    }),
  ]))
  // the event already reached the hot run — the edge clears, nothing spawns
  // (the persona run holds a slot, so the ready backlog gets the other)
  let out = dispatchSpawn(hot, [mark], ps, 2)
  assertEquals(out.filter((c) => c.name == 'dependency'), [gone])
  assertEquals(
    out.filter((c) => c.name == 'session').map((c) => c.comp!.requested_task),
    [T1],
  )
  let done = rows(graph([
    ...persona(),
    { eid: T3, name: 'completed', comp: {} }, // T3 wears its end mark → settled
  ]))
  assertEquals(dispatchSpawn(done, [mark], ps, 0), [gone])
  // no free slot: the mark stays pending for the next sweep
  assertEquals(dispatchSpawn(rows(graph([...persona()])), [mark], ps, 0), [])
})

Deno.test('inFlight: a live persona run holds a slot even on an unapproved task', () => {
  let all = rows(graph([
    ...persona(),
    ...mk(S1, 6, ago(5), {
      session: { id: 's1', persona: N, requested_task: T3, status: 'running' },
    }),
  ]))
  assertEquals(inFlight(all).map((r) => r.eid), [S1])
})
