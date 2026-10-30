// T-133761: 104 `codex exec` sessions carry `updated.by` Jeff, from the write of
// their `operator` mark when the Codex door read a brief as his (T-133732). Each
// goes to the persona that signs its brief since T-133740. A patch keeps `at` and
// `via`, and a later write has its own stamp, so `$was` leaves it alone. The next
// commit deletes this.
//
//   deno run -A bin/unsign-updated.ts CONFIG PLAN check|apply
import { compose } from '@yaks/cli/host'
import { read } from '../packages/cli/config.ts'
import { type Bundle, type Comp } from '@yaks/graph'
import { token } from '@yaks/graph/sha256'

let [config, planned, mode = 'check'] = Deno.args
if (!config || !planned || !['check', 'apply'].includes(mode)) {
  throw Error('Usage: unsign-updated.ts CONFIG PLAN check|apply')
}
let JEFF = '7c1f3a52-9b0e-4d21-8f4a-2e6b9d417c88'
let PERSONA = '4431cca9-5405-49e9-960b-1722db3ec41b'
let actor = { by: PERSONA, via: '4074b09f-c336-40aa-b79c-6c4ce0300219' }
let plan = new Set(
  (JSON.parse(Deno.readTextFileSync(planned)) as { eid: string }[])
    .map((r) => r.eid),
)

let host = await compose(read(config), ['graph'])
let g = host.graph
let held = async () =>
  await g.read(
    `.session.operator=false .updated.by=${JEFF} .fields=updated.at,updated.by,updated.via .limit=1000`,
  ) as Bundle[]
let stamps = (rows: Bundle[]) =>
  new Map(rows.map((b) => {
    let { at, via } = b.updated as Comp
    return [b.entity.eid, `${at} ${via}`]
  }))
try {
  let hit = await held()
  let ours = hit.filter((b) => plan.has(b.entity.eid))
  console.log(JSON.stringify({
    planned: plan.size,
    held: hit.length,
    writing: ours.length,
    unplanned: hit.filter((b) => !plan.has(b.entity.eid)).map((b) =>
      b.entity.eid
    ),
  }))
  if (mode == 'apply') {
    let before = stamps(ours)
    if (ours.length) {
      await g.apply(
        ours.map((b) => ({
          entity: { eid: b.entity.eid },
          updated: { by: PERSONA },
          $was: { updated: { by: token(JEFF) } },
          $actor: actor,
        })),
        { trusted: true, stamp: false },
      )
    }
    let after = (await g.get([...before.keys()], ['updated'])) as Bundle[]
    console.log(JSON.stringify({
      written: ours.length,
      left: (await held()).length,
      persona: after.filter((b) => (b.updated as Comp).by == PERSONA).length,
      moved: after.filter((b) => {
        let { at, via } = b.updated as Comp
        return before.get(b.entity.eid) != `${at} ${via}`
      }).length,
    }))
  }
} finally {
  await host.close()
}
