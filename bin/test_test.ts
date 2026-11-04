import { equal, test } from '@yaks/testing'
import { affected } from '@yaks/testing/choose'
import { survey } from '@yaks/testing/deps'
import { changes } from './test-changes.ts'
import { prepare, RUNS } from './test.ts'

// A module graph with a runner consumer and an unrelated example page.
let helpers = [
  'bin/phases.ts',
  'bin/test-budget.ts',
  'bin/test-changes.ts',
  'bin/test-checks.ts',
  'bin/sqlite.ts',
]
let imports = {
  'bin/test_test.ts': ['bin/test.ts'],
  'bin/test.ts': helpers,
  'packages/fp/mod.ts': [],
  ...Object.fromEntries(helpers.map((f) => [f, []])),
}
let graph = (await survey(Object.keys(imports), () =>
  Promise.resolve({
    modules: Object.entries(imports).map(([file, deps]) => ({
      specifier: new URL(file, `file://${Deno.cwd()}/`).href,
      dependencies: deps.map((file) => ({
        code: { specifier: new URL(file, `file://${Deno.cwd()}/`).href },
      })),
    })),
    redirects: {},
  })))!

for (let file of ['bin/test.ts', ...helpers]) {
  test(`${file} selects its consumers without selecting unrelated tests`, () => {
    equal(affected(graph, ['bin/test_test.ts'], RUNS, [file]), true)
    equal(affected(graph, ['bin/test.ts'], RUNS, [file]), true)
    equal(affected(graph, ['packages/fp/mod.ts'], RUNS, [file]), false)
  })
}

test('an executor change still selects unrelated tests', () => {
  equal(
    affected(graph, ['packages/fp/mod.ts'], RUNS, ['packages/testing/run.ts']),
    true,
  )
})

let planned = async (args: string[], shallow = false, pass = true) => {
  let git: string[][] = []
  let checked: string[][] = []
  let selected: { all: boolean; changed?: string[]; sources: string[] }[] = []
  let files = ['a_test.ts', 'a.ts']
  let plan = await prepare(args, '/sqlite.so', {
    changes: () =>
      changes((args) => {
        git.push(args)
        if (args[0] == 'branch') return Promise.resolve('main\n')
        if (args[0] == 'diff' && shallow) {
          throw new Error("fatal: ambiguous argument 'HEAD^'")
        }
        return Promise.resolve(args[0] == 'diff' ? 'a.ts\0' : '')
      }),
    format: (paths) => Promise.resolve(paths),
    find: () => Promise.resolve({ tests: [files[0]], pages: [files[1]] }),
    chosen: (files, all, _also, changed, sources = []) => {
      selected.push({ all, changed, sources })
      return Promise.resolve({
        keys: new Map(files.map((f) => [f, f])),
        run: files,
        affected: files,
        sources: ['a.ts'],
        beyond: 0,
        reaches: () => false,
        read: () => undefined,
      })
    },
    check: (changed) => {
      checked.push(changed)
      return Promise.resolve(pass)
    },
    ready: () => Promise.resolve(),
  })
  return { plan, git, checked, selected }
}
let whole = await planned(['--all', '--verbose'], true)
let local = await planned([])
let failed = await planned([], false, false)

test('--all in a shallow checkout runs every file without git history or duplicate source checks', async () => {
  equal(whole.plan.run, ['a_test.ts', 'a.ts'])
  equal(await whole.plan.ok, true)
  equal(whole.selected, [{ all: true, changed: undefined, sources: [] }])
  equal(whole.git, [])
  equal(whole.checked, [])
})

test('local selection keeps consumer tests, checks changed sources and propagates failures', async () => {
  equal(local.selected, [{ all: false, changed: ['a.ts'], sources: ['a.ts'] }])
  equal(local.checked, [['a.ts']])
  equal(local.plan.run, ['a_test.ts', 'a.ts'])
  equal(await local.plan.ok, true)
  equal(await failed.plan.ok, false)
})

test('dependency bookkeeping changes select their consumers without selecting unrelated tests', () => {
  for (let path of ['packages/testing/main.ts', 'packages/testing/reads.ts']) {
    equal(affected(graph, ['packages/fp/mod.ts'], RUNS, [path]), false)
  }
  equal(
    affected(graph, ['packages/fp/mod.ts'], RUNS, ['bin/test-runtime.ts']),
    true,
  )
})

let readied = async (read: (file: string) => string[] | undefined) => {
  let made: boolean[] = []
  let order: string[] = []
  let plan = await prepare([], '/sqlite.so', {
    changes: () => Promise.resolve(['worker.ts', 'guide.md']),
    format: (files) => Promise.resolve(files),
    find: () => Promise.resolve({ tests: ['a_test.ts'], pages: [] }),
    chosen: (files, _all, _also, _changed, sources) => {
      equal(sources, ['worker.ts'])
      return Promise.resolve({
        keys: new Map(),
        run: files,
        affected: files,
        sources: ['worker.ts'],
        beyond: 0,
        reaches: (paths) => paths.includes('workers/yak/testing.ts'),
        read,
      })
    },
    check: async (_changed, prepared) => {
      order.push('check')
      equal(
        await prepared,
        made.at(-1) ? ['workers/yak/public/_client.js'] : [],
      )
      return Promise.resolve(made.length > 0)
    },
    ready: async (_quiet, assets) => {
      order.push('ready')
      made.push(assets)
      await Promise.resolve()
      order.push('completed')
      return assets ? ['workers/yak/public/_client.js'] : []
    },
  })
  equal(await plan.ok, true)
  equal(order, ['ready', 'check', 'completed'])
  return made
}

test('source checks begin beside readiness and receive its completed generated imports', async () => {
  equal(await readied(() => undefined), [true])
})

test('a run makes the generated assets only when a file it runs read one, or has no reads kept', async () => {
  equal(await readied(() => ['workers/yak/public/docs.md']), [false])
  equal(await readied(() => ['workers/yak/public/_client.js']), [true])
})
