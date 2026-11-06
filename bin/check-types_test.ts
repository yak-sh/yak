import { equal, test, throws } from '@yaks/testing'
import { type Info, survey, WIDE } from '@yaks/testing/deps'
import {
  beside,
  generate,
  MADE,
  programs,
  proofs,
  scope,
} from './check-types.ts'

test('source imports reuse complete readiness receipts and make the remaining outputs', async () => {
  let called: string[][] = []
  let run = (args: string[]) => {
    called.push(args)
    return Promise.resolve(true)
  }
  let catalog = 'bin/compiler-packages.ts',
    client = 'workers/yak/client-assets.ts'
  equal(await generate([catalog, client], run, MADE[catalog]), true)
  equal(called, [['run', '--no-lock', '-A', client]])
  called.length = 0
  equal(await generate([client], run, MADE[client].slice(0, 1)), true)
  equal(called, [['run', '--no-lock', '-A', client]])
})

test('standalone source preparation makes its imports and keeps generation failures', async () => {
  let called: string[][] = []
  let catalog = 'bin/compiler-packages.ts'
  equal(
    await generate([catalog], (args) => {
      called.push(args)
      return Promise.resolve(false)
    }),
    false,
  )
  equal(called, [['run', '--no-lock', '-A', catalog]])
})

test('generated source waits for readiness and makes outputs missing from its receipts', async () => {
  let called: string[][] = []
  let ready = Promise.withResolvers<readonly string[]>()
  let catalog = 'bin/compiler-packages.ts'
  let made = generate([catalog], (args) => {
    called.push(args)
    return Promise.resolve(true)
  }, ready.promise)
  await Promise.resolve()
  equal(called, [])
  ready.resolve([])
  equal(await made, true)
  equal(called, [['run', '--no-lock', '-A', catalog]])
})

test('readiness failures fail generated source preparation without starting a second generator', async () => {
  let called: string[][] = []
  await throws(() =>
    generate(['bin/compiler-packages.ts'], (args) => {
      called.push(args)
      return Promise.resolve(true)
    }, Promise.reject(new Error('asset failed'))), /asset failed/)
  equal(called, [])
})

test('source without generated imports does not wait for unrelated readiness', async () => {
  equal(
    await generate([], () => Promise.resolve(false), new Promise(() => {})),
    true,
  )
})

test('independent host programs start before unrelated generated imports are ready', async () => {
  let receipt = Promise.withResolvers<readonly string[]>()
  let checked: string[] = []
  let catalog = 'bin/compiler-packages.ts'
  let result = programs(
    [
      { made: [catalog], check: () => Promise.resolve(!!checked.push('deno')) },
      { made: [], check: () => Promise.resolve(!!checked.push('workers')) },
    ],
    () => Promise.resolve(true),
    receipt.promise,
  )
  await Promise.resolve()
  await Promise.resolve()
  equal(checked, ['workers'])
  receipt.resolve(MADE[catalog])
  equal(await result, true)
  equal(checked, ['workers', 'deno'])
})

test('hosts share generation and retain failures without blocking independent checks', async () => {
  let checked: string[] = [], generated: string[][] = []
  let catalog = 'bin/compiler-packages.ts'
  let result = await programs([
    { made: [catalog], check: () => Promise.resolve(!!checked.push('deno')) },
    {
      made: [catalog],
      check: () => Promise.resolve(!!checked.push('workers')),
    },
    { made: [], check: () => Promise.resolve(!!checked.push('independent')) },
  ], (args) => {
    generated.push(args)
    return Promise.resolve(false)
  })
  equal(result, false)
  equal(checked, ['independent'])
  equal(generated, [['run', '--no-lock', '-A', catalog]])
})

test('a change checks its importers, and its own package past a module loading a whole platform', async () => {
  let dir = Deno.makeTempDirSync({ prefix: 'yaks-scope-' })
  let world = Array.from({ length: WIDE }, (_, i) => `world${i}.ts`)
  let imports: Record<string, string[]> = {
    'pkg/lock.ts': [],
    'pkg/host.ts': ['pkg/lock.ts', ...world],
    'pkg/host_test.ts': ['pkg/host.ts'],
    'pkg/apart.ts': [],
    'app/direct.ts': ['pkg/lock.ts'],
    'app/far.ts': ['pkg/host.ts'],
    ...Object.fromEntries(world.map((m) => [m, []])),
  }
  let at = (m: string) => `${dir}/${m}`
  for (let m of Object.keys(imports)) {
    Deno.mkdirSync(at(m).replace(/\/[^/]+$/, ''), { recursive: true })
    Deno.writeTextFileSync(at(m), '')
  }
  let info = (): Promise<Info> =>
    Promise.resolve({
      modules: Object.entries(imports).map(([m, deps]) => ({
        specifier: `file://${at(m)}`,
        local: at(m),
        dependencies: deps.map((d) => ({
          code: { specifier: `file://${at(d)}` },
        })),
      })),
      redirects: {},
    })
  let all = Object.keys(imports).filter((m) => !m.startsWith('world')).map(at)
  let s = (await survey(all, info))!
  let owner = (p: string) => /\/(pkg|app)\//.exec(p)?.[1]
  equal(
    scope(s, all, [at('pkg/lock.ts')], owner).map((p) =>
      p.slice(dir.length + 1)
    ),
    ['pkg/lock.ts', 'pkg/host.ts', 'pkg/host_test.ts', 'app/direct.ts'],
  )
  Deno.removeSync(dir, { recursive: true })
})

// A program: each module of the checkout by path, and what it imports.
let proven = (
  graph: Record<string, string[]>,
  bytes: Record<string, string>,
  roots: string[],
  docs: string[] = [],
  platform = 'p',
) =>
  proofs(
    {
      modules: Object.entries(graph).map(([m, deps]) => ({
        specifier: m.includes(':') ? m : `file:///c/${m}`,
        dependencies: deps.map((d) => ({
          specifier: d,
          code: { specifier: d.includes(':') ? d : `file:///c/${d}` },
        })),
      })),
      redirects: {},
      npmPackages: {},
    },
    roots,
    docs,
    platform,
    (path) => Promise.resolve(bytes[path] ?? 'none'),
    'file:///c/',
  )

test('a root is proven by all it and its examples reach, whichever process wrote them', async () => {
  let doc = (pid: string) => beside('a.ts', 3, 'ts').replace(`${Deno.pid}`, pid)
  let program = (pid: string, bytes: Record<string, string>) =>
    proven(
      {
        'a.ts': ['b.ts'],
        'b.ts': ['jsr:@std/x@1'],
        [doc(pid)]: ['a.ts', 'e.ts'],
        'e.ts': [],
        'z.ts': [],
        'jsr:@std/x@1': [],
      },
      bytes,
      ['a.ts', 'z.ts'],
      [doc(pid)],
    ).then((m) => [m.get('a.ts'), m.get('z.ts')])
  let base = { 'a.ts': '1', 'b.ts': '1', 'e.ts': '1', 'z.ts': '1' }
  let [a, z] = await program('1', base)
  equal(await program('2', base), [a, z])
  for (let file of ['a.ts', 'b.ts', 'e.ts']) {
    let [a2, z2] = await program('1', { ...base, [file]: '2' })
    equal([a2 != a, z2], [true, z])
  }
  equal(
    (await proven({ 'a.ts': [] }, base, ['a.ts'], [], 'q')).get('a.ts') !=
      (await proven({ 'a.ts': [] }, base, ['a.ts'])).get('a.ts'),
    true,
  )
})
