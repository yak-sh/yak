// T-132217, second pass: rows a session wrote name its persona.
//
// The first pass (~/.yak/migrations/T-132217-by.jsonl) set each `by` that
// named a session to the project the session worked for; the owner's word is
// that the persona is the actor. This pass sets those rows, and the rows the
// project-first code stamped while it was live, to the session's persona:
// `actorOf` (persona first), else the persona its checkout carries, else the
// persona of the session that started it. A session with no persona keeps
// `actorOf`'s fallback, or nothing.
//
//   deno run -A bin/persona-session-actors.ts <yak.json> plan <out.jsonl> <since>
//   deno run -A bin/persona-session-actors.ts <yak.json> write <out.jsonl>
//   deno run -A bin/persona-session-actors.ts <yak.json> undo <out.jsonl>
//   deno run -A bin/persona-session-actors.ts <yak.json> marks <out.jsonl>
//
// `marks` plans the sweep of every other stamp still naming a session
// (`created`, `updated` and each mark's `by`); `write` and `undo` take
// either plan.

import { and, eq, fields, ge, list } from '@yaks/query'
import { carried } from '@yaks/persona'
import { actorOf } from '@yaks/session'
import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'

import { opened } from '../packages/cli/local.ts'
const FIRST = '/home/yaks/.yak/migrations/T-132217-by.jsonl'

let [config, mode, out, since] = Deno.args
let host = await opened(
  config,
  ['graph'],
  false,
  mode == 'plan' || mode == 'marks',
)
let g: Graph = host.graph
let str = (v: unknown) => typeof v == 'string' ? v : ''
let chunks = <T>(xs: T[], n: number): T[][] =>
  Array.from(
    { length: Math.ceil(xs.length / n) },
    (_, i) => xs.slice(i * n, i * n + n),
  )

type First = { eid: Eid; comp: string; from: Eid; to: Eid | null }
type Row = {
  eid: Eid
  comp: string
  session: Eid
  from: Eid | null
  to: Eid | null
}

let first: First[] = (await Deno.readTextFile(FIRST)).split('\n')
  .filter(Boolean).map((l) => JSON.parse(l))
// Who made each session, as its row said before the first pass.
let maker = new Map<Eid, Eid>()
for (let r of first) if (r.comp == 'created') maker.set(r.eid, r.from)

let kinds = new Map<Eid, string>()
let persona = async (e: Eid | undefined) =>
  !!e && !!(await g.get([e], ['persona']))[0]?.persona

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

let resolved = new Map<Eid, Eid | null>()
let resolve = async (s: Eid, depth = 0): Promise<Eid | null> => {
  if (resolved.has(s)) return resolved.get(s)!
  let by = await actorOf(g, s)
  let how = 'persona'
  if (!await persona(by)) {
    let [row] = await g.get([s], ['session', 'home', 'process'])
    let cwd = row ? await cwdOf(row) : ''
    let worn = cwd ? (await carried(g, cwd))?.persona.entity.eid : undefined
    let made = maker.get(s)
    let parent = !worn && made && depth < 8 && made != s &&
        (await g.get([made], ['session']))[0]?.session
      ? await resolve(made, depth + 1)
      : null
    if (worn) [by, how] = [worn, 'checkout persona']
    else if (await persona(parent ?? undefined)) {
      ;[by, how] = [parent!, 'maker persona']
    } else how = by ? 'fallback (no persona)' : 'nothing'
  }
  kinds.set(s, how)
  resolved.set(s, by ?? null)
  return by ?? null
}

let current = async (rows: { eid: Eid; comp: string }[]) => {
  let now = new Map<string, Eid | null>()
  for (let comp of ['created', 'updated']) {
    let eids = rows.filter((r) => r.comp == comp).map((r) => r.eid)
    for (let some of chunks(eids, 500)) {
      for (let b of await g.get(some, [comp, 'tombstone'])) {
        if (b.tombstone != null) continue
        now.set(`${comp} ${b.entity.eid}`, str((b[comp] as Comp)?.by) || null)
      }
    }
  }
  return now
}

let plan = async (): Promise<Row[]> => {
  let rows: Row[] = []
  // The first pass's rows, where they still hold what it wrote.
  let now = await current(first)
  let moved = 0
  for (let r of first) {
    let key = `${r.comp} ${r.eid}`
    if (!now.has(key) || now.get(key) != r.to) {
      moved++
      continue
    }
    rows.push({ ...r, session: r.from, from: r.to, to: await resolve(r.from) })
  }
  console.log(`first pass rows moved since, left alone: ${moved}`)
  // What the project-first code stamped while it was live: a session's write
  // whose `by` is a project.
  let projects = new Set(
    (await g.read('.project .fields=entity.eid')).map((b) => b.entity.eid),
  )
  let seen = new Set(rows.map((r) => `${r.comp} ${r.eid}`))
  let interim = 0
  for (let comp of ['created', 'updated']) {
    let found = await g.read(and(
      ge(`${comp}.at`, since),
      eq(`${comp}.by`, list(...projects)),
      fields('entity.eid', `${comp}.by`, `${comp}.via`),
    ))
    for (let b of found) {
      let c = b[comp] as Comp
      let via = str(c.via)
      if (!via || seen.has(`${comp} ${b.entity.eid}`)) continue
      if (!(await g.get([via], ['session']))[0]?.session) continue
      interim++
      rows.push({
        eid: b.entity.eid,
        comp,
        session: via,
        from: str(c.by),
        to: await resolve(via),
      })
    }
  }
  console.log(`rows the project-first code stamped: ${interim}`)
  // An entity holding nothing but its stamps is removed by a write that gives
  // it nothing else: leave it.
  let husks = new Set<Eid>()
  let STAMPED = new Set(['entity', 'created', 'updated'])
  for (let some of chunks([...new Set(rows.map((r) => r.eid))], 500)) {
    for (let b of await g.get(some)) {
      if (Object.keys(b).every((k) => STAMPED.has(k))) husks.add(b.entity.eid)
    }
  }
  console.log(`holding only stamps, left alone: ${husks.size}`)
  return rows.filter((r) => r.to != r.from && !husks.has(r.eid))
}

