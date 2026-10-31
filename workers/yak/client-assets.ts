// The public client a page imports, built with the parts it imports from
// their owning packages, never a copy. A page gets the client as one module
// (`_client.js`, served at `./api/client.js`): fetched as parts, the parts
// were a round trip after the client's own on every load. The parts are
// written beside it, for the bundle to read and for a page that loaded the
// client before it was one.
import { bundle } from '@yaks/cli/page'
import { written } from './sheet-assets.ts'

let parts = {
  '_draft.js': '../../packages/draft/browser.ts',
  '_outbox.js': '../../packages/sync/outbox.ts',
  '_wire.js': '../../packages/vocab/wire.ts',
}

export let assets = async (to = new URL('./public/', import.meta.url)) => {
  await Promise.all(
    Object.entries(parts).map(async ([name, from]) =>
      Deno.writeTextFile(
        new URL(name, to),
        await bundle(new URL(from, import.meta.url)),
      )
    ),
  )
  await Deno.writeTextFile(
    new URL('_client.js', to),
    await bundle(new URL('client.js', to)),
  )
}
if (import.meta.main) await Promise.all([assets(), written()])
