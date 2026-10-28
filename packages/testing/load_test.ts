import { equal, test } from './mod.ts'
import { plan } from './load.ts'

let dir = Deno.makeTempDirSync({ prefix: 'yaks-load-' })
Deno.writeTextFileSync(
  `${dir}/m.ts`,
  [
    "/// let { ram } = await import('./ram.ts')",
    "/// (await import('./dep.ts')).x -> 1",
    "// / await import('./later.ts')",
    'export let m = 1',
  ].join('\n'),
)
let [[, planned]] = await plan([`${dir}/m.ts`])
let named = [...Deno.readTextFileSync(planned).matchAll(/import "([^"]+)"/g)]
  .map((m) => m[1])
Deno.removeSync(planned)

test('a page is keyed by what its doctests import, by a literal import() too', () => {
  equal(named, ['./m.ts', './ram.ts', './dep.ts'])
})
