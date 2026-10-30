import { importing } from '@yaks/fp/imports'
import { equal, test, throws } from './mod.ts'
import { observe } from './reads.ts'
import { affected } from './choose.ts'
import { proof, survey } from './deps.ts'

let dir = Deno.makeTempDirSync({ prefix: 'yaks-reads-' })
let fixture = `${dir}/fixture.json`
Deno.writeTextFileSync(fixture, '{}')
let module = new URL('../fp/imports.ts', import.meta.url)
let original = Deno.readTextFileSync
let observed = observe(dir)
observed.mark('one_test.ts')
let contents = Deno.readTextFileSync(new URL(`file://${fixture}`))
let missing = `${dir}/missing`
let error = await throws(() => Deno.readTextFileSync(missing))
observed.mark('two_test.ts')
await Deno.readFile(fixture)
let reads = observed.reads()
observed.close()

let modules = observe(
  new URL('../../', import.meta.url).pathname.replace(/\/$/, ''),
)
modules.mark('one_test.ts')
await importing(module.href)
modules.mark('unrelated_test.ts')
modules.mark('two_test.ts')
await importing(module.href)
let loaded = modules.reads()
modules.close()
let fixtureSurvey = (await survey(
  [fixture],
  () => Promise.resolve({ modules: [], redirects: {} }),
))!
let recorded = reads.get('one_test.ts')!.map((path) => `${dir}/${path}`)
let beforeFixture = await proof(fixtureSurvey, 'key', recorded)
Deno.writeTextFileSync(fixture, '[]')
let afterFixture = await proof(
  (await survey(
    [fixture],
    () => Promise.resolve({ modules: [], redirects: {} }),
  ))!,
  'key',
  recorded,
)
let selectedFixture = affected(fixtureSurvey, [], [], [fixture], recorded)
Deno.removeSync(dir, { recursive: true })

test('observed reads retain fixture paths per file and preserve values and errors', () => {
  equal(contents, '{}')
  equal(error instanceof Deno.errors.NotFound, true)
  equal(reads.get('one_test.ts'), ['fixture.json', 'missing'])
  equal(reads.get('two_test.ts'), ['fixture.json'])
  equal(Deno.readTextFileSync, original)
})

test('computed and cached module loads retain dependency paths for both consumers', () => {
  equal(loaded.get('one_test.ts'), ['packages/fp/imports.ts'])
  equal(loaded.get('unrelated_test.ts'), [])
  equal(loaded.get('two_test.ts'), ['packages/fp/imports.ts'])
})

test('an observed fixture edit invalidates its pass and selects its consumer', () => {
  equal(beforeFixture == afterFixture, false)
  equal(selectedFixture, true)
})
