// The persona materializer, pure: rows+deps in, markdown out. One
// little graph builder writes many cases in few lines; syncFiles gets a
// temp dir (never a repo). The server effect and the CLI verb render
// through these same functions, so what passes here is what lands on
// disk everywhere.
import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from '@std/assert'
import { type Dep, type Edge, kindOf } from './types.ts'
import { projectionSnapshot, type Row, rows } from './client.ts'
import { fakeGraph } from './graph_fake.ts'
import {
  commonOf,
  DIALECT,
  filesFor,
  homeReads,
  indexLine,
  materialize,
  orphans,
  projection,
  syncFiles,
  taskRoots,
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
// homeReads takes the homes, not the graph — off the persona table in the
// server, off a hand-made graph here.
let homes = (all: Row[]) =>
  all.map((r) => ({ eid: r.eid, home: r.comps.persona?.home }))

let persona = row({
  doc: { title: 'graybeard', body: 'Review sternly.' },
  persona: { home: null },
})
let warm = doc('fresh lesson', 'Use the front door.', 1)
let cold = doc(
  'old lesson',
  'Mind the gap.\n\n## Trust tiers\n\nAsk before crossing.',
  60,
)
let indexed = row({
  doc: { title: 'delegation discipline', body: 'Worktrees only.' },
  memory: { last_confirmed_at: day(3) },
  feedback: {},
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

Deno.test('projection queries only persona neighborhoods', async () => {
  let project = row({
    doc: { title: 'Venture', body: '' },
    project: {},
    repo: { path: '/tmp/persona-query-test', push: 0 },
  })
  let voice = row({
    doc: { title: 'Voice', body: 'Core.' },
    persona: { home: project.eid },
    alias: { slug: 'voice' },
  })
  let lesson = doc('Lesson', 'Keep it small.')
  let deps = [
    edge(project, 'contains', voice),
    edge(voice, 'contains', lesson),
  ]
  let all = [project, voice, lesson]
  let snap = {
    changes: all.flatMap((r) =>
      Object.entries(r.comps).map(([name, comp]) => ({
        eid: r.eid,
        name,
        comp: name == 'entity' ? { ...comp, eid: r.eid } : comp,
      }))
    ),
    deps,
  }
  let { server, seen, host } = fakeGraph(snap)
  let was = Deno.env.get('TASKS_HOST')
  Deno.env.set('TASKS_HOST', host)
  try {
    let narrow = await projectionSnapshot()
    assertEquals(
      filesFor(rows(narrow), narrow.deps, NOW),
      filesFor(all, deps, NOW),
    )
    assertEquals(seen.some((path) => path.startsWith('/snapshot')), false)
  } finally {
    if (was) Deno.env.set('TASKS_HOST', was)
    else Deno.env.delete('TASKS_HOST')
    await server.shutdown()
  }
})

// Nesting: a persona that contains another persona inherits its memories.
let base = () =>
  row({
    doc: { title: 'fleet base', body: 'shared' },
    persona: { home: null },
  })
let mem = (title: string, body: string, daysOld = 0) =>
  doc(title, body, daysOld)

Deno.test('materialize: a contained persona inherits its tiers, association kept', () => {
  let host = row({
    doc: { title: 'host', body: 'core.' },
    persona: { home: null },
  })
  let b = base()
  let pre = mem('bundled preload', 'Preload body.')
  let idx = row({
    doc: { title: 'bundled index', body: 'Index body.' },
    memory: {},
  })
  let all = [host, b, pre, idx]
  let deps = [
    edge(host, 'contains', b), // host contains the base persona
    edge(b, 'contains', pre), // base preloads a memory
    edge(b, 'reads', idx), // base indexes a memory
  ]
  let md = materialize(all, deps, host, NOW)
  // the base's contains-memory flows into the HOST's preload (full body)
  assertStringIncludes(md, `# D-${pre.num} bundled preload\n\n`)
  assertStringIncludes(md, 'Preload body.')
  // the base's reads-memory flows into the HOST's index (line only)
  assertStringIncludes(md, '## Memory Index')
  assertStringIncludes(md, `- M-${idx.num} bundled index`)
  assert(!md.includes('Index body.'))
  // the base persona itself is never rendered as a memory (no title, no body)
  assert(!md.includes('fleet base'))
  assert(!md.includes('shared'))
})

Deno.test('materialize: nesting is transitive — a base may contain a base', () => {
  let host = row({
    doc: { title: 'host', body: 'c' },
    persona: { home: null },
  })
  let mid = base()
  let deep = base()
  let m = mem('deep memory', 'Deep body.')
  let all = [host, mid, deep, m]
  let deps = [
    edge(host, 'contains', mid),
    edge(mid, 'contains', deep),
    edge(deep, 'contains', m),
  ]
  let md = materialize(all, deps, host, NOW)
  assertStringIncludes(md, `# D-${m.num} deep memory\n\n`)
})

Deno.test('materialize: a memory reachable by two paths is deduped', () => {
  let host = row({
    doc: { title: 'host', body: 'c' },
    persona: { home: null },
  })
  let b1 = base()
  let b2 = base()
  let m = mem('shared once', 'ONLYONCE.')
  let all = [host, b1, b2, m]
  let deps = [
    edge(host, 'contains', m), // direct
    edge(host, 'contains', b1),
    edge(host, 'contains', b2),
    edge(b1, 'contains', m), // via b1
    edge(b2, 'contains', m), // via b2
  ]
  let md = materialize(all, deps, host, NOW)
  assertEquals(md.match(/ONLYONCE\./g)?.length, 1)
})

Deno.test('materialize: preload wins over index for the same memory', () => {
  let host = row({
    doc: { title: 'host', body: 'c' },
    persona: { home: null },
  })
  let b = base()
  let m = mem('both tiers', 'FULLBODY.')
  let all = [host, b, m]
  let deps = [
    edge(host, 'contains', m), // preload
    edge(host, 'reads', b),
    edge(b, 'reads', m), // index via the base
  ]
  let md = materialize(all, deps, host, NOW)
  // rendered preloaded (full body), and never also as an index line
  assertStringIncludes(md, `# D-${m.num} both tiers\n\n`)
  assertStringIncludes(md, 'FULLBODY.')
  assert(!md.includes('## Memory Index'))
})

Deno.test('materialize: a persona cycle terminates', () => {
  let a = row({ doc: { title: 'a', body: 'ca' }, persona: { home: null } })
  let b = row({ doc: { title: 'b', body: 'cb' }, persona: { home: null } })
  let m = mem('in the loop', 'LOOPBODY.')
  let all = [a, b, m]
  let deps = [
    edge(a, 'contains', b),
    edge(b, 'contains', a), // cycle
    edge(a, 'contains', m),
  ]
  let md = materialize(all, deps, a, NOW)
  assertStringIncludes(md, 'LOOPBODY.')
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
    persona: { home: null },
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

Deno.test('indexLine: id, feedback tag, count, confirmed date — never warmth', () => {
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
    persona: { home: proj.eid },
  })
  let other = row({
    doc: { title: 'other', body: 'o' },
    persona: { home: proj.eid },
  })
  let all = [proj, base, other]
  assertEquals(commonOf(all, [edge(proj, 'contains', base)], proj.eid), base)
  // no contains edge → no common persona, however many call it home
  assertEquals(commonOf(all, [], proj.eid), undefined)
})

Deno.test('homeReads: specialists derive project→persona reads from home', () => {
  let proj = row({ project: {}, doc: { title: 'Holdco' } })
  let base = row({ doc: { title: 'base' }, persona: { home: proj.eid } })
  let spec = row({
    doc: { title: 'reviewer' },
    persona: { home: proj.eid },
  })
  let fleet = row({ doc: { title: 'graybeard' }, persona: { home: null } })
  let all = [proj, base, spec, fleet]
  // base is the common persona (contains), so only the specialist derives an
  // edge; a homeless fleet persona is nobody's specialist.
  assertEquals(homeReads(homes(all), [edge(proj, 'contains', base)]), [
    { parent: proj.eid, type: 'reads', child: spec.eid },
  ])
})

Deno.test('homeReads: a stored edge from home is left alone (no double sentence)', () => {
  let proj = row({ project: {}, doc: { title: 'Holdco' } })
  let spec = row({
    doc: { title: 'reviewer' },
    persona: { home: proj.eid },
  })
  // whether the stored edge is the common `contains` or a hand-made `reads`,
  // the derivation must not add a duplicate — home stays the one truth.
  assertEquals(homeReads(homes([proj, spec]), [edge(proj, 'reads', spec)]), [])
  assertEquals(
    homeReads(homes([proj, spec]), [edge(proj, 'contains', spec)]),
    [],
  )
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
    persona: { home: proj.eid },
  })
  let other = row({
    doc: { title: 'other', body: 'o' },
    persona: { home: proj.eid },
    alias: { slug: 'reviewer' },
  })
  let fleet = row({
    doc: { title: 'graybeard', body: 'g' },
    persona: { home: null },
  })
  let stray = row({
    doc: { title: 'stray', body: 's' },
    persona: { home: homeless.eid },
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
  // Every file carries its venture's push permission, and a venture that
  // never granted one grants none — git.ts reads this and nothing else.
  assertEquals(files.map((f) => f.push), [false, false])
  proj.comps.repo.push = 1
  let granted = filesFor([proj, base], [edge(proj, 'contains', base)], NOW)
  assertEquals(granted.map((f) => f.push), [true])
})

Deno.test('syncFiles: writes changes, skips fresh, isolates failures', () => {
  let dir = Deno.makeTempDirSync()
  try {
    let f = { path: `${dir}/deep/AGENTS.md`, body: 'one\n' }
    assertEquals(syncFiles([f]).written, [f.path])
    assertEquals(Deno.readTextFileSync(f.path), 'one\n')
    // unchanged → untouched (no churn for git status to see)
    assertEquals(syncFiles([f]), { written: [], removed: [], failed: [] })
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

Deno.test('filesFor / taskRoots: a retired venture is neither written nor swept', () => {
  let proj = row({
    project: { retired_at: day(1) },
    doc: { title: 'V' },
    repo: { path: '/repo' },
  })
  let base = row({
    doc: { title: 'base', body: 'b' },
    persona: { home: proj.eid },
  })
  let deps = [edge(proj, 'contains', base)]
  assertEquals(filesFor([proj, base], deps, NOW), [])
  assertEquals(taskRoots([proj, base]), [])
})

Deno.test('taskRoots: active ventures only, carrying push', () => {
  let live = row({
    project: {},
    doc: { title: 'L' },
    repo: { path: '/a', push: 1 },
  })
  let noPush = row({ project: {}, doc: { title: 'N' }, repo: { path: '/b' } })
  let noRepo = row({ project: {}, doc: { title: 'H' } })
  assertEquals(taskRoots([live, noPush, noRepo]), [
    { root: '/a/.tasks', push: true },
    { root: '/b/.tasks', push: false },
  ])
})

Deno.test('orphans: a held file absent from the render is a null-body delete', () => {
  let dir = Deno.makeTempDirSync()
  try {
    Deno.mkdirSync(`${dir}/.tasks/personas`, { recursive: true })
    Deno.writeTextFileSync(`${dir}/.tasks/AGENTS.md`, 'a')
    Deno.writeTextFileSync(`${dir}/.tasks/personas/gone.md`, 'g')
    Deno.writeTextFileSync(`${dir}/.tasks/personas/keep.md`, 'k')
    let roots = [{ root: `${dir}/.tasks`, push: false }]
    let keep = [
      { path: `${dir}/.tasks/AGENTS.md` },
      { path: `${dir}/.tasks/personas/keep.md` },
    ]
    assertEquals(orphans(roots, keep), [
      { path: `${dir}/.tasks/personas/gone.md`, body: null, push: false },
    ])
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})

Deno.test('syncFiles: a null body un-writes; a write leaves no temp litter', () => {
  let dir = Deno.makeTempDirSync()
  try {
    let p = `${dir}/AGENTS.md`
    syncFiles([{ path: p, body: 'x\n' }])
    // the write landed whole (temp + rename) and left nothing beside it
    assertEquals(Deno.readTextFileSync(p), 'x\n')
    assertEquals([...Deno.readDirSync(dir)].map((e) => e.name), ['AGENTS.md'])
    // a null body removes it
    assertEquals(syncFiles([{ path: p, body: null }]).removed, [p])
    assertThrows(() => Deno.statSync(p))
    // removing an already-gone path is a no-op, never a failure
    assertEquals(syncFiles([{ path: p, body: null }]), {
      written: [],
      removed: [],
      failed: [],
    })
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})

Deno.test('projection: a renamed slug orphans the old file; sync removes it', () => {
  let dir = Deno.makeTempDirSync()
  try {
    let proj = row({ project: {}, doc: { title: 'V' }, repo: { path: dir } })
    let base = row({
      doc: { title: 'base', body: 'b' },
      persona: { home: proj.eid },
    })
    let spec = row({
      doc: { title: 'rev', body: 'r' },
      persona: { home: proj.eid },
      alias: { slug: 'old' },
    })
    let all = [proj, base, spec]
    let deps = [edge(proj, 'contains', base)]
    syncFiles(projection(all, deps, NOW))
    assert(Deno.readTextFileSync(`${dir}/.tasks/personas/old.md`).length > 0)
    // rename the slug: old.md is now an orphan, new.md is what the render wants
    spec.comps.alias.slug = 'new'
    let plan = projection(all, deps, NOW)
    assert(
      plan.some((f) => f.path.endsWith('/personas/old.md') && f.body == null),
    )
    let { written, removed } = syncFiles(plan)
    assert(removed.includes(`${dir}/.tasks/personas/old.md`))
    assert(written.includes(`${dir}/.tasks/personas/new.md`))
    assertThrows(() => Deno.statSync(`${dir}/.tasks/personas/old.md`))
    assert(Deno.readTextFileSync(`${dir}/.tasks/personas/new.md`).length > 0)
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})

Deno.test('projection: a deleted persona orphans its file; AGENTS.md untouched', () => {
  let dir = Deno.makeTempDirSync()
  try {
    let proj = row({ project: {}, doc: { title: 'V' }, repo: { path: dir } })
    let base = row({
      doc: { title: 'base', body: 'b' },
      persona: { home: proj.eid },
    })
    let spec = row({
      doc: { title: 'rev', body: 'r' },
      persona: { home: proj.eid },
      alias: { slug: 'spec' },
    })
    let deps = [edge(proj, 'contains', base)]
    syncFiles(projection([proj, base, spec], deps, NOW))
    assert(Deno.readTextFileSync(`${dir}/.tasks/personas/spec.md`).length > 0)
    // spec deleted from the graph — its file is an orphan under a dir we own
    let { removed } = syncFiles(projection([proj, base], deps, NOW))
    assert(removed.includes(`${dir}/.tasks/personas/spec.md`))
    assertThrows(() => Deno.statSync(`${dir}/.tasks/personas/spec.md`))
    // the surviving common persona's file is left alone
    assert(Deno.readTextFileSync(`${dir}/.tasks/AGENTS.md`).length > 0)
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})
