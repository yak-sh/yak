// T-133729: a yak-work process wrote `session.ended` with stamping on, so 550
// sessions carry its `updated`. Each goes back to what the backup taken before
// the run says; the journal shows no write to any of them between the two, so
// that is what each had. A later write has its own stamp, so `$was` leaves it
// alone. The next commit deletes this.
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
  via: 'ac9a2ace-bc4e-40a2-a812-554e290794d0',
}
let RUN = 'a01f1ca9-ad6e-47a0-a745-6ceec5253b97'
let [FROM, TO] = ['2026-10-30T16:26:11', '2026-10-30T16:26:14']
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
  for (let part of chunks(rows.map((b) => b.entity.eid), 500)) {
    let found = new Map(
      ((await backup.graph.get(part, ['session', 'updated'])) as Bundle[])
        .filter((b) => b?.session).map((b) => [b.entity.eid, b]),
    )
    for (let eid of part) {
      let b = found.get(eid)
      if (!b) throw Error(`${eid} is not in the night`)
      was.set(eid, (b.updated as Comp) ?? null)
    }
  }
  let operator = await g.read(
    `.session.operator=true .updated.via=${RUN} .fields=updated.at,updated.via`,
  )
  console.log(JSON.stringify({
    stamped: rows.length,
    operator: operator.filter(mine).length,
    none: [...was.values()].filter((v) => !v).length,
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
