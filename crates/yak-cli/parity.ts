// Cross-language parity for the kernel write path (T-22550): the same
// batches run through TS apply() on copy A and through `yak apply` on
// copy B of one migrated fixture graph; the journal rows and every touched
// table must come out identical (timestamps and the conflict audit's random
// eid normalized). Refusal batches must refuse on BOTH sides and leave both
// copies equally untouched.
//
//   deno run -A crates/yak-cli/parity.ts   (builds yak if missing)
//
// A slow harness by design — run it by hand or from the slow tier, never the
// 1ms gate.
import { apply } from '../../src/db.ts'
import { open } from '../../src/store/sqlite.ts'
import { fed } from '../../src/effects.ts'
import type { Change } from '../../src/types.ts'

let tmp = await Deno.makeTempDir({ prefix: 'parity-' })
let baseDb = `${tmp}/base.db`
let aDb = `${tmp}/a.db`
let bDb = `${tmp}/b.db`

// ---- fixture entities (stable uuids so both sides speak the same names) ----
let P = 'bbbbbbbb-0000-4000-8000-000000000001' // project
let S1 = 'bbbbbbbb-0000-4000-8000-000000000002' // session one
let S2 = 'bbbbbbbb-0000-4000-8000-000000000003' // session two
let T = 'bbbbbbbb-0000-4000-8000-000000000004' // a base task
let E1 = 'bbbbbbbb-0000-4000-8000-000000000011' // the task under test
let C1 = 'bbbbbbbb-0000-4000-8000-000000000012' // a comment on it
let A1 = 'bbbbbbbb-0000-4000-8000-000000000013' // alias holder
let A2 = 'bbbbbbbb-0000-4000-8000-000000000014' // alias challenger
let R1 = 'bbbbbbbb-0000-4000-8000-000000000015' // a repo (bool binding)
let KNOWN = new Set([P, S1, S2, T, E1, C1, A1, A2, R1])

{
  let db = open(baseDb)
  apply(db, [
    { eid: P, name: 'doc', comp: { title: 'Parity project' } },
    { eid: P, name: 'project', comp: {} },
    { eid: S1, name: 'session', comp: { id: 'parity-sess-1' } },
    { eid: S2, name: 'session', comp: { id: 'parity-sess-2' } },
    { eid: T, name: 'doc', comp: { title: 'Base task' } },
    { eid: T, name: 'task', comp: {} },
  ])
  db.exec('pragma wal_checkpoint(truncate)')
  db.close()
}
await Deno.copyFile(baseDb, aDb)
await Deno.copyFile(baseDb, bDb)

// sha of 'Parity task' for the was-guard round trip
import { sha } from '../../src/sha.ts'

type Case = { name: string; batch: Change[]; refuses?: boolean }
let cases: Case[] = [
  {
    name: 'create doc+task with project ref',
    batch: [
      { eid: E1, name: 'doc', comp: { title: 'Parity task', body: 'b' } },
      {
        eid: E1,
        name: 'task',
        comp: { priority: 2, project: P },
      },
    ],
  },
  {
    name: 'link and unlink an edge',
    batch: [
      { eid: E1, name: 'dependency', comp: { type: 'requires', child: T } },
    ],
  },
  {
    name: 'guarded patch (was passes)',
    batch: [
      {
        eid: E1,
        name: 'doc',
        comp: { title: 'Parity task v2' },
        was: { title: sha('Parity task') },
      },
    ],
  },
  {
    name: 'claim by session one (worked edge + wip drag)',
    batch: [{ eid: E1, name: 'claim', comp: { session: S1 } }],
  },
  {
    name: 'REFUSE: second session bounces (conflict audit)',
    batch: [{ eid: E1, name: 'claim', comp: { session: S2 } }],
    refuses: true,
  },
  {
    name: 'REFUSE: stale was',
    batch: [
      {
        eid: E1,
        name: 'doc',
        comp: { title: 'v3' },
        was: { title: sha('Parity task') },
      },
    ],
    refuses: true,
  },
  {
    name: 'REFUSE: unknown column',
    batch: [{ eid: E1, name: 'task', comp: { statuss: 'done' } }],
    refuses: true,
  },
  {
    name: 'server-owned comp drops silently',
    batch: [{ eid: E1, name: 'resume', comp: { rank: 1 } }],
  },
  {
    name: 'bool binding via repo.push',
    batch: [
      { eid: R1, name: 'doc', comp: { title: 'A repo' } },
      { eid: R1, name: 'repo', comp: { path: '/x', push: true } },
    ],
  },
  {
    name: 'alias landed',
    batch: [
      { eid: A1, name: 'doc', comp: { title: 'alias holder' } },
      { eid: A1, name: 'alias', comp: { slug: 'parity-x' } },
    ],
  },
  {
    name: 'REFUSE: alias taken',
    batch: [
      { eid: A2, name: 'doc', comp: { title: 'challenger' } },
      { eid: A2, name: 'alias', comp: { slug: 'parity-x' } },
    ],
    refuses: true,
  },
  {
    name: 'comment aimed at the task',
    batch: [
      { eid: C1, name: 'doc', comp: { body: 'a note' } },
      { eid: C1, name: 'comment', comp: { target: E1 } },
    ],
  },
  {
    name: 'delete cascades (comment dies, claim releases)',
    batch: [{ eid: E1, name: 'entity', comp: null }],
  },
]

