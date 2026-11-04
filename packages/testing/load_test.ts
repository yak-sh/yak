import { equal, test, throws } from './mod.ts'
import { plan } from './load.ts'
import { discover } from './find.ts'

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

let page = `${dir}/snapshot.ts`
Deno.writeTextFileSync(
  page,
  "/// await import('./before.ts')\nexport let value = 1",
)
let found = await discover([page])
Deno.writeTextFileSync(
  page,
  "/// await import('./after.ts')\nexport let value = 2",
)
let plannedText = async (parsed?: typeof found.parsed) => {
  let [[, path]] = await plan([page], parsed)
  try {
    return Deno.readTextFileSync(path)
  } finally {
    Deno.removeSync(path)
  }
}
let reused = await plannedText(found.parsed)
let fresh = await plannedText()
let fallback = await plannedText(new Map())

test('planning reuses discovered example inputs within a command and standalone calls read fresh inputs', () => {
  equal(reused, 'import "./snapshot.ts"\nimport "./before.ts"\n')
  equal(fresh, 'import "./snapshot.ts"\nimport "./after.ts"\n')
  equal(fallback, fresh)
})

test('planning an unknown missing page still reports the read failure', async () => {
  await throws(() => plan([`${dir}/missing.ts`], found.parsed), /no such file/i)
})
