// Every app row says whether its release built a worker (app.worker), which a
// deploy has written since T-124006. A row last deployed before then says
// nothing, so each of its page views asks the dispatch namespace for a script,
// and the edge never keeps its pages (apps.ts `served`). Its release's deploy
// row has always said it: this copies that word onto the app.
import type { Bundle, Comp } from '@yaks/graph'
import { token } from '@yaks/graph/sha256'
import { PLATFORM_STORE } from './door.ts'
import type { Rule } from './mover.ts'

/**
 * The patch that gives one app its release's worker, or none where no deploy
 * row says it.
 *
 * ```ts
 * import { workerMove } from './worker-move.ts'
 * import { assertEquals } from '@std/assert'
 * let app = { entity: { eid: 'a' }, app: { slug: 'recipes', version: 2 } }
 * let deploys = (worker?: string) => () =>
 *   worker == null ? [] : [{ entity: { eid: 'd' }, deploy: { worker } }]
 * assertEquals(workerMove(app, deploys(''))[0].app, { worker: '' })
 * assertEquals(workerMove(app, deploys('app-a-r-1'))[0].app, {
 *   worker: 'app-a-r-1',
 * })
 * assertEquals(workerMove(app, deploys()), [])
 * ```
 */
export let workerMove = (
  row: Bundle,
  read?: (line: string) => Bundle[],
): Bundle[] => {
  let app = row.app as Comp
  if (app.version == null || app.worker != null) return []
  if (!read) throw new Error('an app worker needs its deploy row')
  let [made] = read(
    `.deploy.app=${row.entity.eid}&.deploy.version=${app.version}&*`,
  )
  let worker = (made?.deploy as Comp | undefined)?.worker
  if (typeof worker != 'string') return []
  return [{
    entity: { eid: row.entity.eid },
    app: { worker },
    $was: { app: { version: token(app.version), worker: token(app.worker) } },
  }]
}

export let workerRule: Rule = {
  mark: 'yak/store/app-worker/1',
  stores: [PLATFORM_STORE],
  find: '.app !app.worker&*',
  move: workerMove,
}
