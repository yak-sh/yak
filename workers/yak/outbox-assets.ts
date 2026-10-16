// The public client's write outbox is built from its owning package, never a copy.
import { bundle } from '@yaks/cli/page'

export let assets = async (
  to = new URL('./public/_outbox.js', import.meta.url),
) => {
  await Deno.writeTextFile(
    to,
    await bundle(new URL('../../packages/sync/outbox.ts', import.meta.url)),
  )
}
if (import.meta.main) await assets()
