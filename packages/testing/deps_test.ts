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
  remembered,
  shared,
  survey,
  WIDE,
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

test('a remembered graph asks deno again only of the modules changed since', async () => {
  let table = { 'g/x_test.ts': ['g/y.ts'], 'g/y.ts': [] }
  for (let m of Object.keys(table)) write(m, m)
  let asked: string[][] = []
  let ask = remembered((roots) => {
    asked.push(roots)
    return deno(table)()
  }, at('g/graph.json'))
  let names = async () =>
    (await ask([at('g/x_test.ts')]))!.modules.map((m) => m.specifier).sort()
  let whole = await names()
  equal(whole, [`file://${at('g/x_test.ts')}`, `file://${at('g/y.ts')}`])
  equal(await names(), whole)
  equal(asked, [[at('g/x_test.ts')]])
  write('g/y.ts', 'changed')
  equal(await names(), whole)
  equal(asked.at(-1), [at('g/y.ts')])
})

let store = `${dir}/passed.json`
let reads = `${dir}/read.json`
remember(['a', 'b', 'c'], store)
forget(['a', 'c', 'never'], store)
note({ 'a_test.ts': ['x.json'], 'b_test.ts': [], 'c_test.ts': ['y'] }, reads)
note({ 'c_test.ts': [] }, reads)

test('a pass forgotten is no longer kept, and the others stay', () => {
  equal(Object.keys(passed(store)), ['b'])
})

test('what a file read is kept by its name, reading nothing included', () => {
  equal(recall(reads), {
    'a_test.ts': ['x.json'],
    'b_test.ts': [],
    'c_test.ts': [],
  })
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

write('types.ts', 'export type Input = string')
let typed = (await survey([at('a_test.ts')], () =>
  Promise.resolve({
    modules: [
      {
        specifier: `file://${at('a_test.ts')}`,
        dependencies: [{ type: { specifier: `file://${at('types.ts')}` } }],
      },
      { specifier: `file://${at('types.ts')}` },
    ],
    redirects: {},
  })))!

test('relevance includes type-only consumers', () => {
  equal(affected(typed, [at('a_test.ts')], [], [at('types.ts')]), true)
})

test('erased type dependencies reach checks but do not reach execution or its pass key', async () => {
  equal(typed.reaches([at('a_test.ts')], [at('types.ts')]), true)
  equal(typed.reaches([at('a_test.ts')], [at('types.ts')], false, true), false)
  let before = await key(typed, '', at('a_test.ts'), at('a_test.ts'), true)
  write('types.ts', 'export type Input = number')
  let changed = (await survey([at('a_test.ts')], () =>
    Promise.resolve({
      modules: [
        {
          specifier: `file://${at('a_test.ts')}`,
          dependencies: [{ type: { specifier: `file://${at('types.ts')}` } }],
        },
        { specifier: `file://${at('types.ts')}` },
      ],
      redirects: {},
    })))!
  equal(await key(changed, '', at('a_test.ts'), at('a_test.ts'), true), before)
  ok(
    await key(changed, '', at('a_test.ts')) !=
      await key(typed, '', at('a_test.ts')),
  )
})

test('distance counts imports from a change, and stops at a module that loads a whole platform', async () => {
  let fixture = Array.from({ length: WIDE }, (_, i) => `world${i}.ts`)
  let s = (await survey(
    [at('near_test.ts'), at('far_test.ts'), at('kernel_test.ts')],
    deno({
      'near_test.ts': ['subject.ts'],
      'far_test.ts': ['caller.ts'],
      'caller.ts': ['subject.ts'],
      'kernel_test.ts': ['kernel.ts'],
      'kernel.ts': ['subject.ts', ...fixture],
      'subject.ts': [],
      ...Object.fromEntries(fixture.map((m) => [m, []])),
    }),
  ))!
  let far = s.distance([at('subject.ts')])
  equal(far(at('subject.ts')), 0)
  equal(far(at('near_test.ts')), 1)
  equal(far(at('far_test.ts')), 2)
  equal(far(at('kernel.ts')), 1)
  equal(far(at('kernel_test.ts')), Infinity)
  equal(s.distance([at('kernel.ts')])(at('kernel_test.ts')), 1)
  ok(s.reaches([at('kernel_test.ts')], [at('subject.ts')]))
})

test('distance is 0 for the files of a changed package, and 1 for its importers and its files behind a whole platform', async () => {
  let fixture = Array.from({ length: WIDE }, (_, i) => `world${i}.ts`)
  let s = (await survey(
    [
      at('lib/README.md.ts'),
      at('app/kernel_test.ts'),
      at('use/lib_test.ts'),
      at('use/far_test.ts'),
    ],
    deno({
      'lib/README.md.ts': ['lib/mod.ts'],
      'lib/mod.ts': ['lib/render.ts', 'lib/other.ts'],
      'lib/render.ts': [],
      'lib/other.ts': [],
      'app/kernel_test.ts': ['app/kernel.ts'],
      'app/kernel.ts': ['app/apps.ts', ...fixture],
      'app/apps.ts': ['lib/render.ts'],
      'use/lib_test.ts': ['lib/other.ts'],
      'use/far_test.ts': ['use/helper.ts'],
      'use/helper.ts': ['lib/mod.ts'],
      ...Object.fromEntries(fixture.map((m) => [m, []])),
    }),
  ))!
  let owner = (path: string) => path.slice(dir.length + 1).split('/')[0]
  let far = s.distance([at('lib/render.ts'), at('app/apps.ts')], owner)
  equal(far(at('lib/README.md.ts')), 0)
  equal(far(at('use/lib_test.ts')), 1)
  equal(far(at('use/far_test.ts')), 3)
  equal(far(at('app/kernel_test.ts')), 1)
  equal(s.distance([at('lib/render.ts')])(at('lib/README.md.ts')), 2)
})
