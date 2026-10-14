// Keep builder provenance when a release arrives, and delete an upload's
// bytes once its row is gone.
import { preserve } from '@yaks/builders'
import type { Bundle } from '@yaks/graph'
import type { Handlers } from '@yaks/effects'
import type { Options } from './store.ts'
import { maintenance } from '../used.ts'
import { blobPrefix, naming } from '../blob-key.ts'
import { r2Objects } from '../lib/objects.ts'

export let effects = (_host: unknown, options: Options): Handlers => {
  let at = options.store
  return {
    builder_install: maintenance(async () => {
      let writes: Bundle[] = []
      if (at.graph.vocab.comp('builder')) {
        for (let builder of await at.graph.read('.builder&*')) {
          writes.push(
            ...await at.graph.storage.tx((tx) =>
              preserve(tx, builder, at.graph.vocab)
            ),
          )
        }
      }
      if (writes.length) await at.graph.apply(writes, { trusted: true })
    }),
    // The bytes sit under the app's current address, so the directory is
    // asked for it at run time, and what names them is read last, after that
    // wait: an upload of the same file meanwhile names them again and keeps
    // them. An app already erased has no bytes left to delete.
    delete_upload: maintenance(async (event) => {
      let sha = event.entity.eid, { STORE, BLOBS } = at.env
      if (!STORE || !BLOBS || !at.app || !/^[0-9a-f]{64}$/.test(sha)) return
      let { directoryOf } = await import('../directory.ts')
      let found = await directoryOf(STORE).appAt(at.app)
      if (!found || (await at.graph.read(naming(sha))).length) return
      await r2Objects(BLOBS).delete(blobPrefix(found.space, found.app) + sha)
    }),
  }
}
