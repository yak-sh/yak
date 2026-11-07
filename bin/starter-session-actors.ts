// T-132280: sessions that opened working as nobody, and the rows they wrote
// with an empty `by`, name the actor they work as.
//
// A session no persona, actor, project or parent names wears what @yaks/harness
// `openingFor` gives one now: the persona its checkout carries, else the
// persona of the session that started it (its `created.via`, or the persona its
// starter stamped as `created.by`), else that starter's actor. Each such session
// records it (`session.persona`, else `session.actor`), and every `created` or
// `updated` stamp it wrote with no `by` takes it.
//
//   deno run -A bin/starter-session-actors.ts <yak.json> plan <out.jsonl>
//   deno run -A bin/starter-session-actors.ts <yak.json> write <out.jsonl>
//   deno run -A bin/starter-session-actors.ts <yak.json> undo <out.jsonl>

import { and, eq, fields, list } from '@yaks/query'
import { carried } from '@yaks/persona'
import { actorOf } from '@yaks/session'
import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import { opened } from '../packages/cli/local.ts'

let [config, mode, out] = Deno.args
let host = await opened(config, ['graph'], false, mode == 'plan')
let g: Graph = host.graph
let str = (v: unknown) => typeof v == 'string' ? v : ''
let chunks = <T>(xs: T[], n: number): T[][] =>
  Array.from(
    { length: Math.ceil(xs.length / n) },
    (_, i) => xs.slice(i * n, i * n + n),
  )

// One stamp to set: `comp.prop` on `eid`, from what it holds to what it takes.
type Row = {
  eid: Eid
  comp: string
  prop: string
  session: Eid
  from: Eid | null
  to: Eid
}

let personas = new Set(
  (await g.read('.persona .fields=entity.eid')).map((b) => b.entity.eid),
)

// Who a session works as, and how that was found, where anything says.
let resolve = async (s: Bundle): Promise<[Eid, string] | undefined> => {
  let eid = s.entity.eid
  let made = (s.created ?? {}) as Comp
  let cwd = str((s.home as Comp | undefined)?.cwd) ||
    str((s.process as Comp | undefined)?.cwd)
  let worn = cwd ? (await carried(g, cwd))?.persona.entity.eid : undefined
  if (worn) return [worn, 'checkout persona']
  let starter = str(made.via)
  let starts = starter && starter != eid &&
    (await g.get([starter], ['session']))[0]?.session
  let theirs = starts ? await actorOf(g, starter) : undefined
  if (theirs && personas.has(theirs)) return [theirs, 'starter persona']
  // A session begun through itself stamped its starter's actor as `by`: a
  // persona there is the one it works as. Any other `by` may be a person at
  // a terminal, who is no session's actor.
  let by = str(made.by)
  if (by && personas.has(by)) return [by, 'stamped persona']
  if (theirs) return [theirs, 'starter actor']
}

let plan = async (): Promise<Row[]> => {
  let unworn = (await g.read(
    '.session !session.persona !session.actor !filed.project !spawned.parent ' +
      '.fields=entity.eid',
  )).map((b) => b.entity.eid)
  // A child works as its parent through `actorOf`: only a root needs telling.
  let found = new Map<Eid, [Eid, string]>()
  for (let some of chunks(unworn, 300)) {
    let rows = await g.get(some, [
      'session',
      'created',
      'home',
      'process',
      'tombstone',
    ])
    for (let s of rows) {
      if (s.tombstone != null) continue
      let r = await resolve(s)
      if (r) found.set(s.entity.eid, r)
    }
  }
  console.log(`sessions working as nobody: ${unworn.length}`)
  let how = new Map<string, number>()
  for (let [, k] of found.values()) how.set(k, (how.get(k) ?? 0) + 1)
  console.log(
    `  resolved: ${found.size} ${JSON.stringify(Object.fromEntries(how))}`,
  )
  let rows: Row[] = []
  for (let [s, [to]] of found) {
    rows.push({
      eid: s,
      comp: 'session',
      prop: personas.has(to) ? 'persona' : 'actor',
      session: s,
      from: null,
      to,
    })
  }
  // Every stamp a resolved session wrote naming no actor, on an entity that
  // holds more than its stamps (one that holds nothing else would be removed).
  let STAMPED = new Set(['entity', 'created', 'updated'])
  for (let comp of ['created', 'updated']) {
    for (let some of chunks([...found.keys()], 300)) {
      let hits = await g.read(and(
        eq(`${comp}.via`, list(...some)),
        fields('entity.eid', `${comp}.via`, `${comp}.by`),
      ))
      let bare = hits.filter((b) => !str((b[comp] as Comp).by))
      let whole = new Set<Eid>()
      for (let part of chunks(bare.map((b) => b.entity.eid), 500)) {
        for (let b of await g.get(part)) {
          if (
            b.tombstone == null && !Object.keys(b).every((k) => STAMPED.has(k))
          ) whole.add(b.entity.eid)
        }
      }
      for (let b of bare) {
        if (!whole.has(b.entity.eid)) continue
        let via = str((b[comp] as Comp).via) as Eid
        rows.push({
          eid: b.entity.eid,
          comp,
          prop: 'by',
          session: via,
          from: null,
          to: found.get(via)![0],
        })
      }
    }
  }
  // The session rows themselves, made by a starter that stamped no actor.
  let made = new Set(
    rows.filter((r) => r.comp == 'created').map((r) => r.eid),
  )
  for (let some of chunks([...found.keys()], 500)) {
    for (let s of await g.get(some, ['created'])) {
      if (str((s.created as Comp | undefined)?.by)) continue
      if (made.has(s.entity.eid)) continue
      rows.push({
        eid: s.entity.eid,
        comp: 'created',
        prop: 'by',
        session: s.entity.eid,
        from: null,
        to: found.get(s.entity.eid)![0],
      })
    }
  }
  return rows
}

let refused: (Row & { why: string })[] = []
let write = async (rows: Row[], back = false) => {
  let done = 0
  let put = (some: Row[]) =>
    g.apply(
      some.map((r) => ({
        entity: { eid: r.eid },
        [r.comp]: { [r.prop]: back ? r.from : r.to },
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

if (mode == 'plan') {
  let rows = await plan()
  await Deno.writeTextFile(
    out,
    rows.map((r) => JSON.stringify(r)).join('\n') + '\n',
  )
  let per = new Map<string, number>()
  for (let r of rows) {
    let k = `${r.comp}.${r.prop}`
    per.set(k, (per.get(k) ?? 0) + 1)
  }
  console.log(`rows: ${rows.length} ${JSON.stringify(Object.fromEntries(per))}`)
  let to = new Map<string, number>()
  for (let r of rows) to.set(r.to, (to.get(r.to) ?? 0) + 1)
  for (let [eid, n] of [...to].sort((a, b) => b[1] - a[1])) {
    let [b] = await g.get([eid], ['doc'])
    console.log(`  ${n}\t${str((b?.doc as Comp | undefined)?.title) || eid}`)
  }
} else {
  let rows: Row[] = (await Deno.readTextFile(out)).split('\n').filter(Boolean)
    .map((l) => JSON.parse(l))
  console.log(`${mode}: ${await write(rows, mode == 'undo')} rows`)
  if (refused.length) {
    await Deno.writeTextFile(
      `${out}.${mode}-refused`,
      refused.map((r) => JSON.stringify(r)).join('\n') + '\n',
    )
    console.log(`refused: ${refused.length}`)
  }
}
await host.close()
Deno.exit(0)
