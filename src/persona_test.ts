// The persona materializer, pure: rows+deps in, markdown out. One
// little graph builder writes many cases in few lines; syncFiles gets a
// temp dir (never a repo). The server effect and the CLI verb render
// through these same functions, so what passes here is what lands on
// disk everywhere.
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { type Dep, type Edge, kindOf } from './types.ts'
import { type Row } from './client.ts'
import {
  baselineOf,
  DIALECT,
  filesFor,
  indexLine,
  materialize,
  syncFiles,
} from './persona.ts'

let NOW = Date.parse('2026-07-22T00:00:00Z')
let day = (n: number) => new Date(NOW - n * 86_400_000).toISOString()

// A tiny graph: rows by name, edges as sentences. Recency becomes
// warmth via entity.modified_at (hot()'s fallback), so ordering is
// testable without recall rows.
let n = 0
let row = (comps: Row['comps'], daysOld = 0): Row => {
  let num = ++n
  return {
    eid: `e${num}`,
    num,
    kind: kindOf(comps),
    comps: { entity: { num, modified_at: day(daysOld) }, ...comps },
  }
}
let doc = (title: string, body: string, daysOld = 0) =>
  row({ doc: { title, body } }, daysOld)
let edge = (parent: Row, type: Edge, child: Row): Dep => ({
  parent: parent.eid,
  type,
  child: child.eid,
})

let persona = row({
  doc: { title: 'graybeard', body: 'Review sternly.' },
  persona: { home_eid: null },
})
let warm = doc('fresh lesson', 'Use the front door.', 1)
let cold = doc('old lesson', 'Mind the gap.', 60)
let indexed = row({
  doc: { title: 'delegation discipline', body: 'Worktrees only.' },
  memory: { type: 'feedback', last_confirmed_at: day(3) },
  recall: { count: 4, first_at: day(30), last_at: day(2) },
}, 2)

Deno.test('materialize: header, core, tiers in warmth order', () => {
  let all = [persona, warm, cold, indexed]
  let deps = [
    edge(persona, 'contains', cold),
    edge(persona, 'contains', warm),
    edge(persona, 'reads', indexed),
  ]
  let md = materialize(all, deps, persona, NOW)
  assertStringIncludes(md, `GENERATED from N-${persona.num}`)
  assertStringIncludes(md, 'Review sternly.')
  // preloaded bodies ride whole, warm before cold
  assertStringIncludes(md, '## Preloaded')
  assert(md.indexOf('Use the front door.') < md.indexOf('Mind the gap.'))
  // the index carries lines, not bodies
  assertStringIncludes(md, '## Index')
  assertStringIncludes(md, 'delegation discipline')
  assert(!md.includes('Worktrees only.'))
})

Deno.test('materialize: a bare persona is just header + core', () => {
  let md = materialize([persona], [], persona, NOW)
  assert(!md.includes('## Preloaded'))
  assert(!md.includes('## Index'))
  assertStringIncludes(md, 'Review sternly.')
})

Deno.test('materialize: dead or docless tier members drop silently', () => {
  let ghost: Dep = { parent: persona.eid, type: 'contains', child: 'gone' }
  let bare = row({ web: { url: 'http://x' } })
  let md = materialize(
    [persona, bare],
    [ghost, edge(persona, 'contains', bare)],
    persona,
    NOW,
  )
  assert(!md.includes('## Preloaded'))
})

Deno.test('materialize: a dialect reframes without touching content', () => {
  let md = materialize(
    [persona, warm],
    [edge(persona, 'contains', warm)],
    persona,
    NOW,
    {
      ...DIALECT,
      header: (id) => `# hat: ${id}`,
      preloaded: '## Loaded',
    },
  )
  assertStringIncludes(md, `# hat: N-${persona.num}`)
  assertStringIncludes(md, '## Loaded')
  assertStringIncludes(md, 'Use the front door.')
  assert(!md.includes('GENERATED'))
})

Deno.test('indexLine: id, warmth, type, count, confirmed date', () => {
  let line = indexLine(indexed, NOW)
  assertStringIncludes(line, `- M-${indexed.num} `)
  assertStringIncludes(line, 'feedback: delegation discipline')
  assertStringIncludes(line, '· 4×')
  assertStringIncludes(line, `confirmed ${day(3).slice(0, 10)}`)
})

Deno.test('baselineOf: the persona its project contains', () => {
  let proj = row({ project: {}, doc: { title: 'Holdco' } })
  let base = row({
    doc: { title: 'base', body: 'b' },
    persona: { home_eid: proj.eid },
  })
  let other = row({
    doc: { title: 'other', body: 'o' },
    persona: { home_eid: proj.eid },
  })
  let all = [proj, base, other]
  assertEquals(baselineOf(all, [edge(proj, 'contains', base)], proj.eid), base)
  // no contains edge → no baseline, however many personas call it home
  assertEquals(baselineOf(all, [], proj.eid), undefined)
})

Deno.test('filesFor: baseline → AGENTS.md, others → personas/<slug>.md, fleet → nowhere', () => {
  let proj = row({
    project: {},
    doc: { title: 'Holdco' },
    repo: { path: '/repo' },
  })
  let homeless = row({ project: {}, doc: { title: 'no checkout' } })
  let base = row({
    doc: { title: 'base', body: 'b' },
    persona: { home_eid: proj.eid },
  })
  let other = row({
    doc: { title: 'other', body: 'o' },
    persona: { home_eid: proj.eid },
    alias: { slug: 'reviewer' },
  })
  let fleet = row({
    doc: { title: 'graybeard', body: 'g' },
    persona: { home_eid: null },
  })
  let stray = row({
    doc: { title: 'stray', body: 's' },
    persona: { home_eid: homeless.eid },
  })
  let files = filesFor(
    [proj, homeless, base, other, fleet, stray],
    [edge(proj, 'contains', base)],
    NOW,
  )
  assertEquals(files.map((f) => f.path), [
    '/repo/.tasks/AGENTS.md',
    '/repo/.tasks/personas/reviewer.md',
  ])
  assertStringIncludes(files[0].body, 'b')
  assertStringIncludes(files[1].body, 'o')
})

Deno.test('syncFiles: writes changes, skips fresh, isolates failures', () => {
  let dir = Deno.makeTempDirSync()
  try {
    let f = { path: `${dir}/deep/AGENTS.md`, body: 'one\n' }
    assertEquals(syncFiles([f]).written, [f.path])
    assertEquals(Deno.readTextFileSync(f.path), 'one\n')
    // unchanged → untouched (no churn for git status to see)
    assertEquals(syncFiles([f]), { written: [], failed: [] })
    // one bad path fails alone; the good write still lands
    let good = { path: `${dir}/ok.md`, body: 'two\n' }
    let bad = { path: `${dir}/ok.md/impossible.md`, body: 'x' }
    let out = syncFiles([good, bad])
    assertEquals(out.written, [good.path])
    assertEquals(out.failed.length, 1)
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})
