// The cache derivations: what the field pickers read out of the live
// world. Pure functions of the cache signal — no DOM, no socket.
import {
  backlinks,
  byWarmth,
  cache,
  deps,
  domains,
  ent,
  gated,
  projects,
} from './live.ts'
import { type Ent } from './types.ts'
import { assertEquals } from '@std/assert'

// A cache of task/project rows: `['T', 'Ops']` is a task in domain Ops
// (null = the column is absent), `['P', 'Fable']` a project by title.
let fill = (rows: [string, string | null][]) => {
  cache.value = Object.fromEntries(rows.map(([kind, v], i) => [
    `e${i}`,
    kind == 'T'
      ? {
        entity: { eid: `e${i}`, num: i, created_at: '' },
        task: { eid: `e${i}`, status: 'open', priority: 1, domain: v },
      }
      : {
        entity: { eid: `e${i}`, num: i, created_at: '' },
        doc: { eid: `e${i}`, title: v ?? '', body: '' },
        project: { eid: `e${i}` },
      },
  ]))
}

Deno.test('domains: distinct, sorted, absent ones skipped', () => {
  fill([['T', 'Ops'], ['T', 'Eng'], ['T', 'Ops'], ['T', null], ['P', 'Fable']])
  assertEquals(domains.value, ['Eng', 'Ops'])
})

Deno.test('domains: an empty string is not a domain', () => {
  fill([['T', ''], ['T', 'Eng']])
  assertEquals(domains.value, ['Eng'])
})

Deno.test('domains: nothing to say about an empty graph', () => {
  fill([])
  assertEquals(domains.value, [])
})

Deno.test('projects: project rows only, oldest first, named by doc', () => {
  fill([['T', 'Ops'], ['P', 'Sol'], ['P', 'Fable']])
  assertEquals(projects().map((p) => p.doc?.title), ['Sol', 'Fable'])
})

// Backlinks read the SCHEMA — wire vocabulary plus server-stamped columns
// (a session's requested_task_eid is an edge no client may write).
Deno.test('backlinks: stamped associations count', () => {
  cache.value = {
    t1: {
      entity: { eid: 't1', num: 1, created_at: '' },
      task: { eid: 't1', status: 'open', priority: 1, domain: null },
    },
    s1: {
      entity: { eid: 's1', num: 2, created_at: '' },
      session: { eid: 's1', id: 'x', requested_task_eid: 't1' },
    },
    c1: {
      entity: { eid: 'c1', num: 3, created_at: '' },
      claim: { eid: 'c1', session_eid: 's1' },
    },
  }
  assertEquals(backlinks('t1'), [{
    from: 's1',
    via: 'session.requested_task_eid',
  }])
  assertEquals(backlinks('s1'), [{ from: 'c1', via: 'claim.session_eid' }])
})

// byWarmth: the .order=hot board sort — a well-recalled old thing
// outranks a merely new one, and the unrecalled fade on their own.
Deno.test('byWarmth: recalled-often beats merely-new beats faded', () => {
  let NOW = Date.parse('2026-07-20T12:00:00Z')
  let iso = (d: number) => new Date(NOW - d * 86_400_000).toISOString()
  let old = {
    num: 1,
    modified_at: iso(5),
    recall: { eid: 'o', count: 40, first_at: iso(60), last_at: iso(0.2) },
  } as unknown as Ent
  let fresh = { num: 2, modified_at: iso(0.5) } as unknown as Ent
  let faded = { num: 3, modified_at: iso(6) } as unknown as Ent
  assertEquals(
    [faded, fresh, old].sort(byWarmth(NOW)).map((e) => e.num),
    [1, 2, 3],
  )
})

// gated() burns red only for an open `requires` child — a cancelled one
// settles the gate exactly like done, same as an unmet blocker changing
// its mind rather than finishing.
Deno.test('gated: a cancelled requires child releases the gate', () => {
  let mk = (status: string) => ({
    entity: { eid: `x`, num: 0, created_at: '' },
    task: { eid: 'x', status, priority: 1 },
  })
  cache.value = { parent: mk('open'), blocker: mk('open') }
  deps.value = [{ parent: 'parent', type: 'requires', child: 'blocker' }]
  assertEquals(gated(ent('parent')), true)

  cache.value = { parent: mk('open'), blocker: mk('cancelled') }
  assertEquals(gated(ent('parent')), false)

  cache.value = { parent: mk('open'), blocker: mk('done') }
  assertEquals(gated(ent('parent')), false)
})
