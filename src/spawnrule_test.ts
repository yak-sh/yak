// The spawn rule's pure half (D-21239): who counts as a persona, when a run
// is hot for a (persona, target), and the decision table — which watch
// subscriptions on an event's target yield a pending mark. The effect shell
// is the same apply/dispatch machinery every other effect rides.
import { type Snapshot } from './types.ts'
import { link } from './edge.ts'
import { rows } from './client.ts'
import { hotRun, isPersona, spawnMarks } from './spawnrule.ts'
import { assertEquals } from '@std/assert'

let NOW = Date.parse('2026-08-24T12:00:00Z')
let ago = (m: number) => new Date(NOW - m * 60_000).toISOString()
let id = (n: number) => `eeeeeeee-0000-4000-8000-${String(n).padStart(12, '0')}`
let [N1, N2, H1, T1, P1, W1, W2, W3, S1] = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(id)

let mk = (
  eid: string,
  num: number,
  parts: Record<string, Record<string, unknown>>,
) => [
  { eid, name: 'entity', comp: { eid, num } },
  { eid, name: 'created', comp: { at: ago(60) } },
  ...Object.entries(parts).map(([name, comp]) => ({ eid, name, comp })),
]

let graph = (extra: Snapshot['changes'] = []): Snapshot => ({
  changes: [
    ...mk(N1, 1, { doc: { title: 'the desk' }, persona: {} }),
    ...mk(N2, 2, { doc: { title: 'the other desk' }, persona: {} }),
    ...mk(H1, 3, { doc: { title: 'a person' }, person: {} }),
    ...mk(T1, 4, { doc: { title: 'watched' }, task: {} }),
    ...mk(P1, 5, { doc: { title: 'a venture' }, project: {} }),
    ...extra,
  ],
  deps: [],
})

let sub = (
  eid: string,
  num: number,
  actor: string,
  target: string,
  mode = 'watch',
) => mk(eid, num, { subscription: { actor, target, mode } })

let pick = (all: ReturnType<typeof rows>, ...eids: string[]) =>
  all.filter((r) => eids.includes(r.eid))

let want = (persona: string, target: string) => link(persona, 'wants', target)

Deno.test('isPersona: the persona comp decides — a bare project or person is not one', () => {
  let all = rows(graph([
    ...mk(id(20), 20, { doc: { title: 'base' }, project: {}, persona: {} }),
  ]))
  assertEquals(isPersona(all.find((r) => r.eid == N1)), true)
  // a project wearing base-persona comps (D-21308) IS a persona
  assertEquals(isPersona(all.find((r) => r.eid == id(20))), true)
  assertEquals(isPersona(all.find((r) => r.eid == P1)), false)
  assertEquals(isPersona(all.find((r) => r.eid == H1)), false)
  assertEquals(isPersona(undefined), false)
})

Deno.test('hotRun: a live run of the persona attending the target — by request or by lease', () => {
  let all = rows(graph([
    ...mk(S1, 9, { session: { id: 's1', persona: N1, requested_task: T1 } }),
  ]))
  let t = all.find((r) => r.eid == T1)!
  assertEquals(hotRun(all, N1, t)?.eid, S1)
  assertEquals(hotRun(all, N2, t), undefined)
  // a settled run is cold
  let done = rows(graph([
    ...mk(S1, 9, {
      session: { id: 's1', persona: N1, requested_task: T1, status: 'failed' },
    }),
  ]))
  assertEquals(hotRun(done, N1, done.find((r) => r.eid == T1)!), undefined)
  // the lease counts even when the run was not spawned onto the target
  let leased = rows(graph([
    ...mk(S1, 9, { session: { id: 's1', persona: N1 } }),
    { eid: T1, name: 'claim', comp: { session: S1 } },
  ]))
  assertEquals(hotRun(leased, N1, leased.find((r) => r.eid == T1)!)?.eid, S1)
})

Deno.test('spawnMarks: a persona watcher marks; a human watcher stays a delivery', () => {
  let all = rows(graph([
    ...sub(W1, 6, N1, T1),
    ...sub(W2, 7, H1, T1),
  ]))
  let target = all.find((r) => r.eid == T1)
  let marks = spawnMarks(target, pick(all, W1, W2), pick(all, N1, H1), [], [])
  assertEquals(marks, want(N1, T1))
})

Deno.test('spawnMarks: mute, non-task targets, and foreign subs yield nothing', () => {
  let all = rows(graph([
    ...sub(W1, 6, N1, T1, 'mute'),
    ...sub(W2, 7, N1, P1),
    ...sub(W3, 8, N2, id(30)),
  ]))
  let target = all.find((r) => r.eid == T1)
  // muted — and a watch on a DIFFERENT target says nothing about this one
  assertEquals(
    spawnMarks(target, pick(all, W1, W3), pick(all, N1, N2), [], []),
    [],
  )
  // the venture is not spawnable-onto (v1: tasks only)
  assertEquals(
    spawnMarks(
      all.find((r) => r.eid == P1),
      pick(all, W2),
      pick(all, N1),
      [],
      [],
    ),
    [],
  )
})

Deno.test('spawnMarks: a hot run or a pending mark debounces; a cold one does not', () => {
  let all = rows(graph([
    ...sub(W1, 6, N1, T1),
    ...mk(S1, 9, { session: { id: 's1', persona: N1, requested_task: T1 } }),
  ]))
  let target = all.find((r) => r.eid == T1)
  let subs = pick(all, W1), actors = pick(all, N1)
  // the event flows into the hot run's transcript — no mark
  assertEquals(spawnMarks(target, subs, actors, pick(all, S1), []), [])
  // one pending mark per (persona, target)
  assertEquals(
    spawnMarks(target, subs, actors, [], [
      { parent: N1, type: 'wants', child: T1 },
    ]),
    [],
  )
  // a settled run and a clean slate mark again — events re-instantiate
  let cold = rows(graph([
    ...sub(W1, 6, N1, T1),
    ...mk(S1, 9, {
      session: { id: 's1', persona: N1, requested_task: T1, status: 'done' },
    }),
  ]))
  assertEquals(
    spawnMarks(target, subs, actors, pick(cold, S1), []),
    want(N1, T1),
  )
})

Deno.test('spawnMarks: two watching personas each get their own mark', () => {
  let all = rows(graph([
    ...sub(W1, 6, N1, T1),
    ...sub(W2, 7, N2, T1),
  ]))
  let target = all.find((r) => r.eid == T1)
  assertEquals(
    spawnMarks(target, pick(all, W1, W2), pick(all, N1, N2), [], []),
    [...want(N1, T1), ...want(N2, T1)],
  )
})
