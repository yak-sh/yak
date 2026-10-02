// Generate guarded ability patches, never write the live store. The operator
// supplies a fresh read and the previous seed, then rehearses the output.
import { cleaned, unpacked, updated } from '../apps/vale/ability-update.ts'
import after from '../apps/vale/seed/abilities/abilities.json' with {
  type: 'json',
}

let [live, baseline, output, op = 'update'] = Deno.args
if (!live || !baseline || !output || !['update', 'clean'].includes(op)) {
  throw new Error(
    'usage: vale-ability-update.ts live.json baseline.json patches.json [update|clean]',
  )
}
let rows = unpacked(JSON.parse(await Deno.readTextFile(live)))
let before = unpacked(JSON.parse(await Deno.readTextFile(baseline)))
let patches = op == 'clean' ? cleaned(rows) : updated(rows, before, after)
await Deno.writeTextFile(output, JSON.stringify(patches, null, 2) + '\n')
console.log(`${patches.length} guarded ${op} patches written to ${output}`)
