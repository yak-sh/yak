// The persona materializer, pure: rows+deps in, markdown out. One
// little graph builder writes many cases in few lines; syncFiles gets a
// temp dir (never a repo). The server effect and the CLI verb render
// through these same functions, so what passes here is what lands on
// disk everywhere.
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { type Dep, type Edge, kindOf } from './types.ts'
import { type Row } from './client.ts'
import {
  commonOf,
  DIALECT,
  filesFor,
  homeReads,
  indexLine,
  materialize,
  syncFiles,
} from './persona.ts'

let NOW = Date.parse('2026-07-22T00:00:00Z')
let day = (n: number) => new Date(NOW - n * 86_400_000).toISOString()

// A tiny graph: rows by name, edges as sentences. Recency becomes
// warmth via created.at (hot()'s last-touch fallback), so ordering is
// testable without recall rows.
let n = 0
let row = (comps: Row['comps'], daysOld = 0): Row => {
  let num = ++n
  return {
    eid: `e${num}`,
    num,
    kind: kindOf(comps),
    comps: { entity: { num }, created: { at: day(daysOld) }, ...comps },
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
let cold = doc(
  'old lesson',
  'Mind the gap.\n\n## Trust tiers\n\nAsk before crossing.',
  60,
)
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
  assertStringIncludes(md, `https://tasks.yak.sh/N-${persona.num}`)
  assertStringIncludes(md, 'Review sternly.')
  // preloaded bodies ride whole — each its own document under an H1
  // title behind a rule, warm before cold, no tier label
  assert(!md.includes('## Preloaded'))
  assertStringIncludes(md, `\n\n---\n\n# D-${warm.num} fresh lesson\n\n`)
  assert(md.indexOf('Use the front door.') < md.indexOf('Mind the gap.'))
  assertStringIncludes(
    md,
    'Mind the gap.\n\n## Trust tiers\n\nAsk before crossing.',
  )
  // the index carries lines, not bodies
  assertStringIncludes(md, '---\n\n## Memory Index\n\n*Recall a body by id')
  assertStringIncludes(md, 'delegation discipline')
  assert(!md.includes('Worktrees only.'))
})

Deno.test('materialize: a bare persona is just header + core', () => {
  let md = materialize([persona], [], persona, NOW)
  assert(!md.includes('---'))
  assert(!md.includes('## Memory Index'))
  assertStringIncludes(md, 'Review sternly.')
})

Deno.test('materialize: frontmatter stays at byte 0, header rides after it', () => {
  let fm = row({
    doc: {
      title: 'operator',
      body: '---\nname: operator\ntools: Read, Grep\n---\n\nYou run the fleet.',
    },
    persona: { home_eid: null },
  })
  // a preloaded memory's separator rule must not read as frontmatter
  let md = materialize([fm, warm], [edge(fm, 'contains', warm)], fm, NOW)
  // frontmatter opens the file, so a native harness parses name/tools
  assert(md.startsWith('---\n'))
  // the generated header rides after the frontmatter close, never before it
  let fmEnd = md.indexOf('\n---', 3) + '\n---'.length
  assert(md.indexOf('GENERATED') > fmEnd)
  assertStringIncludes(md, 'You run the fleet.')
  assert(md.indexOf('Use the front door.') > md.indexOf('You run the fleet.'))
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
  assert(!md.includes('---'))
})

Deno.test('materialize: every rule is blank-lined — no setext underline', () => {
  // a body ending in a text line must not become an H2 when the next
  // memory's rule lands under it (--- under text is a setext underline)
  let all = [persona, warm, cold, indexed]
  let deps = [
    edge(persona, 'contains', warm),
    edge(persona, 'contains', cold),
    edge(persona, 'reads', indexed),
  ]
  let md = materialize(all, deps, persona, NOW)
  assert(!/[^\n]\n---/.test(md))
  assert(!/---\n[^\n]/.test(md))
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
      rule: '***',
    },
  )
  assertStringIncludes(md, `# hat: N-${persona.num}`)
  assertStringIncludes(md, '\n\n***\n\n')
  assertStringIncludes(md, 'Use the front door.')
  assert(!md.includes('GENERATED'))
  assert(!md.includes('---'))
})

Deno.test('indexLine: id, type, count, confirmed date — never warmth', () => {
  let line = indexLine(indexed, NOW)
  assertStringIncludes(
    line,
    `- M-${indexed.num} feedback: delegation discipline`,
  )
  assertStringIncludes(line, '· 4×')
  assertStringIncludes(line, `confirmed ${day(3).slice(0, 10)}`)
  assert(!/\d\.\d\d/.test(line)) // a printed score churns every materialize
})

Deno.test('commonOf: the persona its project contains', () => {
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
  assertEquals(commonOf(all, [edge(proj, 'contains', base)], proj.eid), base)
  // no contains edge → no common persona, however many call it home
  assertEquals(commonOf(all, [], proj.eid), undefined)
})

Deno.test('homeReads: specialists derive project→persona reads from home_eid', () => {
  let proj = row({ project: {}, doc: { title: 'Holdco' } })
  let base = row({ doc: { title: 'base' }, persona: { home_eid: proj.eid } })
  let spec = row({
    doc: { title: 'reviewer' },
    persona: { home_eid: proj.eid },
  })
  let fleet = row({ doc: { title: 'graybeard' }, persona: { home_eid: null } })
  let all = [proj, base, spec, fleet]
  // base is the common persona (contains), so only the specialist derives an
  // edge; a homeless fleet persona is nobody's specialist.
  assertEquals(homeReads(all, [edge(proj, 'contains', base)]), [
    { parent: proj.eid, type: 'reads', child: spec.eid },
  ])
})

Deno.test('homeReads: a stored edge from home is left alone (no double sentence)', () => {
  let proj = row({ project: {}, doc: { title: 'Holdco' } })
  let spec = row({
    doc: { title: 'reviewer' },
    persona: { home_eid: proj.eid },
  })
  // whether the stored edge is the common `contains` or a hand-made `reads`,
  // the derivation must not add a duplicate — home_eid stays the one truth.
  assertEquals(homeReads([proj, spec], [edge(proj, 'reads', spec)]), [])
  assertEquals(homeReads([proj, spec], [edge(proj, 'contains', spec)]), [])
})

Deno.test('filesFor: common → AGENTS.md, others → personas/<slug>.md, fleet → nowhere', () => {
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
