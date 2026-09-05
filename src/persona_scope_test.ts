// The bounded persona reads render the SAME BYTES as the whole-graph
// snapshot — the parity line for query derivation and the .tasks projection
// off snapshot() (T-21230). Persona corruption is the failure
// mode: a scoped walk that misses a tier member or a derived homeReads
// edge silently ships a wrong prompt, so the proof is byte equality over
// a graph with every shape that walk must reach — a contained base, an
// index tier, a specialist homed but not contained, and noise rows that
// must change nothing.
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { link } from './edge.ts'
import { idOf, uuid } from './types.ts'
import { evalGraph, personaGraph, projectionGraph } from './graph_query.ts'
import { resultStates } from './result_component.ts'
import { filesFor, materialize, taskRoots } from './persona.ts'
import { rows } from './client.ts'

Deno.env.set('DB_PATH', ':memory:')
let { apply, snapshot } = await import('./db.ts')
let { freshDb } = await import('./testdb.ts')

let NOW = Date.parse('2026-08-25T00:00:00Z')

let seed = () => {
  let db = freshDb()
  // The fixture is the owner's hand: persona composition and an accepted
  // memory are a person's writes (db.ts apply), so every seed write is jeff's.
  let jeff = uuid()
  apply(db, [{ eid: jeff, name: 'person', comp: {} }])
  let put = (changes: Parameters<typeof apply>[1]) =>
    apply(db, changes, undefined, jeff)
  let e = () => uuid()
  let doc = (eid: string, title: string, body = `${title} body`) =>
    put([{ eid, name: 'doc', comp: { title, body } }])
  let edge = (parent: string, type: string, child: string) =>
    put(link(parent, type, child))

  let proj = e() // managed venture
  doc(proj, 'Venture')
  apply(db, [
    { eid: proj, name: 'project', comp: {} },
    { eid: proj, name: 'repo', comp: { path: '/tmp/parity-venture' } },
  ])
  let bare = e() // project with no repo — filesFor must skip it
  doc(bare, 'Bare project')
  apply(db, [{ eid: bare, name: 'project', comp: {} }])

  let base = e() // fleet base — homeless, reached only through contains
  doc(base, 'Base persona')
  apply(db, [{ eid: base, name: 'persona', comp: {} }])
  let common = e() // the common persona: contained by its home project
  doc(common, 'Common persona')
  apply(db, [{ eid: common, name: 'persona', comp: { home: proj } }])
  edge(proj, 'contains', common)
  edge(common, 'contains', base)
  let spec = e() // specialist: homed, NOT contained — rides derived homeReads
  doc(spec, 'Specialist persona')
  apply(db, [
    { eid: spec, name: 'persona', comp: { home: proj } },
    { eid: spec, name: 'alias', comp: { slug: 'specialist' } },
  ])

  let m1 = e() // preloaded via the base — must surface through recursion
  doc(m1, 'Base memory')
  put([{ eid: m1, name: 'memory', comp: { scope: proj } }])
  edge(base, 'contains', m1)
  let m2 = e() // index tier on the common persona
  doc(m2, 'Indexed memory')
  put([{ eid: m2, name: 'memory', comp: {} }])
  edge(common, 'reads', m2)
  let m3 = e() // in scope, on no tier — the derived scoped set, not the text
  doc(m3, 'Untiered memory')
  put([{ eid: m3, name: 'memory', comp: { scope: proj } }])

  let noise = e() // unrelated row — present in snapshot, absent from the walk
  doc(noise, 'A task')
  apply(db, [{ eid: noise, name: 'task', comp: {} }])

  return { db, proj, common, spec, m1, m3 }
}

