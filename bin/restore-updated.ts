// T-133744: after 56738e54b the Codex door wrote `session{id, operator, persona}`
// with stamping on, so 31 ended sessions carry the `updated` of process ec3932f6.
// Each goes back to what it had: the backup taken before the run, or for a session
// newer than the night, its last stamped write in the journal. A later write has
// its own stamp, so `$was` leaves it alone. That journal write was signed as the
// owner, an exec brief read as his (T-133732, T-133740), so `by` is the persona
// the session wears, as T-133740 moved the briefs. The next commit deletes this.
//
//   deno run -A bin/restore-updated.ts CONFIG NIGHT_CONFIG check|apply
import { compose } from '@yaks/cli/host'
import { read } from '../packages/cli/config.ts'
import { type Bundle, type Comp } from '@yaks/graph'
import { token } from '@yaks/graph/sha256'

let [config, night, mode = 'check'] = Deno.args
if (!config || !night || !['check', 'apply'].includes(mode)) {
  throw Error('Usage: restore-updated.ts CONFIG NIGHT_CONFIG check|apply')
}
let actor = {
  by: '4431cca9-5405-49e9-960b-1722db3ec41b',
  via: 'aa74921e-334a-4d31-85e6-206ad97b4112',
}
let RUN = 'ec3932f6-c473-4590-84db-1075ac8d3ca1'
let [FROM, TO] = ['2026-10-30T22:14:41', '2026-10-30T22:14:53']
let NIGHT_AT = '2026-10-30T08:42'
let whole = (u: Comp | null) =>
  u && { at: u.at ?? null, by: u.by ?? null, via: u.via ?? null }

let path = new URL(
  JSON.parse(Deno.readTextFileSync(config)).db,
  'file://' + Deno.realPathSync(config),
).pathname
let sql = async (q: string) => {
  let { stdout } = await new Deno.Command('sqlite3', {
    args: ['-readonly', '-json', path, q],
  }).output()
  let text = new TextDecoder().decode(stdout).trim()
  return (text ? JSON.parse(text) : []) as Record<string, string>[]
}
// The last write before the night's end of stamping that stamped: not the
// repair's or endGone's, which pass stamp: false and write only these.
let lastStamped = async (eid: string) =>
  (await sql(`
    select t.ts at, (select eid from entity where id=t.actor) "by",
           (select eid from entity where id=t.via) via
    from journal_tx t join journal_change c on c.tx=t.id
    where c.entity=(select id from entity where eid='${eid}')
      and t.ts>'${NIGHT_AT}' and t.ts<'${FROM}'
      and t.via!=(select id from entity where eid='${actor.via}')
      and not (c.component='session' and (
        select group_concat(f.field,' ') from journal_field f where f.change=c.id
      ) in ('ended','operator') and t.ts>'2026-10-30T20:57')
    order by t.id desc limit 1`))[0] ?? null

let host = await compose(read(config), ['graph'])
let backup = await compose(read(night), ['graph'])
let g = host.graph
try {
  let hit = (await g.read(
    `.session .updated.via=${RUN} .fields=updated.at,updated.by,updated.via,session.persona`,
  ) as Bundle[]).filter((b) => {
    let at = String((b.updated as Comp).at)
    return at >= FROM && at < TO
  })
  let eids = hit.map((b) => b.entity.eid)
  let nights = new Map(
    ((await backup.graph.get(eids, ['session', 'updated'])) as Bundle[])
      .filter((b) => b?.session).map((b) => [b.entity.eid, b]),
  )
  let was = new Map<string, Comp | null>()
  for (let row of hit) {
    let eid = row.entity.eid, b = nights.get(eid)
    let last = b ? null : await lastStamped(eid)
    was.set(
      eid,
      b
        ? (b.updated as Comp) ?? null
        : last && { ...last, by: (row.session as Comp).persona as string },
    )
  }
  for (let eid of eids) {
    console.log(
      eid,
      nights.has(eid) ? 'night' : 'journal',
      JSON.stringify(was.get(eid)),
    )
  }
  console.log(JSON.stringify({
    stamped: hit.length,
    night: eids.filter((e) => nights.has(e)).length,
    journal: eids.filter((e) => !nights.has(e)).length,
    none: [...was.values()].filter((v) => !v).length,
  }))
  if (mode == 'apply') {
    await g.apply(
      hit.map((b) => ({
        entity: { eid: b.entity.eid },
        updated: whole(was.get(b.entity.eid)!),
        $was: { updated: { at: token((b.updated as Comp).at) } },
        $actor: actor,
      })),
      { trusted: true, stamp: false },
    )
    let left = (await g.read(
      `.session .updated.via=${RUN} .fields=updated.at`,
    ) as Bundle[])
      .filter((b) =>
        String((b.updated as Comp).at) >= FROM &&
        String((b.updated as Comp).at) < TO
      )
    console.log(JSON.stringify({ written: hit.length, left: left.length }))
  }
} finally {
  await backup.close()
  await host.close()
}
