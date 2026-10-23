// T-132217 repair: every `created.by` and `updated.by` that names a session
// is set to the actor that session works for, the one `speaking()` now
// stamps (@yaks/session `actorOf`). A session that names none is resolved
// the way `session_context` resolves one at its start: the persona its
// checkout carries (@yaks/persona `carried`), from the directory it ran in.
// A session with neither is no actor either, and its rows' `by` is cleared;
// `via` already names it.
//
//   deno run -A bin/repair-session-actors.ts <yak.json> plan <plan.jsonl>
//   deno run -A bin/repair-session-actors.ts <yak.json> write <plan.jsonl>
//   deno run -A bin/repair-session-actors.ts <yak.json> undo <plan.jsonl>
//
// Provenance keeps no journal history, so the plan is the undo: one line per
// row, its old `by` and its new one.

import { and, eq, fields, list } from '@yaks/query'
import { carried } from '@yaks/persona'
import { actorOf } from '@yaks/session'
import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'

import { opened } from '../packages/cli/local.ts'

let [config, mode, planPath] = Deno.args
let host = await opened(config, ['graph'], false, mode == 'plan')
let g: Graph = host.graph
let STAMPS = ['created', 'updated']
let BATCH = 400
let str = (v: unknown) => typeof v == 'string' ? v : ''
let chunks = <T>(xs: T[], n: number): T[][] =>
  Array.from(
    { length: Math.ceil(xs.length / n) },
    (_, i) => xs.slice(i * n, i * n + n),
  )

type Row = { eid: Eid; comp: string; from: Eid; to: Eid | null }

// The directory a session ran in, where the graph or its transcript says.
let cwdOf = async (s: Bundle): Promise<string> => {
  let home = str((s.home as Comp | undefined)?.cwd)
  if (home) return home
  let ran = str((s.process as Comp | undefined)?.cwd)
  if (ran) return ran
  let transcript = str((s.session as Comp | undefined)?.transcript)
  if (!transcript) return ''
  let [file] = await g.get([transcript], ['file'])
  let path = str((file?.file as Comp | undefined)?.path)
  if (!path) return ''
  try {
    let f = await Deno.open(path.startsWith('/') ? path : `/${path}`)
    let buf = new Uint8Array(256 * 1024)
    let n = await f.read(buf) ?? 0
    f.close()
    let head = new TextDecoder().decode(buf.subarray(0, n))
    return head.match(/"cwd"\s*:\s*"([^"]+)"/)?.[1] ?? ''
  } catch {
    return ''
  }
}

let actors = new Map<Eid, Eid | null>()
let why = new Map<string, number>()
let resolve = async (s: Eid): Promise<Eid | null> => {
  if (actors.has(s)) return actors.get(s)!
  let by = await actorOf(g, s)
  let how = 'actorOf'
  if (!by) {
    let [row] = await g.get([s], ['session', 'home', 'process'])
    let cwd = row ? await cwdOf(row) : ''
    let worn = cwd ? await carried(g, cwd) : undefined
    let persona = worn?.persona
    by = str((persona?.persona as Comp | undefined)?.home) ||
      persona?.entity.eid || undefined
    how = by ? 'checkout' : 'nobody'
  }
  why.set(how, (why.get(how) ?? 0) + 1)
  actors.set(s, by ?? null)
  return by ?? null
}

let plan = async (): Promise<Row[]> => {
  let sessions = (await g.read('.session .fields=entity.eid'))
    .map((b) => b.entity.eid)
  console.log(`sessions: ${sessions.length}`)
  let rows: Row[] = []
  for (let comp of STAMPS) {
    for (let some of chunks(sessions, 300)) {
      let found = await g.read(and(
        eq(`${comp}.by`, list(...some)),
        fields('entity.eid', `${comp}.by`),
      ))
      for (let b of found) {
        let from = str((b[comp] as Comp).by)
        rows.push({ eid: b.entity.eid, comp, from, to: await resolve(from) })
      }
    }
  }
  // A tombstone comes back holding whatever a write gives it, and an entity
  // holding nothing but its stamps (an entry stripped to nothing) is removed
  // by a write that gives it nothing else: leave both alone.
  let dead = new Set<Eid>()
  let husks = new Set<Eid>()
  let STAMPED = new Set(['entity', ...STAMPS])
  for (let some of chunks([...new Set(rows.map((r) => r.eid))], 500)) {
    for (let b of await g.get(some)) {
      if (b.tombstone != null) dead.add(b.entity.eid)
      else if (Object.keys(b).every((k) => STAMPED.has(k))) {
        husks.add(b.entity.eid)
      }
    }
  }
  console.log(`tombstoned, left alone: ${dead.size}`)
  console.log(`holding only stamps, left alone: ${husks.size}`)
  return rows.filter((r) => !dead.has(r.eid) && !husks.has(r.eid))
}

let write = async (rows: Row[], back = false) => {
  let done = 0
  for (let some of chunks(rows, BATCH)) {
    await g.apply(
      some.map((r) => ({
        entity: { eid: r.eid },
        [r.comp]: { by: back ? r.from : r.to },
      })),
      { trusted: true, stamp: false },
    )
    done += some.length
    if (done % 20000 < BATCH) console.log(`written ${done}/${rows.length}`)
  }
  return done
}

let tally = async (rows: Row[]) => {
  let by = new Map<string, number>()
  for (let r of rows) {
    by.set(r.to ?? '(cleared)', (by.get(r.to ?? '(cleared)') ?? 0) + 1)
  }
  for (let [to, n] of [...by].sort((a, b) => b[1] - a[1])) {
    let [b] = to.startsWith('(') ? [] : await g.get([to], ['doc'])
    console.log(`  ${n}\t${str((b?.doc as Comp | undefined)?.title) || to}`)
  }
  for (let comp of STAMPS) {
    console.log(`  ${comp}: ${rows.filter((r) => r.comp == comp).length}`)
  }
  console.log(
    `  sessions resolved by: ${JSON.stringify(Object.fromEntries(why))}`,
  )
}

if (mode == 'plan') {
  let rows = await plan()
  await Deno.writeTextFile(
    planPath,
    rows.map((r) => JSON.stringify(r)).join('\n') + '\n',
  )
  console.log(`rows: ${rows.length}`)
  await tally(rows)
} else if (mode == 'write' || mode == 'undo') {
  let rows: Row[] = (await Deno.readTextFile(planPath)).split('\n')
    .filter(Boolean).map((l) => JSON.parse(l))
  console.log(`${mode}: ${await write(rows, mode == 'undo')} rows`)
}
Deno.exit(0)
