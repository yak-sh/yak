// A release made again as itself by the toolkit serving it now (toolkit.ts),
// in the directory's alarm, where a compile and a release have the time they
// take. A page's own request ends some 30 s after it is answered, which they
// outlast, leaving the release's fence behind. So a page served from a release
// whose toolkit has moved on asks for its remake (apps.ts `refresh`): a wake
// row of the directory's, one per release, named for it, which the remake
// sweep does when its alarm fires it (facets/remake-graph.ts).
//
// A deploy getting there first, or a space out of build seconds, is the
// remake not needed or not this one's to do. Anything else is a failure of
// ours, which the sweep reports (wake.ts `reporting`).
import { derivedEid } from '@yaks/graph/identity'
import { CallError } from '@yaks/tools/errors'
import { copyOf } from './directory-copy.ts'
import { directory } from './directory.ts'
import * as dirPart from './directory.ts'
import { bound, type Env } from './env.ts'
import { KERNEL, meta } from './meta.ts'
import { recompileRelease } from './tools.ts'

/** What a remake remakes: an app, and the release of it to make again. */
export type Remake = { app: string; source: string }

let EXPECTED = ['stale', 'conflict', 'limit']

/** Ask for the release at `source` to be made again, once: the row is named
 * for the release, and a release already asked for is left as it stands. */
export let ask = async (env: Env, job: Remake) => {
  let eid = derivedEid(`remake ${job.source}`)
  let graph = meta(env)
  if ((await graph.query(`.entity.eid=${eid}`)).length) return
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
  let at = await dir.appAt(job.app)
  if (!at || at.app.source != job.source) return
  try {
    await recompileRelease({ env, dir, person: '' }, at.space, at.app)
  } catch (e) {
    if (e instanceof CallError && EXPECTED.includes(e.code)) return
    throw e
  }
}
