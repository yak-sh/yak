// A page's query of its app's store: asked across the homes of the words the
// app borrows, which the store composes itself (graph.ts `#across`), and
// answered by the platform's listing rule, as every door answers a page.
import { whole } from '@yaks/query'
import { listed, type Row } from '@yaks/platform/listing'
import { type App, appStore, type Space } from './directory.ts'
import { ACROSS } from './door.ts'
import type { Env } from './env.ts'
import { metaOf } from './meta.ts'
import { vouched, type Who } from './session.ts'

/** A page's query of its app's store, as `who` with `headers` beside. The
 * page wrote `line` whole, so it is read as written. */
export let queried = async (
  env: Env,
  space: Space,
  app: App,
  who: Who,
  line: string,
  live = false,
  headers: Record<string, string> = {},
): Promise<unknown> => {
  let rows = await metaOf(appStore(env.STORE, space, app, env), {
    ...vouched(who),
    ...headers,
    [ACROSS]: '1',
  }).query(whole(line), { live, listing: true, names: true })
  return Array.isArray(rows) ? listed(rows as Row[], line) : rows
}
