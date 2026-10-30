// T-133740: entries a program wrote into an outside harness, `codex exec` briefs
// above all, are stamped `created{by: Jeff}`. Each goes to the actor its session
// works as, else the persona its checkout carries, and becomes a notice as a new
// exec run's brief is. A later write has its own stamp, so `$was` leaves it
// alone. The next commit deletes this.
//
//   deno run -A bin/unsign-briefs.ts CONFIG PLAN check|apply
import { compose } from '@yaks/cli/host'
import { read } from '../packages/cli/config.ts'
import { type Bundle, type Comp } from '@yaks/graph'
import { token } from '@yaks/graph/sha256'
import { Stale } from '@yaks/graph/errors'
import { carried } from '@yaks/persona'
import { actorOf } from '../packages/session/who.ts'

let [config, planned, mode = 'check'] = Deno.args
if (!config || !planned || !['check', 'apply'].includes(mode)) {
  throw Error('Usage: unsign-briefs.ts CONFIG PLAN check|apply')
}
let JEFF = '7c1f3a52-9b0e-4d21-8f4a-2e6b9d417c88'
let REPO = '/home/yaks/code/tasks'
let VIA = '2bc4dbd9-ca77-4363-8973-560a7c631c3f'
let BATCH = 50
type Row = { eid: string; session: string; cwd: string | null }
let plan: Row[] = JSON.parse(Deno.readTextFileSync(planned))
let chunks = <T>(all: T[], n: number) =>
  Array.from(
    { length: Math.ceil(all.length / n) },
    (_, i) => all.slice(i * n, (i + 1) * n),
  )

let host = await compose(read(config), ['graph'])
let g = host.graph
try {
  let bySession = new Map<string, string>()
  let worn = async (path: string) =>
    (await carried(g, path))?.persona.entity.eid as string | undefined
  for (let { session, cwd } of plan) {
    if (bySession.has(session)) continue
    let by = await actorOf(g, session) ?? (cwd && await worn(cwd)) ??
      await worn(REPO)
    if (!by) throw Error(`no actor for ${session}`)
    bySession.set(session, by)
  }
  let held = async (eids: string[]) =>
    ((await g.get(eids, ['created', 'notice'])) as Bundle[]).filter((b) =>
      b && (b.created as Comp)?.by == JEFF
    )
  let counts: Record<string, number> = {}
  for (let by of bySession.values()) counts[by] = 0
  let actorOfRow = new Map(plan.map((r) => [r.eid, bySession.get(r.session)!]))
  for (let by of actorOfRow.values()) counts[by]++
  let left = async () => {
    let n = 0
    for (let part of chunks(plan.map((r) => r.eid), 500)) {
      n += (await held(part)).length
    }
    return n
  }
  console.log(JSON.stringify({
    planned: plan.length,
    sessions: bySession.size,
    jeffBefore: await left(),
    counts,
  }))
  if (mode == 'apply') {
    let written = 0, raced = 0
    for (let part of chunks(plan.map((r) => r.eid), BATCH)) {
      for (;;) {
        let live = await held(part)
        try {
          if (live.length) {
            await g.apply(
              live.map((b) => {
                let by = actorOfRow.get(b.entity.eid)!
                return {
                  entity: { eid: b.entity.eid },
                  created: { by },
                  notice: {},
                  $was: { created: { by: token(JEFF) } },
                  $actor: { by, via: VIA },
                }
              }),
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
    console.log(JSON.stringify({ written, raced, left: await left() }))
  }
} finally {
  await host.close()
}
