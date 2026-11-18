// Preserve unfinished backup snapshots through the shared filesystem trash.
import { trash } from '@yaks/process/trash'

let [root, ...sources] = Deno.args
if (!root || !sources.length) {
  throw new Error('usage: backup-trash <root> <source>…')
}
for (let source of sources) {
  let saved = await trash(source, root)
  if (saved) console.log(`backup: retained ${source} at ${saved}`)
}
