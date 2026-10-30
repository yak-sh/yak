// T-133707: bin/backfill-ended.ts wrote `session.ended` with stamping on, so
// sessions it marked carry its `updated`. Each goes back to what it had: what
// the backup taken before the run says, or, for a session newer than the backup,
// the stamp of its newest write after its creation. A session with neither had
// no `updated`. A later write has its own stamp, so `$was` leaves it alone. The
// next commit deletes this.
//
//   deno run -A bin/restore-updated.ts CONFIG NIGHT_CONFIG check|apply
import { compose } from '@yaks/cli/host'
import { read } from '../packages/cli/config.ts'
import { type Bundle, type Comp } from '@yaks/graph'
import { token } from '@yaks/graph/sha256'
import { Stale } from '@yaks/graph/errors'

let [config, night, mode = 'check'] = Deno.args
if (!config || !night || !['check', 'apply'].includes(mode)) {
  throw Error('Usage: restore-updated.ts CONFIG NIGHT_CONFIG check|apply')
}
let actor = {
  by: '4431cca9-5405-49e9-960b-1722db3ec41b',
  via: '08bc55a6-45ec-49a0-931c-a1487455850d',
}
let RUN = '0bc899da-ec83-4405-bd06-c3279434a2a3'
let [FROM, TO] = ['2026-10-30T20:57:27', '2026-10-30T20:58:01']
let BATCH = 50
// A patch leaves a property it omits, and the run's `by` and `via` must go even
// where the row it replaced had none.
let whole = (u: Comp | null) =>
  u && { at: u.at ?? null, by: u.by ?? null, via: u.via ?? null }
let chunks = <T>(all: T[], n: number) =>
  Array.from(
    { length: Math.ceil(all.length / n) },
    (_, i) => all.slice(i * n, (i + 1) * n),
  )

let host = await compose(read(config), ['graph'])
let backup = await compose(read(night), ['graph'])
let g = host.graph
try {
  let mine = (b: Bundle) => {
    let u = b.updated as Comp | undefined
    return u?.via == RUN && String(u.at) >= FROM && String(u.at) < TO
  }
  let hit = async (eids?: string[]) =>
    (eids ? (await g.get(eids, ['updated'])) as Bundle[] : await g.read(
      `.session .updated.via=${RUN} .fields=updated.at,updated.by,updated.via`,
    ))
      .filter((b) => b && mine(b))
  let rows = await hit()

  // What each had: a value, or null for none.
  let was = new Map<string, Comp | null>()
  let newer: string[] = []
  for (let part of chunks(rows.map((b) => b.entity.eid), 500)) {
    let found = new Map(
      ((await backup.graph.get(part, ['session', 'updated'])) as Bundle[])
        .filter((b) => b?.session).map((b) => [b.entity.eid, b]),
    )
    for (let eid of part) {
      let b = found.get(eid)
      if (b) was.set(eid, (b.updated as Comp) ?? null)
      else newer.push(eid)
    }
  }
  for (let eid of newer) {
    let changes = await g.read(`._change.target=${eid} .fields=_change.tx`)
    let txs = (await g.get(
      [...new Set(changes.map((c) => String((c._change as Comp).tx)))],
      ['_tx'],
    )).map((t) => (t as Bundle)._tx as Comp)
      .filter((t) => String(t.at) < FROM)
      .sort((a, b) => Number(a.seq) - Number(b.seq))
    let last = txs.length > 1 ? txs[txs.length - 1] : null
    was.set(eid, last && { at: last.at, by: last.by, via: last.via })
  }
  let none = [...was.values()].filter((v) => !v).length
  console.log(JSON.stringify({
    stamped: rows.length,
    fromNight: rows.length - newer.length,
    newerThanNight: newer.length,
    fromJournal: newer.filter((e) => was.get(e)).length,
    none,
  }))

  if (mode == 'apply') {
    let written = 0, raced = 0
    for (let part of chunks([...was.keys()], BATCH)) {
      // Stale means one moved since this read: read again, and those drop out.
      for (;;) {
        let live = await hit(part)
        try {
          if (live.length) {
            await g.apply(
              live.map((b) => ({
                entity: { eid: b.entity.eid },
                updated: whole(was.get(b.entity.eid)!),
                $was: { updated: { at: token((b.updated as Comp).at) } },
                $actor: actor,
              })),
              { trusted: true, stamp: false },
            )
          }
          written += live.length
          raced += part.length - live.length
          break
        } catch (error) {
          if (!(error instanceof Stale)) throw error
        }
      }
    }
    console.log(JSON.stringify({ written, raced, left: (await hit()).length }))
  }
} finally {
  await backup.close()
  await host.close()
}
