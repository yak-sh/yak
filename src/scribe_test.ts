// The scribe's pure half: what counts as a stub, when the desk is
// free, and the spawn the sweep would mint. The sweep itself is the
// same apply/dispatch machinery every other sweep rides.
import { type Snapshot } from './types.ts'
import { rows, STUB } from './client.ts'
import { deskFree, scribeSpawn, stubs } from './scribe.ts'
import { assertEquals, assertThrows } from '@std/assert'

let NOW = Date.parse('2026-07-22T12:00:00Z')
let ago = (m: number) => new Date(NOW - m * 60_000).toISOString()
let id = (n: number) => `cccccccc-0000-4000-8000-${String(n).padStart(12, '0')}`
let [P, DESK, PERSONA, S1, S2, OLD] = [1, 2, 3, 4, 5, 6].map(id)

let mk = (
  eid: string,
  num: number,
  mod: string,
  parts: Record<string, Record<string, unknown>>,
) => [
  { eid, name: 'entity', comp: { eid, num } },
  { eid, name: 'created', comp: { at: mod } },
  ...Object.entries(parts).map(([name, comp]) => ({ eid, name, comp })),
]

let graph = (extra: Snapshot['changes'] = []): Snapshot => ({
  changes: [
    ...mk(P, 1, ago(9999), {
      doc: { title: 'Task Graph' },
      project: {},
      repo: { path: '/repo', base_branch: 'main' },
    }),
    ...mk(DESK, 2, ago(9999), {
      doc: { title: 'the desk' },
      task: { status: 'open', priority: 3, project_eid: P },
      alias: { slug: 'scribe-desk' },
    }),
    ...mk(PERSONA, 3, ago(9999), {
      doc: { title: 'scribe', body: 'you write' },
      persona: { home_eid: P },
      alias: { slug: 'scribe' },
    }),
    ...mk(S1, 4, ago(30), {
      doc: { title: 'Work session', body: `${STUB} — a stub, enrich me.` },
      session: { id: 'sess-1' },
    }),
    ...extra,
  ],
  deps: [],
})

Deno.test('stubs: the marker is the queue, fresh wraps wait', () => {
  let all = rows(graph())
  assertEquals(stubs(all, NOW).map((r) => r.eid), [S1])
  // a five-minute-old stub is still settling; a rewritten doc is done
  let busy = rows(graph([
    ...mk(S2, 5, ago(5), {
      doc: { title: 'x', body: `${STUB} — fresh` },
      session: { id: 'sess-2' },
    }),
    ...mk(OLD, 6, ago(999), {
      doc: { title: 'y', body: 'A narrative now.' },
      session: { id: 'sess-3' },
    }),
  ]))
  assertEquals(stubs(busy, NOW).map((r) => r.eid), [S1])
})

Deno.test('deskFree: an unsettled or recent desk session blocks', () => {
  let free = rows(graph())
  let desk = free.find((r) => r.eid == DESK)!
  assertEquals(deskFree(free, desk, NOW), true)
  let running = rows(graph(
    mk(S2, 5, ago(999), {
      session: { id: 'sc-1', requested_task_eid: DESK, status: 'running' },
    }),
  ))
  assertEquals(deskFree(running, desk, NOW), false)
  let recent = rows(graph(
    mk(S2, 5, ago(20), {
      session: { id: 'sc-2', requested_task_eid: DESK, status: 'completed' },
    }),
  ))
  assertEquals(deskFree(recent, desk, NOW), false)
  let done = rows(graph(
    mk(S2, 5, ago(90), {
      session: { id: 'sc-3', requested_task_eid: DESK, status: 'completed' },
    }),
  ))
  assertEquals(deskFree(done, desk, NOW), true)
})

Deno.test('scribeSpawn: haiku wearing the scribe persona, or nothing, or a shout', () => {
  let g = graph()
  let changes = scribeSpawn(rows(g), g.deps, NOW)!
  let sess = changes.find((c) => c.name == 'session')!.comp!
  assertEquals(sess.provider, 'claude')
  assertEquals(sess.model, 'haiku')
  assertEquals(sess.persona_eid, PERSONA)
  assertEquals(sess.requested_task_eid, DESK)
  // no stubs = no spawn, quietly
  let quiet: Snapshot = {
    changes: graph().changes.filter((c) => c.eid != S1),
    deps: [],
  }
  assertEquals(scribeSpawn(rows(quiet), quiet.deps, NOW), null)
  // stubs but no desk = a half-seeded graph should say so
  let noDesk: Snapshot = {
    changes: graph().changes.filter((c) => c.eid != DESK),
    deps: [],
  }
  assertThrows(
    () => scribeSpawn(rows(noDesk), noDesk.deps, NOW),
    Error,
    'no scribe-desk',
  )
})

Deno.test('the desk never scribes itself: its own wrap stubs are exempt', () => {
  let ours = rows(graph(
    mk(S2, 5, ago(120), {
      doc: { title: 'scribe shift', body: `${STUB} — a stub` },
      session: { id: 'sc-old', requested_task_eid: DESK, status: 'completed' },
    }),
  ))
  assertEquals(stubs(ours, NOW, DESK).map((r) => r.eid), [S1])
  // with S1 gone, the desk stub alone spawns nothing
  let alone: Snapshot = {
    changes: [
      ...graph().changes.filter((c) => c.eid != S1),
      ...mk(S2, 5, ago(120), {
        doc: { title: 'scribe shift', body: `${STUB} — a stub` },
        session: {
          id: 'sc-old',
          requested_task_eid: DESK,
          status: 'completed',
        },
      }),
    ],
    deps: [],
  }
  assertEquals(scribeSpawn(rows(alone), alone.deps, NOW), null)
})
