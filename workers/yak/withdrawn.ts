// Whether an upload of an app anyone may read is still served is its store's
// to say (@yaks/blob/upload `servable`), and the gateway keeps each answer
// (files.ts `servableOf`) under the app's `withdrawn` mark, read with the app
// on every request. A yes only goes stale when the app's rows stop naming
// bytes, so that is when the mark moves: the store's `delete_upload` effect,
// once an upload's content row is gone, and a restore, which can take rows
// back to before an upload without deleting anything. A page of pictures then
// costs the store nothing until one of them is withdrawn (T-1600).
import { mint } from '@yaks/graph/identity'
import type { Namespace } from '@yaks/durable-object/door'
import { stamp } from './directory.ts'

/** Move `app`'s mark: every servable answer the gateway kept for it is asked
 * again. */
export let withdrew = async (
  env: { STORE: Namespace },
  app: string,
  now = new Date(),
) => {
  await stamp(env, {
    entities: [{
      entity: { eid: app },
      withdrawn: { at: now.toISOString(), mark: mint() },
    }],
  })
}