// ---- TS side over copy A ----
let dbA = open(aDb)
let tsErrs: (string | null)[] = []
for (let c of cases) {
  try {
    apply(dbA, structuredClone(c.batch), fed(), null)
    tsErrs.push(null)
  } catch (e) {
    tsErrs.push(e instanceof Error ? e.message : String(e))
  }
}
dbA.exec('pragma wal_checkpoint(truncate)')
dbA.close()

// ---- Rust side over copy B ----
let bin = new URL('../../target/release/yak', import.meta.url).pathname
try {
  await Deno.stat(bin)
} catch {
  let build = new Deno.Command('cargo', {
    args: ['build', '--release'],
    cwd: new URL('.', import.meta.url).pathname,
  })
  let out = await build.output()
  if (!out.success) {
    console.error(new TextDecoder().decode(out.stderr))
    Deno.exit(2)
  }
}
let rsErrs: (string | null)[] = []
for (let c of cases) {
  let run = new Deno.Command(bin, {
    args: ['apply', '--db', bDb, '--fed', '--batch', JSON.stringify(c.batch)],
  })
  let out = await run.output()
  rsErrs.push(out.success ? null : new TextDecoder().decode(out.stderr).trim())
}

// ---- compare ----
let failures: string[] = []
for (let i = 0; i < cases.length; i++) {
  let want = !!cases[i].refuses
  if (want != (tsErrs[i] != null)) {
    failures.push(
      `TS ${want ? 'accepted' : 'refused'} '${cases[i].name}': ${tsErrs[i]}`,
    )
  }
  if (want != (rsErrs[i] != null)) {
    failures.push(
      `RS ${want ? 'accepted' : 'refused'} '${cases[i].name}': ${rsErrs[i]}`,
    )
  }
}

let ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[.\d]*Z?/g
let UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g
let norm = (v: unknown): unknown => {
  if (typeof v == 'string') {
    return v
      .replaceAll(ISO, 'TS')
      .replaceAll(UUID, (u) => (KNOWN.has(u) ? u : 'RANDOM'))
  }
  if (Array.isArray(v)) return v.map(norm)
  if (v && typeof v == 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map((
        [k, x],
      ) => [k, norm(x)]),
    )
  }
  return v
}

let TABLES = [
  'entity',
  'tombstone',
  'dependency',
  'doc',
  'task',
  'project',
  'repo',
  'session',
  'claim',
  'conflict',
  'comment',
  'alias',
  'created',
  'updated',
  'journal_tx',
  'journal_change',
  'journal_field',
]
import { DatabaseSync } from 'node:sqlite'
let dump = (path: string) => {
  let db = new DatabaseSync(path, { readOnly: true })
  let out: Record<string, unknown[]> = {}
  for (let t of TABLES) {
    out[t] = db.prepare(`select rowid as __r, * from "${t}" order by rowid`)
      .all()
      .map((row) => norm(JSON.parse(JSON.stringify(row))))
  }
  db.close()
  return out
}
let a = dump(aDb)
let b = dump(bDb)
for (let t of TABLES) {
  let rowsA = a[t]
  let rowsB = b[t]
  if (rowsA.length != rowsB.length) {
    failures.push(
      `table ${t}: ${rowsA.length} rows (TS) vs ${rowsB.length} (RS)`,
    )
  }
  for (let i = 0; i < Math.min(rowsA.length, rowsB.length); i++) {
    let ja = JSON.stringify(rowsA[i])
    let jb = JSON.stringify(rowsB[i])
    if (ja == jb) continue
    let cut = 0
    while (cut < ja.length && ja[cut] == jb[cut]) cut++
    failures.push(
      `table ${t} row ${i} diverges at char ${cut}\n` +
        `  TS: …${ja.slice(Math.max(0, cut - 80), cut + 240)}\n` +
        `  RS: …${jb.slice(Math.max(0, cut - 80), cut + 240)}`,
    )
  }
}

if (failures.length) {
  console.error(`PARITY FAIL (${failures.length}):`)
  for (let f of failures) console.error('---\n' + f)
  Deno.exit(1)
}
console.log(
  `PARITY OK — ${cases.length} cases (${
    cases.filter((c) => c.refuses).length
  } refusals), ${TABLES.length} tables identical after normalization`,
)
await Deno.remove(tmp, { recursive: true })
