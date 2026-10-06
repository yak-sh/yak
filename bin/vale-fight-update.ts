// Plan the operator's guarded legacy fight migration; never address a store.
import { cleared, restored } from '../apps/vale/fight-update.ts'
import { unpacked } from '../apps/vale/ability-update.ts'
let [op, baseline, output, current] = Deno.args
if (
  !['clear', 'restore', 'restore-text'].includes(op) || !baseline || !output ||
  (op != 'clear' && !current)
) {
  throw new Error(
    'usage: vale-fight-update.ts clear original.json clears.json | restore|restore-text original.json restores.json current.json',
  )
}
let before = unpacked(JSON.parse(await Deno.readTextFile(baseline)))
let patches = op == 'clear' ? cleared(before) : restored(
  before,
  unpacked(JSON.parse(await Deno.readTextFile(current))),
  op == 'restore-text',
)
await Deno.writeTextFile(output, JSON.stringify(patches, null, 2) + '\n')
console.log(`${patches.length} guarded ${op} patches written to ${output}`)