// A batch a guard refuses is written a row at a time, and a row it refuses
// is left as it was and listed beside the plan.
let refused: (Row & { why: string })[] = []
let write = async (rows: Row[], back = false) => {
  let done = 0
  let put = (some: Row[]) =>
    g.apply(
      some.map((r) => ({
        entity: { eid: r.eid },
        [r.comp]: { by: back ? r.from : r.to },
      })),
      { trusted: true, stamp: false },
    )
  for (let some of chunks(rows, 400)) {
    try {
      await put(some)
      done += some.length
    } catch {
      for (let r of some) {
        try {
          await put([r])
          done++
        } catch (e) {
          refused.push({ ...r, why: (e as Error).message })
        }
      }
    }
  }
  return done
}

let tally = async (rows: Row[]) => {
  let by = new Map<string, number>()
  for (let r of rows) {
    by.set(r.to ?? '(none)', (by.get(r.to ?? '(none)') ?? 0) + 1)
  }
  for (let [to, n] of [...by].sort((a, b) => b[1] - a[1])) {
    let [b] = to.startsWith('(') ? [] : await g.get([to], ['doc'])
    console.log(`  ${n}\t${str((b?.doc as Comp | undefined)?.title) || to}`)
  }
  let how = new Map<string, number>()
  for (let r of rows) {
    let k = kinds.get(r.session) ?? '?'
    how.set(k, (how.get(k) ?? 0) + 1)
  }
  console.log(
    `  rows by how their persona was found: ${
      JSON.stringify(Object.fromEntries(how))
    }`,
  )
  let sessions = new Map<string, number>()
  for (let k of kinds.values()) sessions.set(k, (sessions.get(k) ?? 0) + 1)
  console.log(`  sessions: ${JSON.stringify(Object.fromEntries(sessions))}`)
}

// A mark's stamp names its writer the same way (@yaks/kernel, @yaks/task,
// @yaks/mail, @yaks/memory): every one naming a session names its persona.
let MARKS = [
  'created',
  'updated',
  'archived',
  'notified',
  'completed',
  'cancelled',
  'proposed',
  'memory',
  'decided',
  'verified',
  'opened',
  'resolved',
  'pending',
].filter((c) => g.vocab.prop(c, 'by')?.stamped)
let marks = async (): Promise<Row[]> => {
  let sessions = (await g.read('.session .fields=entity.eid'))
    .map((b) => b.entity.eid)
  let rows: Row[] = []
  for (let comp of MARKS) {
    for (let some of chunks(sessions, 300)) {
      let found = await g.read(and(
        eq(`${comp}.by`, list(...some)),
        fields('entity.eid', `${comp}.by`),
      ))
      for (let b of found) {
        let from = str((b[comp] as Comp).by)
        rows.push({
          eid: b.entity.eid,
          comp,
          session: from,
          from,
          to: await resolve(from),
        })
      }
    }
  }
  let skip = new Set<Eid>()
  let STAMPED = new Set(['entity', 'created', 'updated', ...MARKS])
  for (let some of chunks([...new Set(rows.map((r) => r.eid))], 500)) {
    for (let b of await g.get(some)) {
      if (
        b.tombstone != null || Object.keys(b).every((k) => STAMPED.has(k))
      ) skip.add(b.entity.eid)
    }
  }
  console.log(`marks: ${MARKS.join(', ')}; left alone: ${skip.size}`)
  return rows.filter((r) => !skip.has(r.eid))
}

if (mode == 'marks') {
  let rows = await marks()
  await Deno.writeTextFile(
    out,
    rows.map((r) => JSON.stringify(r)).join('\n') + '\n',
  )
  console.log(`rows: ${rows.length}`)
  await tally(rows)
  let per = new Map<string, number>()
  for (let r of rows) per.set(r.comp, (per.get(r.comp) ?? 0) + 1)
  console.log(`  per mark: ${JSON.stringify(Object.fromEntries(per))}`)
} else if (mode == 'plan') {
  let rows = await plan()
  await Deno.writeTextFile(
    out,
    rows.map((r) => JSON.stringify(r)).join('\n') + '\n',
  )
  console.log(`rows: ${rows.length}`)
  await tally(rows)
  // The sessions with no persona, by the door that started them.
  let none = [...kinds].filter(([, k]) => !k.includes('persona')).map(([s]) =>
    s
  )
  await Deno.writeTextFile(`${out}.unworn`, none.join('\n') + '\n')
} else {
  let rows: Row[] = (await Deno.readTextFile(out)).split('\n').filter(Boolean)
    .map((l) => JSON.parse(l))
  console.log(`${mode}: ${await write(rows, mode == 'undo')} rows`)
  if (refused.length) {
    await Deno.writeTextFile(
      `${out}.${mode}-refused`,
      refused.map((r) => JSON.stringify(r)).join('\n') + '\n',
    )
    let why = new Map<string, number>()
    for (let r of refused) {
      let k = `${r.comp}: ${r.why}`
      why.set(k, (why.get(k) ?? 0) + 1)
    }
    console.log(
      `refused, left as they were: ${JSON.stringify(Object.fromEntries(why))}`,
    )
  }
}
Deno.exit(0)
