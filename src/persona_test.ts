// The persona materializer, pure: rows+deps in, markdown out. One
// little graph builder writes many cases in few lines.
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { type Dep, type Edge, kindOf } from './types.ts'
import type { Row } from './client.ts'
import {
  adopted,
  commonOf,
  composeWorn,
  deliveredBy,
  DIALECT,
  homeReads,
  indexLine,
  materialize,
  wornPersona,
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
let edge = (parent: Row, type: Edge, child: Row, ord?: number): Dep => ({
  parent: parent.eid,
  type,
  child: child.eid,
  ...(ord == null ? {} : { ord }),
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

Deno.test('materialize: header and tiers in warmth order', () => {
  let all = [persona, warm, cold, indexed]
  let deps = [
    edge(persona, 'contains', cold),
    edge(persona, 'contains', warm),
    edge(persona, 'reads', indexed),
  ]
  let md = materialize(all, deps, persona, NOW)
  assertStringIncludes(md, `GENERATED from N-${persona.num}`)
  assertStringIncludes(md, `https://tasks.yak.sh/N-${persona.num}`)
  assert(!md.includes('Review sternly.'))
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
  assertStringIncludes(
    md,
    '---\n\n## Memory Index\n\n*Recall a body by id (MCP `memory_recall` / CLI `task show`).*',
  )
  assertStringIncludes(md, 'delegation discipline')
  assert(!md.includes('Worktrees only.'))
})

Deno.test('materialize: edge ord breaks a warmth tie, undeclared trails (T-12939)', () => {
  // Three equally-warm preloads: warmth can't order them, so today they'd
  // fall to whatever order the graph read hands back. A declared edge ord
  // pins an intentional listing (lower first); an undeclared member trails.
  let a = doc('alpha', 'ABODY.', 5)
  let b = doc('beta', 'BBODY.', 5)
  let c = doc('gamma', 'CBODY.', 5)
  let all = [persona, a, b, c]
  let deps = [
    edge(persona, 'contains', a, 2),
    edge(persona, 'contains', b, 1),
    edge(persona, 'contains', c), // undeclared → last among the tie
  ]
  let md = materialize(all, deps, persona, NOW)
  assert(md.indexOf('BBODY.') < md.indexOf('ABODY.'))
  assert(md.indexOf('ABODY.') < md.indexOf('CBODY.'))
  // ord is a TIE-break, never a warmth override: a warmer member with a
  // larger ord still leads a colder one with a smaller ord.
  let warmer = doc('hot', 'HOT.', 1)
  let md2 = materialize(
    [persona, warmer, a],
    [edge(persona, 'contains', warmer, 9), edge(persona, 'contains', a, 1)],
    persona,
    NOW,
  )
  assert(md2.indexOf('HOT.') < md2.indexOf('ABODY.'))
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

Deno.test('materialize: a bare persona is just its generated header', () => {
  let md = materialize([persona], [], persona, NOW)
  assert(!md.includes('---'))
  assert(!md.includes('## Memory Index'))
  assert(!md.includes('Review sternly.'))
})

Deno.test('materialize: persona descriptions never become prompt text', () => {
  let fm = row({
    doc: {
      title: 'operator',
      body: '---\nname: operator\ntools: Read, Grep\n---\n\nYou run the fleet.',
    },
    persona: { home: null },
  })
  // a preloaded memory's separator rule must not read as frontmatter
  let md = materialize([fm, warm], [edge(fm, 'contains', warm)], fm, NOW)
  assert(md.startsWith('<!-- GENERATED'))
  assert(!md.includes('name: operator'))
  assert(!md.includes('You run the fleet.'))
  assertStringIncludes(md, 'Use the front door.')
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
    doc: { title: 'base', body: 'BASE DESCRIPTION' },
    persona: { home: proj.eid },
  })
  let other = row({
    doc: { title: 'other', body: 'OTHER DESCRIPTION' },
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

// The personas a spawn wears (T-18382): COMPOSED base-first, not either/or —
// an explicit --persona rides ON TOP of the project base rather than dropping
// it; with neither, the global base is the floor.
Deno.test('wornPersona: composes project base + specific, deduped, floors on base', () => {
  let project = row({ doc: { title: 'Venture', body: '' }, project: {} })
  let common = row({
    doc: { title: 'Common', body: 'C.' },
    persona: { home: project.eid },
  })
  let other = row({
    doc: { title: 'Specialist', body: 'S.' },
    persona: { home: null },
  })
  let fleet = row({
    doc: { title: 'fleet base', body: '' },
    persona: { home: null },
  })
  // only the common persona is `contains`-ed by the project
  let deps = [edge(project, 'contains', common)]
  let all = [project, common, other, fleet]
  let eids = (rs: Row[]) => rs.map((r) => r.eid)

  // an explicit --persona wears the project base FIRST, then the specific one
  assertEquals(
    eids(wornPersona(all, deps, other.eid, project.eid, fleet.eid)),
    [common.eid, other.eid],
  )
  // an explicit persona that IS the project common appears once (deduped)
  assertEquals(
    eids(wornPersona(all, deps, common.eid, project.eid, fleet.eid)),
    [common.eid],
  )
  // no --persona wears just the project's common persona
  assertEquals(
    eids(wornPersona(all, deps, undefined, project.eid, fleet.eid)),
    [common.eid],
  )
  // no --persona and no project floors on the global base
  assertEquals(
    eids(wornPersona(all, deps, undefined, undefined, fleet.eid)),
    [fleet.eid],
  )
  // with no base to floor on either, it is finally bare
  assertEquals(wornPersona(all, deps, undefined, undefined, undefined), [])
})

// composeWorn folds the base personas UNDER the specific one, so a spawn wears
// base tiers + specialist tiers together — the compose-not-replace invariant.
Deno.test('composeWorn: an explicit specialist still carries project base + fleet base', () => {
  let project = row({ doc: { title: 'Venture', body: '' }, project: {} })
  let fleet = row({
    doc: { title: 'fleet base', body: '' },
    persona: { home: null },
  })
  let baseMem = mem('fleet rule', 'FLEETRULE.')
  let common = row({
    doc: { title: 'Common', body: '' },
    persona: { home: project.eid },
  })
  let specialist = row({
    doc: { title: 'coder', body: '' },
    persona: { home: null },
  })
  let specMem = mem('specialist rule', 'SPECRULE.')
  let deps = [
    edge(project, 'contains', common),
    edge(common, 'contains', fleet), // project common nests the fleet base
    edge(fleet, 'contains', baseMem),
    edge(specialist, 'contains', specMem),
  ]
  let all = [project, fleet, baseMem, common, specialist, specMem]
  let worn = wornPersona(all, deps, specialist.eid, project.eid, fleet.eid)
  let md = composeWorn(all, deps, worn, NOW)!
  // both the specialist's own memory AND the project base's fleet memory ride
  assertStringIncludes(md, 'SPECRULE.')
  assertStringIncludes(md, 'FLEETRULE.')
  // the header names the specific persona (the primary), not the base
  assertStringIncludes(md, `GENERATED from N-${specialist.num}`)
})

// A fleet-shared specialist wired to the fleet base (a stored contains edge)
// carries it even with NO project — the no-project floor the wiring provides.
Deno.test('composeWorn: a specialist wired to the fleet base carries it with no project', () => {
  let fleet = row({
    doc: { title: 'fleet base', body: '' },
    persona: { home: null },
  })
  let baseMem = mem('fleet rule', 'FLEETRULE.')
  let specialist = row({
    doc: { title: 'coder', body: '' },
    persona: { home: null },
  })
  let specMem = mem('specialist rule', 'SPECRULE.')
  let deps = [
    edge(fleet, 'contains', baseMem),
    edge(specialist, 'contains', fleet), // the wiring: specialist → fleet base
    edge(specialist, 'contains', specMem),
  ]
  let all = [fleet, baseMem, specialist, specMem]
  // no project, explicit specialist
  let worn = wornPersona(all, deps, specialist.eid, undefined, fleet.eid)
  assertEquals(worn.map((r) => r.eid), [specialist.eid])
  let md = composeWorn(all, deps, worn, NOW)!
  assertStringIncludes(md, 'SPECRULE.')
  assertStringIncludes(md, 'FLEETRULE.')
})

// T-21957: the base tier lands once however many doors deliver it.
Deno.test('composeWorn: a base reached through two doors renders once', () => {
  let project = row({ doc: { title: 'Venture', body: '' }, project: {} })
  let fleet = row({
    doc: { title: 'fleet base', body: '' },
    persona: { home: null },
  })
  let baseMem = mem('fleet rule', 'FLEETRULE.')
  let common = row({
    doc: { title: 'Common', body: '' },
    persona: { home: project.eid },
  })
  let role = row({
    doc: { title: 'scribe', body: '' },
    persona: { home: null },
  })
  let deps = [
    edge(project, 'contains', common),
    edge(common, 'contains', fleet),
    edge(role, 'contains', fleet), // the role embeds the base TOO
    edge(fleet, 'contains', baseMem),
  ]
  let all = [project, fleet, baseMem, common, role]
  let worn = wornPersona(all, deps, role.eid, project.eid, fleet.eid)
  let md = composeWorn(all, deps, worn, NOW)!
  assertEquals(md.split('FLEETRULE.').length - 1, 1)
})

Deno.test('materialize omit: tiers another file delivers drop, uniques stay', () => {
  let common = row({
    doc: { title: 'Common', body: '' },
    persona: { home: null },
  })
  let shared = mem('shared rule', 'SHAREDBODY.')
  let listed = row({
    doc: { title: 'listed only', body: 'LISTEDBODY.' },
    memory: {},
  })
  let upgraded = row({
    doc: { title: 'upgraded', body: 'UPGRADEDBODY.' },
    memory: {},
  })
  let role = row({
    doc: { title: 'scribe', body: '' },
    persona: { home: null },
  })
  let own = mem('role rule', 'OWNBODY.')
  let deps = [
    edge(common, 'contains', shared),
    edge(common, 'reads', listed),
    edge(common, 'reads', upgraded), // common only lists it
    edge(role, 'contains', shared), // delivered by common in full → drops
    edge(role, 'contains', own), // unique → stays
    edge(role, 'contains', upgraded), // preload is the fuller form → stays
    edge(role, 'reads', listed), // already listed by common → line drops
  ]
  let all = [common, shared, listed, upgraded, role, own]
  let said = deliveredBy(all, deps, common.eid, NOW)
  let md = materialize(all, deps, role, NOW, DIALECT, said)
  assert(!md.includes('SHAREDBODY.'))
  assertStringIncludes(md, 'OWNBODY.')
  assertStringIncludes(md, 'UPGRADEDBODY.')
  assert(!md.includes('listed only'))
  // without omit the same render is complete — the spawn-outside-a-repo form
  let whole = materialize(all, deps, role, NOW)
  assertStringIncludes(whole, 'SHAREDBODY.')
  assertStringIncludes(whole, 'listed only')
})

Deno.test('adopted: the CLAUDE.md symlink chain into .tasks, and only that', () => {
  let dir = Deno.makeTempDirSync()
  try {
    assertEquals(adopted(dir), false)
    Deno.mkdirSync(`${dir}/.tasks`)
    Deno.writeTextFileSync(`${dir}/.tasks/AGENTS.md`, 'persona\n')
    // a plain committed file is NOT adoption — the flip is the symlink
    Deno.writeTextFileSync(`${dir}/CLAUDE.md`, 'hand-written\n')
    assertEquals(adopted(dir), false)
    Deno.removeSync(`${dir}/CLAUDE.md`)
    Deno.symlinkSync(`${dir}/.tasks/AGENTS.md`, `${dir}/AGENTS.md`)
    Deno.symlinkSync('AGENTS.md', `${dir}/CLAUDE.md`) // the chained form
    assertEquals(adopted(dir), true)
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})

// An agent's memory lands proposed (db.ts apply) and is a suggestion until a
// person decides it: no tier carries it, the index marks it, and a declined
// one stays out for good.
Deno.test('tiers: a proposed memory reaches no prompt until a person accepts it', () => {
  let pending = row({
    doc: { title: 'agent idea', body: 'PENDING.' },
    memory: {},
    proposed: { at: day(1) },
  }, 1)
  let deps = [
    edge(persona, 'contains', pending),
    edge(persona, 'reads', pending),
  ]
  let md = materialize([persona, pending], deps, persona, NOW)
  assert(!md.includes('PENDING.'))
  assert(!md.includes('agent idea'))
  let decide = (verdict?: string) => ({
    ...pending,
    comps: { ...pending.comps, decided: { at: day(0), verdict } },
  })
  assertStringIncludes(
    materialize([persona, decide()], deps, persona, NOW),
    'PENDING.',
  )
  assert(
    !materialize([persona, decide('declined')], deps, persona, NOW)
      .includes('PENDING.'),
  )
  assertStringIncludes(indexLine(pending), '? agent idea')
  assert(!indexLine(decide()).includes('?'))
})

Deno.test('materialize: stable-first, identity-last (M-31946 §2)', () => {
  let project = row({ doc: { title: 'proj', body: '' }, project: {} })
  let common = row({
    doc: { title: 'proj common', body: '' },
    persona: { home: project.eid },
  })
  let docs = row({
    doc: { title: 'what this is', body: 'One SQLite graph.' },
    memory: { scope: project.eid },
  })
  let rule = row({
    doc: { title: 'how we work', body: 'Land with task land.' },
    memory: { scope: null },
  })
  let owner = row({ doc: { title: 'Jeff', body: '' }, person: {} })
  let said = row({
    doc: { title: 'owner direction', body: 'Signal over noise.' },
    memory: { scope: null },
    feedback: { by: owner.eid },
  })
  let me = row({
    doc: { title: 'operator', body: 'I run the graph.' },
    memory: { scope: project.eid },
  })
  let special = row({
    doc: { title: 'TaskMaster', body: '' },
    persona: { home: project.eid },
  })
  let goal = row({ doc: { title: 'reduce noise', body: '' }, goal: {} })
  let all = [project, common, docs, rule, said, me, special, goal, owner]
  let deps = [
    edge(project, 'contains', common),
    edge(common, 'contains', rule, 0),
    edge(common, 'contains', said, 1),
    edge(common, 'contains', docs, 2),
    edge(special, 'contains', me, 0),
    edge(special, 'contains', common, 1),
  ]
  let at = (md: string, s: string) => {
    let i = md.indexOf(s)
    assert(i >= 0, `missing ${s}`)
    return i
  }
  // The specialist: project docs, then the owner's words and goals, then the
  // fleet's rules, and only then who it is — whatever the edge order said.
  let md = materialize(all, deps, special, NOW)
  assert(at(md, 'One SQLite graph.') < at(md, 'Signal over noise.'))
  assert(at(md, 'Signal over noise.') < at(md, '## Goals\n\n- V-'))
  assert(at(md, '## Goals') < at(md, 'Land with task land.'))
  assert(at(md, 'Land with task land.') < at(md, 'I run the graph.'))
  // The common persona alone reads the same way and says nothing of identity.
  let cm = materialize(all, deps, common, NOW)
  assert(at(cm, 'One SQLite graph.') < at(cm, 'Signal over noise.'))
  assert(at(cm, '## Goals') < at(cm, 'Land with task land.'))
  assert(!cm.includes('I run the graph.'))
  // A goal scoped elsewhere stays out.
  let far = row({ doc: { title: 'far goal', body: '' }, goal: { scope: 'x' } })
  assert(!materialize([...all, far], deps, special, NOW).includes('far goal'))
})

// The owner's direction reaches most personas through a base BUNDLE rather
// than a direct edge, and an agent's own recorded correction wears `feedback`
// too — so the band is decided by the author, at any depth.
Deno.test('materialize: the owner speaks first, however deep the bundle', () => {
  let project = row({ doc: { title: 'proj', body: '' }, project: {} })
  let owner = row({ doc: { title: 'Jeff', body: '' }, person: {} })
  let base = row({ doc: { title: 'fleet base', body: '' }, persona: {} })
  let common = row({
    doc: { title: 'proj common', body: '' },
    persona: { home: project.eid },
  })
  let said = row({
    doc: { title: 'owner direction', body: 'Signal over noise.' },
    memory: { scope: null },
    feedback: { by: owner.eid },
  })
  // An agent recorded this one, so it is a working rule wearing `feedback`.
  let noted = row({
    doc: { title: 'a rule we learned', body: 'Land with task land.' },
    memory: { scope: null },
    feedback: { by: project.eid },
  })
  let all = [project, owner, base, common, said, noted]
  let deps = [
    edge(project, 'contains', common),
    edge(common, 'contains', base),
    // Authored order puts the rule first; the band must still outrank it.
    edge(base, 'contains', noted, 0),
    edge(base, 'contains', said, 1),
  ]
  let md = materialize(all, deps, common, NOW)
  let at = (s: string) => {
    let i = md.indexOf(s)
    assert(i >= 0, `missing ${s}`)
    return i
  }
  assert(at('Signal over noise.') < at('Land with task land.'))
})
