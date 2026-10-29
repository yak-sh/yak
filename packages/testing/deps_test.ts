import { equal, ok, test } from './mod.ts'
import { affected } from './choose.ts'
import {
  forget,
  type Info,
  key,
  note,
  passed,
  proof,
  recall,
  remember,
  shared,
  survey,
} from './deps.ts'

// A directory of files, and the graph deno would say of its modules: each
// importing what `imports` names, and the runner also what it `asks` for
// only when a run needs it.
let dir = Deno.makeTempDirSync({ prefix: 'yaks-deps-' })
let at = (name: string) => `${dir}/${name}`
let write = (name: string, text = '') => {
  Deno.mkdirSync(at(name).slice(0, at(name).lastIndexOf('/')), {
    recursive: true,
  })
  Deno.writeTextFileSync(at(name), text)
}
let imports: Record<string, string[]> = {
  'a_test.ts': ['one.ts'],
  'b_test.ts': ['two.ts'],
  'c_test.ts': [],
  'one.ts': [],
  'two.ts': [],
  'plugin.ts': ['helper.ts'],
  'helper.ts': [],
  'runner.ts': ['helper.ts'],
}
let asks: Record<string, string[]> = { 'runner.ts': ['two.ts'] }
let deno = (table: Record<string, string[]>) => (): Promise<Info> =>
  Promise.resolve({
    modules: Object.entries(table).map(([m, deps]) => ({
      specifier: `file://${at(m)}`,
      local: at(m),
      dependencies: [
        ...deps.map((d) => ({ code: { specifier: `file://${at(d)}` } })),
        ...(asks[m] ?? []).map((d) => ({
          code: { specifier: `file://${at(d)}` },
          isDynamic: true,
        })),
      ],
    })),
    redirects: {},
  })
let info = deno(imports)
for (let m of Object.keys(imports)) write(m)
write(
  'c_test.ts',
  "new URL('./data.json', import.meta.url)\nnew URL('./', import.meta.url)",
)
write('data.json', '{}')
write('sub/a.txt')

// What the files are now: each test's key, and the proof of a pass that read
// the data, a directory and a plugin imported by a computed specifier.
let now = async () => {
  let s = (await survey([...Object.keys(imports).map(at)], info))!
  let common = await shared(s, [at('deno.json')], 'deno', [at('runner.ts')])
  let k = (f: string) => key(s, common, at(f))
  let a = await k('a_test.ts')
  return {
    a,
    b: await k('b_test.ts'),
    c: await k('c_test.ts'),
    read: await proof(s, a, [at('data.json'), at('sub'), at('plugin.ts')]),
    none: await proof(s, a, []),
    unseen: await proof(s, a),
  }
}
let first = await now()
write('two.ts', 'export let two = 2')
let two = await now()
write('one.ts', 'export let one = 1')
let one = await now()
write('data.json', '[]')
let data = await now()
write('other.txt')
let other = await now()
write('sub/b.txt')
let listed = await now()
write('sub/.a.md.plan.1.example.ts')
let planned = await now()
write('helper.ts', 'export let help = 1')
let helped = await now()
write('deno.json', '{}')
let config = await now()

test('a key changes with a module its file reaches, and only that', () => {
  equal(two.a, first.a)
  ok(two.b != first.b)
  ok(one.a != two.a)
  equal(one.b, two.b)
})

test('a key holds a file a module names beside itself, and a directory it names as a place', () => {
  ok(data.c != one.c)
  equal(other.c, data.c)
})

test('a key holds what every file of its kind shares', () => {
  ok(config.a != helped.a && config.b != helped.b)
})

test('a key holds the runner by what loads with it, not what it asks for when a run needs it', () => {
  ok(helped.c != planned.c)
  equal(two.c, first.c)
})

test('a pass is kept by what its file read: bytes, a listing, a module and its graph', () => {
  ok(data.read != one.read)
  ok(listed.read != other.read)
  ok(helped.read != listed.read)
  equal(listed.a, other.a)
})

test('a listing leaves out what the runner writes beside a page', () => {
  equal(planned.read, listed.read)
})

test('a pass that read nothing, or was not seen reading, is kept apart', () => {
  equal(first.unseen, first.a)
  ok(first.none != first.a)
  ok(first.none != first.read)
})

// The data file alone, and beside a module importing it as JSON.
let alone = (await survey([at('a_test.ts')], info))!
let amid = (await survey(
  [at('a_test.ts'), at('json.ts')],
  deno({ ...imports, 'json.ts': ['data.json'], 'data.json': [] }),
))!

test('a file of data holds the same whether or not a module imports it', async () => {
  equal(await amid.of(at('data.json')), await alone.of(at('data.json')))
})

let store = `${dir}/passed.json`
let reads = `${dir}/read.json`
remember(['a', 'b', 'c'], store)
forget(['a', 'c', 'never'], store)
note({ k1: ['x.json'], k2: [], k3: ['y'] }, reads)
note({ k3: [] }, reads)

test('a pass forgotten is no longer kept, and the others stay', () => {
  equal(Object.keys(passed(store)), ['b'])
})

test('what a file read is kept by its key, and a file that read nothing keeps no entry', () => {
  equal(recall(reads), { k1: ['x.json'] })
})

test('relevance follows transitive imports and named data, with an empty pass cache', () => {
  equal(affected(alone, [at('a_test.ts')], [], [at('one.ts')]), true)
  equal(affected(alone, [at('a_test.ts')], [], [at('two.ts')]), false)
  equal(affected(alone, [at('c_test.ts')], [], [at('data.json')]), true)
  equal(affected(alone, [at('a_test.ts')], [], []), false)
})

test('shared runners reach unconditional code, while observed modules reach their own imports', () => {
  equal(
    affected(alone, [at('c_test.ts')], [at('runner.ts')], [at('helper.ts')]),
    true,
  )
  equal(
    affected(alone, [at('c_test.ts')], [at('runner.ts')], [at('two.ts')]),
    false,
  )
  equal(
    affected(alone, [at('a_test.ts')], [], [at('helper.ts')], [
      at('plugin.ts'),
    ]),
    true,
  )
  equal(
    affected(alone, [at('a_test.ts')], [], [at('sub/new.txt')], [at('sub')]),
    true,
  )
})