Deno.test('persona derivation reuses the bounded spawn closure and scope index', () => {
  let { db, common, m1, m3 } = seed()
  let value = resultStates(db, ['materialized'], [common], NOW)
    .get(common)!.get('materialized')!.comp as {
      text: string
      scoped: string[]
    }
  let graph = personaGraph(db, [common])
  let persona = graph.all.find((r) => r.eid == common)!
  assertEquals(value.text, materialize(graph.all, graph.deps, persona, NOW))
  assertEquals(new Set(value.scoped), new Set([m1, m3]))
  let hit = evalGraph(db, '.materialized!').hits.find((r) => r.eid == common)!
  assert(hit.comps.materialized)
  assertEquals(
    new Set(hit.comps.materialized.scoped as string[]),
    new Set([m1, m3]),
  )

  // Query-result components are not writable: a forged apply is discarded and
  // a later graph read carries no materialized component.
  apply(db, [{ eid: common, name: 'materialized', comp: value }])
  assertEquals(
    snapshot(db).changes.some((c) => c.name == 'materialized'),
    false,
  )
})

Deno.test('personaGraph materializes snapshot-identical bytes', () => {
  let { db, common, spec } = seed()
  let snap = snapshot(db)
  let whole = rows(snap)
  for (let eid of [common, spec]) {
    let p = whole.find((r) => r.eid == eid)!
    let g = personaGraph(db, [eid])
    let q = g.all.find((r) => r.eid == eid)!
    assertEquals(
      materialize(g.all, g.deps, q, NOW),
      materialize(whole, snap.deps, p, NOW),
    )
  }
})

Deno.test('projectionGraph yields snapshot-identical files and roots', () => {
  let { db } = seed()
  let snap = snapshot(db)
  let g = projectionGraph(db)
  assertEquals(
    filesFor(g.all, g.deps),
    filesFor(rows(snap), snap.deps),
  )
  assertEquals(taskRoots(g.all), taskRoots(rows(snap)))
  // The parity is not vacuous: the venture renders its common persona AND the
  // homeReads-only specialist, and the walk stayed bounded (no task row).
  let files = filesFor(g.all, g.deps)
  assertEquals(files.length, 2)
  assert(!g.all.some((r) => r.comps.task))
})

Deno.test('projectionGraph keeps a persona through role add and removal', () => {
  let { db, common, spec } = seed()
  let render = () => {
    let g = projectionGraph(db)
    let local = filesFor(g.all, g.deps)
    let snap = snapshot(db)
    assertEquals(
      local,
      filesFor(rows(snap), snap.deps),
      'bounded daemon and whole local projection stay byte-identical',
    )
    assertEquals(local.length, 2, 'one common and one specialist file')
    return {
      common: local.find((f) => f.path.endsWith('/AGENTS.md'))!,
      specialist: local.find((f) => f.path.endsWith('/specialist.md'))!,
    }
  }

  let plain = render()
  let initial = rows(snapshot(db))
  let commonRow = initial.find((r) => r.eid == common)!
  let specialistRow = initial.find((r) => r.eid == spec)!
  assertStringIncludes(plain.common.body, `GENERATED from ${idOf(commonRow)}`)
  assertStringIncludes(
    plain.specialist.body,
    `GENERATED from ${idOf(specialistRow)}`,
  )
  assertEquals(commonRow.kind, 'persona')
  assertEquals(specialistRow.kind, 'persona')

  apply(db, [{ eid: spec, name: 'role', comp: { state: 'stopped' } }])
  let mixed = render()
  let roleRow = rows(snapshot(db)).find((r) => r.eid == spec)!
  assertEquals(roleRow.kind, 'role', 'derived kind precedence is unchanged')
  assertStringIncludes(mixed.specialist.body, `GENERATED from ${idOf(roleRow)}`)
  assertStringIncludes(
    mixed.common.body,
    `GENERATED from ${idOf(commonRow)}`,
    'ordinary personas keep their N address',
  )

  apply(db, [{ eid: spec, name: 'role', comp: null }])
  let restored = render()
  let restoredRow = rows(snapshot(db)).find((r) => r.eid == spec)!
  assertEquals(restoredRow.kind, 'persona')
  assertStringIncludes(
    restored.specialist.body,
    `GENERATED from ${idOf(restoredRow)}`,
  )
  assertEquals(restored.specialist.body, plain.specialist.body)
})
