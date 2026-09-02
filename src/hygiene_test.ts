// The dream hygiene pass against an in-memory graph: corpus candidate
// derivation, fleet-only error aggregation, proposal-only writes, and keyed
// readback/dedup. Model work is absent because this phase is deterministic.
Deno.env.set('DB_PATH', ':memory:')
let { apply } = await import('./db.ts')
let { db } = await import('./live_db.ts')
let {
  candidates,
  HARD_SCOPE,
  hygieneSweep,
  recurringErrors,
} = await import('./hygiene.ts')
let { hash, MODEL, textOf } = await import('./embed.ts')
let { record } = await import('./telemetry.ts')
let { ownVector, refreshVector } = await import('./vector.ts')
// This test process is the sole writer of its own :memory: graph, so it owns
// the quantize the way the embed sweep's process does (T-22622).
ownVector()
let { axes } = await import('./testvec.ts')
let { slow } = await import('./testing.ts')
let { assertEquals, assertStringIncludes } = await import('@std/assert')

let uid = () => crypto.randomUUID()
// The fixture is the owner's hand: a persona's composition and an accepted
// memory are a person's writes (db.ts apply); an anonymous memory lands
// proposed and reaches no tier, so the persona would never bloat.
let jeff = uid()
apply(db, [{ eid: jeff, name: 'person', comp: {} }])
let put = (changes: Parameters<typeof apply>[1]) =>
  apply(db, changes, undefined, jeff)
let ago = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString()

let project = (title: string, num?: number) => {
  let eid = uid()
  apply(db, [
    { eid, name: 'doc', comp: { title, body: '' } },
    { eid, name: 'project', comp: {} },
  ])
  if (num != null) {
    db.prepare('update entity set num = ? where eid = ?').run(num, eid)
  }
  return eid
}

let homeProject = () =>
  (db.prepare(
    `select e.eid from project p join entity e on e.id = p.entity
      where e.num = 19`,
  ).get() as { eid: string } | undefined)?.eid ??
    project('Task Graph hygiene home', 19)

let memory = (scope: string, title: string, body: string) => {
  let eid = uid()
  put([
    { eid, name: 'doc', comp: { title, body } },
    { eid, name: 'memory', comp: { scope } },
  ])
  db.prepare(
    `update created set at = ?
      where entity = (select id from entity where eid = ?)`,
  ).run(ago(100), eid)
  return eid
}

// knn() reads the last quantization and never writes one (T-22525), so an
// unquantized write is invisible to similar() until its owner quantizes it.
let putVec = (eid: string, text: string, vec: Float32Array) => {
  db.prepare(
    `insert into embedding (entity, model, hash, vec)
     values ((select id from entity where eid = ?), ?, ?, ?)`,
  ).run(eid, MODEL, hash(text), new Uint8Array(vec.buffer))
  refreshVector(db)
}

Deno.test('the hard scope is explicit about proposals, source edits, and readback', () => {
  assertStringIncludes(HARD_SCOPE, 'MAY:')
  assertStringIncludes(HARD_SCOPE, 'MUST NOT:')
  assertStringIncludes(HARD_SCOPE, 'reads each artifact back')
})

slow(
  'candidates: similar memories, cold retired scope, long prose, and persona bloat',
  () => {
    let p = project('Retired hygiene scope')
    apply(db, [{ eid: p, name: 'archived', comp: {} }])
    let body = 'long\n'.repeat(7000)
    let a = memory(p, 'first wording', body)
    let b = memory(p, 'second wording', 'same lesson')
    let vec = axes(0, 0, 0, 1)
    putVec(a, textOf('first wording', body), vec)
    putVec(b, textOf('second wording', 'same lesson'), vec)

    let persona = uid()
    put([
      { eid: persona, name: 'doc', comp: { title: 'Large persona', body: '' } },
      { eid: persona, name: 'persona', comp: { home: p } },
      {
        eid: persona,
        name: 'dependency',
        comp: { type: 'contains', child: a },
      },
    ])

    let got = candidates(p)
    assertEquals(got.some((c) => c.kind == 'merge'), true)
    assertEquals(
      got.some((c) => c.kind == 'archive' && c.targets[0] == a),
      true,
    )
    assertEquals(
      got.some((c) => c.kind == 'shorten' && c.targets[0] == a),
      true,
    )
    assertEquals(
      got.some((c) => c.kind == 'persona' && c.targets[0] == persona),
      true,
    )
    let fleet = candidates(homeProject())
    assertEquals(
      fleet.some((c) => c.kind == 'archive' && c.targets[0] == a),
      true,
    )
    assertEquals(
      fleet.some((c) => c.kind == 'persona' && c.targets[0] == persona),
      true,
    )
  },
)

slow(
  'recurring errors belong to the fleet home and stay one cohort each',
  () => {
    let home = homeProject()
    let other = project('Another venture')
    let name = `hygiene-${uid()}`
    for (let i = 0; i < 3; i++) {
      record(db, {
        source: 'mcp',
        name,
        ok: false,
        error: 'TypeError: repeated',
        detail: 'at run (dream.ts:1:2)',
      })
    }
    assertEquals(
      recurringErrors(home, ago(1)).some((r) => r.name == name),
      true,
    )
    assertEquals(recurringErrors(other, ago(1)), [])
  },
)

slow(
  'hygieneSweep counts memory candidates but files no review task',
  () => {
    let p = project('Proposal scope')
    memory(p, 'Verbose memory', 'x'.repeat(5000))
    let first = hygieneSweep(p, ago(1), () => {})
    assertEquals(first.candidates, 1)
    assertEquals(first.filed, 0)
    assertEquals(first.verified, [])
    let filed = db.prepare(
      `select count(*) as n from finding where key like 'hygiene:memory:%'`,
    ).get() as { n: number }
    assertEquals(filed.n, 0)
  },
)

slow(
  'hygieneSweep aggregates recurring error cohorts into one proposal task',
  () => {
    let home = homeProject()
    for (let suffix of ['a', 'b']) {
      for (let i = 0; i < 3; i++) {
        record(db, {
          source: 'cli',
          name: `aggregate-${suffix}`,
          ok: false,
          error: `Error: ${suffix}`,
        })
      }
    }
    let result = hygieneSweep(home, ago(1), () => {})
    assertEquals(result.errors >= 2, true)
    let count = db.prepare(
      `select count(*) as n from task t
      join finding f on f.entity = t.entity
     where f.key like 'hygiene:errors:%'`,
    ).get() as { n: number }
    assertEquals(count.n, 1)
  },
)
