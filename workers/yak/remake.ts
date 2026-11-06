// A release made again as itself by the toolkit serving it now (toolkit.ts),
// in the directory's alarm, where a compile and a release have the time they
// take. A page's own request ends some 30 s after it is answered, which they
// outlast, leaving the release's fence behind. So a page served from a release
// whose toolkit has moved on asks for its remake (apps.ts `refresh`): a wake
// row of the directory's, one per release, named for it, which the remake
// sweep does when its alarm fires it (facets/remake-graph.ts).
//
// Its compile is yaks.app's to pay for, never the space's (esbuild.ts
// `Payer`): the person did not ask for it and gains only our fix. A deploy
// getting there first is the remake not needed, and a deploy under way (the
// app's fence held, before the remake starts or while it waits on it) leaves
// the release to it; if that release still serves, its next page asks again.
// Anything else is a failure of ours, which the sweep reports (wake.ts
// `reporting`).
//
// A deploy restarts the directory, and the remake under way in its alarm dies
// holding the release's fence, which would hold the person's edits and the
// remake's own next run until it is five minutes old (versions.ts `waiting`).
// So a run draws its fence and keeps it on the row before taking it, and the
// run the restart fires again (wake.ts `resumed`) lifts exactly that one.
import { derivedEid } from '@yaks/graph/identity'
import { CallError } from '@yaks/tools/errors'
import { copyOf } from './directory-copy.ts'
import { directory } from './directory.ts'
import * as dirPart from './directory.ts'
import { bound, type Env } from './env.ts'
import { KERNEL, meta } from './meta.ts'
import { recompileRelease } from './tools.ts'
import { drawn } from './versions.ts'

/** What a remake remakes: an app, and the release of it to make again; and
 * the fence its last run took. */
export type Remake = { app: string; source: string; fence?: string | null }

let rowOf = (job: Remake) => derivedEid(`remake ${job.source}`)

let EXPECTED = ['stale', 'conflict']

/** Ask for the release at `source` to be made again. The row is named for the
 * release: one waiting or under way is left as it stands, and one that fired
 * and left the release serving (a deploy held its fence, or the remake
 * failed) is woken again. */
export let ask = async (env: Env, job: Remake) => {
  let eid = rowOf(job)
  let graph = meta(env)
  let [held] = await graph.query(`.entity.eid=${eid}&?wake&?sweep`) as {
    wake?: { at?: string | null }
    sweep?: { began?: string | null }
  }[]
  if (held?.wake?.at || held?.sweep?.began) return
  await graph.apply([{
    entity: { eid },
    wake: {
      at: new Date().toISOString(),
      note: 'Compile this release again with the toolkit serving it now',
    },
    sweep: { kind: 'remake' },
    release_remake: job,
  }], KERNEL)
}

/** Make the release again, unless the app serves another one by now. */
export let remade = async (env: Env, job: Remake) => {
  let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env), {
    copy: copyOf(env),
    time: env.CLOCK,
  })
  let fence = drawn()
  // Another release's: the app moved on, or a deploy holds its fence. A fence
  // this run or its dead last run drew is the remake's own.
  let theirs = (at: Awaited<ReturnType<typeof dir.appAt>>) =>
    !at || at.app.source != job.source ||
    (!!at.app.fence && at.app.fence != job.fence && at.app.fence != fence)
  let at = await dir.appAt(job.app)
  if (theirs(at)) return
  await meta(env).apply([{
    entity: { eid: rowOf(job) },
    release_remake: { fence },
  }], KERNEL)
  try {
    await recompileRelease({ env, dir, person: '' }, at!.space, at!.app, {
      left: job.fence,
      take: fence,
    })
  } catch (e) {
    if (e instanceof CallError && EXPECTED.includes(e.code)) return
    // The fence wait's refusal (versions.ts `waiting`): a deploy took it.
    if (e instanceof CallError && theirs(await dir.appAt(job.app))) return
    throw e
  }
}
