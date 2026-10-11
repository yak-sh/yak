/** Move journal-proven inbox attention since October 9 onto existing per-actor
 * subscriptions. Reads SQLite through a read-only driver; writes only a bundle
 * plan for `yak graph apply --restore`. Delete after its live run. */
import { type Bundle, type Comp, mint, token } from '@yaks/graph'
import {
  and,
  as,
  at,
  col,
  eq,
  ge,
  join,
  select,
  star,
  table,
  val,
} from '@yaks/sql'
import { open } from '@yaks/sqlite/db'
import { threadOf } from '@yaks/inbox'
import type { Row } from '@yaks/inbox'

let [path, output] = Deno.args
if (!path || !output) {
  throw new Error('usage: migrate-inbox-attention.ts <db> <plan.json>')
}
let db = open(path, { readOnly: true })
db.query({ t: 'begin' })
let cutoff = '2026-10-09T00:00:00.000Z'
let marks = ['archived', 'opened'] as const
let e = at('e'), c = at('c'), t = at('t'), m = at('m')
let tables = new Set(
  db.query(
    select({
      cols: [col('name')],
      from: table('sqlite_schema'),
      where: eq(col('type'), val('table')),
    }),
  ).map((r) => String(r.name)),
)
let ids = new Map<number, string>()
let eid = (id: unknown): string | undefined => {
  if (id == null) return undefined
  let n = Number(id)
  if (!ids.has(n)) {
    let [found] = db.query(
      select({
        cols: [col('eid')],
        from: table('entity'),
        where: eq(col('id'), val(n)),
      }),
    )
    if (!found) throw new Error(`missing entity ${n}`)
    ids.set(n, String(found.eid))
  }
  return ids.get(n)!
}
let markOf = (id: number, name: string): Comp | undefined => {
  let [r] = db.query(
    select({
      cols: [star()],
      from: table(name),
      where: eq(col('entity'), val(id)),
    }),
  )
  if (!r) return
  return Object.fromEntries([
    ['at', r.at],
    ['by', eid(r.by)],
    ['via', eid(r.via)],
  ].filter(([, v]) => v != null))
}
let sources: {
  id: number
  eid: string
  mark: typeof marks[number]
  value: Comp
  tx: number
  door: string
}[] = []
let excluded: { eid: string; mark: string; reason: string }[] = []
let subscriptions = db.query(
  select({ cols: [star()], from: table('subscription') }),
)
let subIds = new Set(subscriptions.map((r) => Number(r.entity)))
let doors = new Map<number, string[]>()
let doorAt = (tx: number): string[] => {
  if (!doors.has(tx)) {
    let call = at('call'), tool = at('tool')
    let rows = db.query(select({
      cols: [tool('name')],
      from: table('journal_change', 'c'),
      joins: [
        join(table('call', 'call'), eq(call('entity'), c('entity'))),
        join(table('tool', 'tool'), eq(tool('entity'), call('to'))),
      ],
      where: and(eq(c('tx'), val(tx)), eq(c('component'), val('execution'))),
    }))
    doors.set(tx, rows.map((r) => String(r.name)))
  }
  return doors.get(tx)!
}
let records = new Map<string, Row>()
let rowAt = (id: number): Row => {
  let key = eid(id)!
  let had = records.get(key)
  if (had) return had
  let r: Row = { eid: key, comps: {} }
  records.set(key, r)
  for (let name of ['mail', 'comment', 'entry', 'commit', 'signal', 'knock']) {
    if (!tables.has(name)) continue
    let [comp] = db.query(
      select({
        cols: [star()],
        from: table(name),
        where: eq(col('entity'), val(id)),
      }),
    )
    if (!comp) continue
    let fields = name == 'mail'
      ? ['target', 'reply_to']
      : name == 'entry'
      ? ['session']
      : ['target']
    r.comps[name] = Object.fromEntries(
      fields.filter((p) => comp[p] != null).map((p) => [p, eid(comp[p])]),
    )
    if (name == 'mail') {
      if (comp.reply_to != null) rowAt(Number(comp.reply_to))
      if (comp.message_id) records.set(String(comp.message_id), r)
    }
  }
  return r
}
let bundles: Bundle[] = []
let destinations = new Map<string, Bundle>()
let evidence: Record<string, unknown>[] = []
let before: Record<string, Record<string, Comp>> = {}
try {
  for (let name of marks) {
    let rows = db.query(select({
      cols: [
        as(c('id'), 'change'),
        as(c('tx'), 'tx'),
        as(c('entity'), 'id'),
        as(c('operation'), 'operation'),
        e('eid'),
      ],
      from: table('journal_change', 'c'),
      joins: [
        join(table('journal_tx', 't'), eq(t('id'), c('tx'))),
        join(table(name, 'm'), eq(m('entity'), c('entity'))),
        join(table('entity', 'e'), eq(e('id'), c('entity'))),
      ],
      where: and(eq(c('component'), val(name)), ge(t('ts'), val(cutoff))),
      order: [c('id')],
    }))
    let last = new Map<number, typeof rows[number]>()
    for (let r of rows) if (!subIds.has(Number(r.id))) last.set(Number(r.id), r)
    for (let r of last.values()) {
      let value = markOf(Number(r.id), name)!
      let names = doorAt(Number(r.tx))
      let door = names.find((s) =>
        ['inbox_archive', 'inbox_open', 'mail_show', 'mail_reply'].includes(s)
      )
      if (!door || r.operation != 'upsert') {
        excluded.push({
          eid: String(r.eid),
          mark: name,
          reason: 'latest journal transaction has no inbox attention tool',
        })
        continue
      }
      if (!value.by) throw new Error(`${r.eid} ${name} has no actor`)
      sources.push({
        id: Number(r.id),
        eid: String(r.eid),
        mark: name,
        value,
        tx: Number(r.tx),
        door,
      })
    }
  }
  // Fingerprint every non-subscription mark: the proof can compare the whole
  // set, including marks the migration deliberately leaves alone.
  for (let name of marks) {
    before[name] = {}
    for (
      let r of db.query(select({ cols: [col('entity')], from: table(name) }))
    ) {
      if (!subIds.has(Number(r.entity))) {
        before[name][eid(r.entity)!] = markOf(Number(r.entity), name)!
      }
    }
  }
  for (let source of sources) {
    let r = rowAt(source.id)
    let actor = String(source.value.by)
    let [person] = db.query(
      select({
        cols: [col('id')],
        from: table('entity'),
        where: eq(col('eid'), val(actor)),
      }),
    )
    let isProject = person &&
      db.query(
          select({
            cols: [col('entity')],
            from: table('project'),
            where: eq(col('entity'), val(Number(person.id))),
          }),
        ).length > 0
    let target = threadOf(
      r,
      { actor, scope: isProject ? actor : undefined },
      records,
    )
    let key = JSON.stringify([actor, target])
    let destination = destinations.get(key)
    if (!destination) {
      let held = subscriptions.find((s) =>
        eid(s.actor) == actor && eid(s.target) == target
      )
      destination = {
        entity: { eid: held ? eid(held.entity)! : mint() },
        subscription: { actor, target },
        $was: Object.fromEntries(
          marks.map((
            name,
          ) => [
            name,
            Object.fromEntries(
              ['at', 'by', 'via'].map((
                p,
              ) => [
                p,
                token(held ? markOf(Number(held.entity), name)?.[p] : null),
              ]),
            ),
          ]),
        ),
      }
      if (held) {
        for (let name of marks) {
          let value = markOf(Number(held.entity), name)
          if (value) destination[name] = value
        }
      }
      destinations.set(key, destination)
    }
    let existing = destination[source.mark] as Comp | undefined
    if (
      !existing || String(existing.at ?? '') < String(source.value.at ?? '')
    ) destination[source.mark] = source.value
    bundles.push({
      entity: { eid: source.eid },
      [source.mark]: null,
      $was: {
        [source.mark]: Object.fromEntries(
          ['at', 'by', 'via'].map((p) => [p, token(source.value[p])]),
        ),
      },
    })
    evidence.push({
      source: source.eid,
      mark: source.mark,
      tx: source.tx,
      door: source.door,
      actor,
      target,
      value: source.value,
    })
  }
  bundles.unshift(...destinations.values())
  db.query({ t: 'commit' })
} finally {
  db.close()
}
await Deno.writeTextFile(output, JSON.stringify(bundles, null, 2) + '\n')
let counts = {
  source: sources.length,
  archived: sources.filter((s) => s.mark == 'archived').length,
  opened: sources.filter((s) => s.mark == 'opened').length,
  subscriptions: destinations.size,
  destinationMarks: [...destinations.values()].reduce(
    (n, b) => n + marks.filter((m) => b[m]).length,
    0,
  ),
  excluded: excluded.length,
}
await Deno.writeTextFile(
  output + '.audit.json',
  JSON.stringify(
    {
      counts,
      evidence,
      excluded,
      before,
      destinations: [...destinations.values()],
    },
    null,
    2,
  ) + '\n',
)
console.log(JSON.stringify(counts))
